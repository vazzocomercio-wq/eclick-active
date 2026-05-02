import {
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
  BufferJSON,
  initAuthCreds,
  proto,
} from '@whiskeysockets/baileys';
import { getSupabase } from '../supabase.js';

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

  const stored = (data?.credentials as { baileys_auth?: unknown } | null)
    ?.baileys_auth as PersistedAuth | undefined;

  // Deserializa via BufferJSON (Baileys grava Buffer como { type: 'Buffer', data: [...] }
  // ou base64 — usamos o reviver canônico)
  const creds: AuthenticationCreds = stored?.creds
    ? (JSON.parse(JSON.stringify(stored.creds), BufferJSON.reviver) as AuthenticationCreds)
    : initAuthCreds();

  const keys: KeyMap = stored?.keys
    ? (JSON.parse(JSON.stringify(stored.keys), BufferJSON.reviver) as KeyMap)
    : {};

  // Persiste o jsonb inteiro (replace). Não fazemos merge porque o `keys`
  // do KeyMap em memória JÁ é o "estado completo".
  async function persist(): Promise<void> {
    const serialized: PersistedAuth = JSON.parse(
      JSON.stringify({ creds, keys }, BufferJSON.replacer),
    ) as PersistedAuth;

    // Pega credentials atual e mescla baileys_auth (não sobrescreve outros campos)
    const { data: row } = await supabase
      .from('channels')
      .select('credentials')
      .eq('id', channelId)
      .maybeSingle();

    const current =
      ((row?.credentials as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;

    const merged = { ...current, baileys_auth: serialized };

    const { error: upErr } = await supabase
      .from('channels')
      .update({ credentials: merged })
      .eq('id', channelId);

    if (upErr) {
      // eslint-disable-next-line no-console
      console.warn(`[baileys-auth] persist(${channelId}) falhou: ${upErr.message}`);
    }
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
