import * as crypto from 'node:crypto';

/**
 * Cifragem AES-256-GCM genérica pra qualquer secret armazenado no DB.
 * Usado por:
 *   - org_llm_credentials.api_key_ciphertext (Bloco A)
 *   - ad_integrations.access_token_ciphertext / refresh_token_ciphertext (Bloco B)
 *
 * Formato armazenado: base64(iv(12) || authTag(16) || ciphertext).
 *
 * Chave: env `LLM_CRED_ENCRYPTION_KEY` (32 bytes em hex = 64 chars).
 * Apesar do nome legacy, é a chave única de criptografia da app — gerada
 * uma vez com:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Rotacionar a chave invalida TODOS os secrets cifrados — escrever migração
 * que decifra com a antiga e re-cifra com a nova antes de trocar a env.
 */

const IV_LEN = 12;
const TAG_LEN = 16;
const ENV_NAME = 'LLM_CRED_ENCRYPTION_KEY';

function getKey(): Buffer {
  const hex = process.env[ENV_NAME];
  if (!hex) {
    throw new Error(
      `${ENV_NAME} ausente — gere com: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  if (hex.length !== 64) {
    throw new Error(`${ENV_NAME} precisa ter 64 hex chars (32 bytes)`);
  }
  return Buffer.from(hex, 'hex');
}

/** Cifra string em base64(iv||tag||ct). */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

/** Decifra base64(iv||tag||ct) → plaintext. */
export function decryptSecret(payload: string): string {
  const key = getKey();
  const buf = Buffer.from(payload, 'base64');
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error('Ciphertext malformado');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

/** Pega últimos N chars (default 4) — pra UI mostrar "sk-...XXXX" sem expor o resto. */
export function lastFour(value: string, n = 4): string {
  return value.slice(-n);
}

// ─────────────────────────────────────────────────────────────
// HMAC-SHA256 — usado pra assinar OAuth state CSRF tokens, etc.
// Reusa a mesma chave master.
// ─────────────────────────────────────────────────────────────

export function hmacSign(payload: string): string {
  const key = getKey();
  return crypto.createHmac('sha256', key).update(payload).digest('base64url');
}

/** Compara em tempo constante (timing-safe). */
export function hmacVerify(payload: string, signature: string): boolean {
  const expected = hmacSign(payload);
  if (expected.length !== signature.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}
