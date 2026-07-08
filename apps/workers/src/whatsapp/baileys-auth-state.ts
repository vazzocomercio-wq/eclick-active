import {
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
  BufferJSON,
  initAuthCreds,
  proto,
} from '@whiskeysockets/baileys';
import { getSupabase } from '../supabase.js';
import {
  decryptAuthBlob,
  encryptAuthBlob,
  isEncryptedAuthBlob,
} from './auth-crypto.js';

/**
 * Persistência do auth state do Baileys em `active.channels.credentials.baileys_auth`.
 *
 * Substitui `useMultiFileAuthState` (que escreve em filesystem) por uma
 * versão que faz UPDATE no jsonb da row do canal. Schema do jsonb:
 *
 *   credentials.baileys_auth = {
 *     creds: <AuthenticationCreds serializado com BufferJSON>,
 *     keys: {
 *       'pre-key':                { [id]: <SignalDataTypeMap['pre-key']> },
 *       'session':                { [id]: <SignalDataTypeMap['session']> },
 *       'sender-key':             { [id]: <...> },
 *       'app-state-sync-key':     { [id]: <...> },
 *       'app-state-sync-version': { [id]: <...> },
 *       'sender-key-memory':      { [id]: <...> },
 *     }
 *   }
 *
 * Estratégia: cache TUDO em memória (creds + keys), e persiste async
 * a cada `saveCreds()` ou `keys.set()`. Sem debounce — o volume de
 * eventos é baixo (alguns Hz no setup, depois quase zero).
 */

type KeyType = keyof SignalDataTypeMap;
type KeyMap = { [type in KeyType]?: { [id: string]: SignalDataTypeMap[type] | null } };

interface PersistedAuth {
  creds: AuthenticationCreds;
  keys: KeyMap;
}

export interface BaileysAuthHandle {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  /** Limpa todo o auth state (usado em DisconnectReason.loggedOut). */
  clear: () => Promise<void>;
}

export async function loadAuthState(channelId: string): Promise<BaileysAuthHandle> {
  const supabase = getSupabase();

  // Carrega o estado atual da row
  const { data, error } = await supabase
    .from('channels')
    .select('credentials')
    .eq('id', channelId)
    .maybeSingle();

  if (error) {
    throw new Error(`loadAuthState(${channelId}): ${error.message}`);
  }

  const rawStored = (data?.credentials as { baileys_auth?: unknown } | null)
    ?.baileys_auth;

  // ── Retrocompat de formato (CRÍTICO) ─────────────────────────────
  // Sessões ativas HOJE estão em plaintext (`{ creds, keys }`). Sessões
  // novas (com BAILEYS_AUTH_ENC_KEY setada) vêm criptografadas
  // (`{ v:1, alg, iv, tag, data }`). Detectamos pelo shape:
  //   - blob criptografado → descriptografa pro objeto plaintext.
  //   - qualquer outra coisa → usa como está (plaintext legado).
  // Assim, canais existentes continuam carregando sem tocar no banco;
  // eles só migram pra criptografado na próxima gravação (se a chave
  // estiver configurada).
  let stored: PersistedAuth | undefined;
  if (isEncryptedAuthBlob(rawStored)) {
    try {
      stored = decryptAuthBlob(rawStored) as PersistedAuth;
    } catch (err) {
      // Não caia pra plaintext silenciosamente (blob adulterado ou chave
      // errada) — melhor falhar alto e deixar o canal re-parear do que
      // corromper o estado. loadAuthState é chamado dentro de start(),
      // que já trata exceção (reagenda / marca sessão).
      // eslint-disable-next-line no-console
      console.error(
        `[baileys-auth] decrypt(${channelId}) falhou: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }
  } else {
    stored = rawStored as PersistedAuth | undefined;
  }

  // Deserializa via BufferJSON (Baileys grava Buffer como { type: 'Buffer', data: [...] }
  // ou base64 — usamos o reviver canônico)
  const creds: AuthenticationCreds = stored?.creds
    ? (JSON.parse(JSON.stringify(stored.creds), BufferJSON.reviver) as AuthenticationCreds)
    : initAuthCreds();

  const keys: KeyMap = stored?.keys
    ? (JSON.parse(JSON.stringify(stored.keys), BufferJSON.reviver) as KeyMap)
    : {};

  // ── Serialização + debounce das gravações (HIGH) ─────────────────
  // O persist é read-modify-write do JSONB inteiro. Em rajada (setup do
  // pareamento emite dezenas de keys.set/creds.update por segundo), chamadas
  // concorrentes fazem SELECT→UPDATE interleaved e uma perde o update da
  // outra (lost-update). Serializamos com um mutex por canal (uma gravação
  // por vez) e coalescemos rajadas com um debounce curto — como `creds` e
  // `keys` são o estado COMPLETO em memória, gravar o snapshot mais recente
  // basta; não precisamos gravar cada delta.
  const DEBOUNCE_MS = 150;
  let persisting: Promise<void> | null = null; // gravação em voo (mutex)
  let pendingResolve: (() => void)[] = []; // callers aguardando o próximo flush
  let debounceTimer: NodeJS.Timeout | null = null;

  // Faz UMA gravação do snapshot atual. NUNCA lança — loga e segue, pra que
  // o `void saveCreds()` fire-and-forget do socket não vire unhandled rejection.
  async function persistNow(): Promise<void> {
    try {
      const serialized: PersistedAuth = JSON.parse(
        JSON.stringify({ creds, keys }, BufferJSON.replacer),
      ) as PersistedAuth;

      // Criptografa se BAILEYS_AUTH_ENC_KEY estiver setada; senão grava
      // plaintext (comportamento atual) — encryptAuthBlob decide e avisa.
      const blob = encryptAuthBlob(serialized);

      // Pega credentials atual e mescla baileys_auth (não sobrescreve outros campos)
      const { data: row } = await supabase
        .from('channels')
        .select('credentials')
        .eq('id', channelId)
        .maybeSingle();

      const current =
        ((row?.credentials as Record<string, unknown> | null) ?? {}) as Record<
          string,
          unknown
        >;

      const merged = { ...current, baileys_auth: blob };

      const { error: upErr } = await supabase
        .from('channels')
        .update({ credentials: merged })
        .eq('id', channelId);

      if (upErr) {
        // eslint-disable-next-line no-console
        console.warn(`[baileys-auth] persist(${channelId}) falhou: ${upErr.message}`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[baileys-auth] persist(${channelId}) exceção: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // Serializa: se já há gravação em voo, encadeia a próxima depois dela.
  function runSerialized(): void {
    const waiters = pendingResolve;
    pendingResolve = [];
    const prev = persisting ?? Promise.resolve();
    persisting = prev.then(persistNow).finally(() => {
      for (const r of waiters) r();
    });
  }

  // Agenda o flush com debounce. Retorna promise que resolve quando o
  // snapshot desse caller (ou um mais recente) tiver sido gravado.
  function persist(): Promise<void> {
    return new Promise<void>((resolve) => {
      pendingResolve.push(resolve);
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        runSerialized();
      }, DEBOUNCE_MS);
    });
  }

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async (type, ids) => {
        const bucket = (keys[type] ?? {}) as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const id of ids) {
          let v = bucket[id];
          // Baileys exige que app-state-sync-key venha como proto (não plain JSON)
          if (type === 'app-state-sync-key' && v) {
            v = proto.Message.AppStateSyncKeyData.fromObject(v as object);
          }
          if (v !== undefined && v !== null) out[id] = v;
        }
        return out as never;
      },
      set: async (data) => {
        for (const typeStr of Object.keys(data)) {
          const type = typeStr as KeyType;
          const bucket = (keys[type] ??= {}) as Record<string, unknown>;
          const records = (data[type] ?? {}) as Record<string, unknown>;
          for (const id of Object.keys(records)) {
            const v = records[id];
            if (v === null || v === undefined) {
              delete bucket[id];
            } else {
              bucket[id] = v;
            }
          }
        }
        await persist();
      },
    },
  };

  return {
    state,
    saveCreds: persist,
    clear: async () => {
      // Cancela qualquer flush pendente e espera a gravação em voo terminar,
      // pra um persist enfileirado não reescrever baileys_auth DEPOIS do clear
      // (loggedOut precisa deixar o canal sem auth pra re-parear).
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      pendingResolve = [];
      if (persisting) await persisting.catch(() => {});

      const { data: row } = await supabase
        .from('channels')
        .select('credentials')
        .eq('id', channelId)
        .maybeSingle();
      const current =
        ((row?.credentials as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
      delete current.baileys_auth;
      await supabase
        .from('channels')
        .update({ credentials: current })
        .eq('id', channelId);
    },
  };
}
