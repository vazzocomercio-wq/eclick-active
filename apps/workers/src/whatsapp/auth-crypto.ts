import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Criptografia AES-256-GCM do auth state do Baileys (creds + keys Signal).
 *
 * MOTIVAÇÃO: sem isso, `channels.credentials.baileys_auth` guarda o estado
 * Signal em PLAINTEXT no banco — um dump do DB permite sequestro completo da
 * sessão WhatsApp do cliente. Com criptografia, o blob só é útil pra quem tem
 * a chave (que fica em env var, fora do banco).
 *
 * ────────────────────────────────────────────────────────────────────────
 * CONFIGURAÇÃO (Railway / .env do worker):
 *
 *   BAILEYS_AUTH_ENC_KEY = <32 bytes em hex (64 chars) OU base64>
 *
 * Gere uma chave com:  openssl rand -hex 32
 *
 * • COM a env var setada  → todo save do auth é criptografado (AES-256-GCM).
 * • SEM a env var         → comportamento ATUAL (plaintext) + aviso no log.
 *   O deploy NÃO quebra sem a chave; ela só ativa a proteção.
 * ────────────────────────────────────────────────────────────────────────
 *
 * RETROCOMPATIBILIDADE (crítico — sessões ativas hoje estão em plaintext):
 *   • LEITURA detecta o formato pelo shape do blob:
 *       - `{ v: 1, alg, iv, tag, data }` → criptografado, descriptografa.
 *       - qualquer outra coisa (ex: `{ creds, keys }`) → plaintext legado,
 *         usado como está.
 *     Ou seja, sessões existentes continuam carregando normalmente.
 *   • Na PRÓXIMA gravação, se a chave estiver setada, o blob migra
 *     automaticamente pra criptografado. Sem a chave, permanece plaintext.
 */

const ENC_VERSION = 1;
const ALG = 'aes-256-gcm';
const IV_BYTES = 12; // padrão GCM
const KEY_BYTES = 32; // AES-256

/** Shape do blob criptografado gravado no JSONB. */
export interface EncryptedAuthBlob {
  v: number;
  alg: string;
  iv: string; // base64
  tag: string; // base64
  data: string; // base64
}

let cachedKey: Buffer | null = null;
let keyResolved = false;
let warnedMissingKey = false;

/**
 * Resolve a chave de `BAILEYS_AUTH_ENC_KEY` (hex de 64 chars OU base64 de 32
 * bytes). Cacheia o resultado. Retorna null se ausente ou inválida.
 */
function resolveKey(): Buffer | null {
  if (keyResolved) return cachedKey;
  keyResolved = true;

  const raw = process.env.BAILEYS_AUTH_ENC_KEY?.trim();
  if (!raw) {
    cachedKey = null;
    return null;
  }

  let buf: Buffer | null = null;

  // hex de 64 chars = 32 bytes
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    buf = Buffer.from(raw, 'hex');
  } else {
    // tenta base64
    try {
      const b = Buffer.from(raw, 'base64');
      if (b.length === KEY_BYTES) buf = b;
    } catch {
      buf = null;
    }
  }

  if (!buf || buf.length !== KEY_BYTES) {
    // eslint-disable-next-line no-console
    console.warn(
      '[auth-crypto] BAILEYS_AUTH_ENC_KEY presente mas inválida ' +
        '(esperado hex de 64 chars ou base64 de 32 bytes). ' +
        'Ignorando — auth será gravado em PLAINTEXT.',
    );
    cachedKey = null;
    return null;
  }

  cachedKey = buf;
  return cachedKey;
}

/** True se a criptografia está configurada e ativa. */
export function isAuthEncryptionEnabled(): boolean {
  return resolveKey() !== null;
}

/**
 * Type-guard: detecta se um blob lido do banco está no formato criptografado.
 */
export function isEncryptedAuthBlob(value: unknown): value is EncryptedAuthBlob {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === ENC_VERSION &&
    typeof v.alg === 'string' &&
    typeof v.iv === 'string' &&
    typeof v.tag === 'string' &&
    typeof v.data === 'string'
  );
}

/**
 * Criptografa o objeto serializável do auth. Se a chave NÃO estiver
 * configurada, retorna o próprio objeto (plaintext) e loga UM aviso.
 *
 * @param serializable objeto JSON-safe (ex: PersistedAuth já passado por
 *   BufferJSON.replacer).
 * @returns blob criptografado `EncryptedAuthBlob` OU o input inalterado.
 */
export function encryptAuthBlob(serializable: unknown): EncryptedAuthBlob | unknown {
  const key = resolveKey();
  if (!key) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      // eslint-disable-next-line no-console
      console.warn(
        '[auth-crypto] BAILEYS_AUTH_ENC_KEY não configurada — ' +
          'auth do Baileys será gravado em PLAINTEXT no banco. ' +
          'Configure a env var no Railway pra ativar AES-256-GCM.',
      );
    }
    return serializable;
  }

  const plaintext = Buffer.from(JSON.stringify(serializable), 'utf-8');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    v: ENC_VERSION,
    alg: ALG,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  } satisfies EncryptedAuthBlob;
}

/**
 * Descriptografa um blob no formato criptografado. Lança se a chave não
 * estiver configurada ou a autenticação GCM falhar (blob adulterado /
 * chave errada).
 *
 * @returns o objeto plaintext original (já JSON.parse-ado).
 */
export function decryptAuthBlob(blob: EncryptedAuthBlob): unknown {
  const key = resolveKey();
  if (!key) {
    throw new Error(
      'auth_encrypted_but_no_key: blob do auth está criptografado mas ' +
        'BAILEYS_AUTH_ENC_KEY não está configurada. Configure a env var ' +
        'com a mesma chave usada na gravação.',
    );
  }

  const iv = Buffer.from(blob.iv, 'base64');
  const tag = Buffer.from(blob.tag, 'base64');
  const data = Buffer.from(blob.data, 'base64');

  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(decrypted.toString('utf-8')) as unknown;
}

/**
 * Compara duas strings em tempo constante (evita timing-attack). Exportado
 * caso o worker precise validar segredos derivados no futuro.
 */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
