import * as crypto from 'node:crypto';

/**
 * Cifragem AES-256-GCM pras API keys de LLM em org_llm_credentials.
 *
 * Formato armazenado: base64(iv(12) || authTag(16) || ciphertext).
 *
 * Chave: env LLM_CRED_ENCRYPTION_KEY (32 bytes em hex = 64 chars).
 * Gerar uma vez com:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Importante: rotacionar a chave invalida TODAS as creds existentes — se
 * isso for necessário no futuro, escrever migração explícita que decifra
 * com a chave antiga e re-cifra com a nova antes de trocar a env.
 */

const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const hex = process.env.LLM_CRED_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      'LLM_CRED_ENCRYPTION_KEY ausente — gere com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  if (hex.length !== 64) {
    throw new Error('LLM_CRED_ENCRYPTION_KEY precisa ter 64 hex chars (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

export function encryptApiKey(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptApiKey(payload: string): string {
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

/** Pega últimos 4 chars da api_key pra UI (sem expor o resto). */
export function lastFour(apiKey: string): string {
  return apiKey.slice(-4);
}
