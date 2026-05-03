import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';

const ALGO = 'aes-256-gcm';
const logger = new Logger('CryptoHelper');

/**
 * Deriva chave AES-256 a partir da ENCRYPTION_KEY env var. SHA-256 da string
 * pra garantir 32 bytes mesmo se a env tiver tamanho arbitrário.
 *
 * Em dev sem env var configurada, usa "DEV_FALLBACK_KEY" — emite warning.
 */
function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'ENCRYPTION_KEY env var é obrigatória em produção pra criptografar tokens OAuth',
      );
    }
    logger.warn('ENCRYPTION_KEY ausente — usando fallback de DEV. NÃO USE EM PROD.');
    return createHash('sha256').update('DEV_FALLBACK_KEY_DO_NOT_USE_IN_PROD').digest();
  }
  return createHash('sha256').update(raw).digest();
}

/**
 * Criptografa string em formato `iv:authTag:cipherText` (base64).
 * Token vazio/null retorna null sem encriptar.
 */
export function encryptToken(plain: string | null | undefined): string | null {
  if (!plain) return null;
  const key = getKey();
  const iv = randomBytes(12); // 96-bit recomendado pra GCM
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${enc.toString('base64')}`;
}

/**
 * Descriptografa formato gerado por encryptToken. Retorna null se input
 * for null/inválido — caller decide se trata como erro fatal.
 */
export function decryptToken(encrypted: string | null | undefined): string | null {
  if (!encrypted) return null;
  try {
    const [ivStr, tagStr, cipherStr] = encrypted.split(':');
    if (!ivStr || !tagStr || !cipherStr) return null;
    const key = getKey();
    const iv = Buffer.from(ivStr, 'base64');
    const authTag = Buffer.from(tagStr, 'base64');
    const cipherText = Buffer.from(cipherStr, 'base64');
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    const dec = Buffer.concat([decipher.update(cipherText), decipher.final()]);
    return dec.toString('utf8');
  } catch (err) {
    logger.error(`decryptToken failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Encripta o `state` do OAuth flow pra carregar org_id + agent_id
 * sem expor em querystring legível. Inclui timestamp pra rejeitar
 * states muito antigos (replay attack mitigation).
 */
export function encodeOAuthState(payload: { org_id: string; agent_id: string }): string {
  const json = JSON.stringify({ ...payload, ts: Date.now() });
  const enc = encryptToken(json);
  if (!enc) throw new Error('Falha ao gerar state OAuth');
  // base64url-safe pra usar em querystring
  return enc.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function decodeOAuthState(state: string): { org_id: string; agent_id: string } | null {
  try {
    const restored = state.replace(/-/g, '+').replace(/_/g, '/');
    const json = decryptToken(restored);
    if (!json) return null;
    const parsed = JSON.parse(json) as { org_id: string; agent_id: string; ts: number };
    // Rejeita states com mais de 10min
    if (Date.now() - parsed.ts > 10 * 60 * 1000) return null;
    return { org_id: parsed.org_id, agent_id: parsed.agent_id };
  } catch {
    return null;
  }
}
