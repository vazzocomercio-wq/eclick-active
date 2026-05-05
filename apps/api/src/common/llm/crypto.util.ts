/**
 * Shim de retrocompatibilidade. A util de cripto migrou pra
 * `common/crypto/aes-gcm.util.ts` (genérica, usada também por ad_integrations).
 * Mantemos os exports antigos pra não quebrar imports existentes.
 */
import {
  encryptSecret,
  decryptSecret,
  lastFour as lastFourCommon,
} from '../crypto/aes-gcm.util';

export const encryptApiKey = encryptSecret;
export const decryptApiKey = decryptSecret;
export const lastFour = lastFourCommon;
