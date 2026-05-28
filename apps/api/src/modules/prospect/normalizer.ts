/**
 * Normalizadores puros (sem IO) usados pelo entity resolver e collectors.
 *
 * Regras canônicas pra fontes diferentes baterem na mesma chave:
 *  • CNPJ/CPF: só dígitos.
 *  • Telefone: E.164 BR (+55 + DDD + número), 11 ou 13 chars total.
 *  • Email: lowercase + trim.
 *  • Nome p/ embedding: lowercase + remove acentos + normaliza pontuação.
 */

export const onlyDigits = (s: string | null | undefined): string =>
  (s ?? '').replace(/\D+/g, '');

export function normalizePhoneBR(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = onlyDigits(raw);
  if (!d) return null;
  // já vem com +55
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    return `+${d}`;
  }
  // sem DDI — assume BR
  if (d.length === 10 || d.length === 11) {
    return `+55${d}`;
  }
  return null; // formato desconhecido
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  if (!t.includes('@') || t.includes(' ')) return null;
  return t;
}

/**
 * Normaliza nome pra geração de embedding (entity resolution semântica):
 * lowercase, sem acentos, sem pontuação extra, single space.
 * Mantém termos significativos (LTDA, ME, EIRELI) — ajuda a desambiguar.
 */
export function normalizeNameForEmbedding(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')           // remove diacríticos
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')         // pontuação → espaço
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Para entity resolution probabilística: chave estável de endereço.
 * Combina cidade + UF + CEP + primeira parte do logradouro (lower, no diacritic).
 */
export function addressKey(addr: Record<string, unknown> | null | undefined): string | null {
  if (!addr) return null;
  const norm = (s: unknown) =>
    String(s ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim();
  const parts = [
    norm(addr['cidade']),
    norm(addr['uf']),
    norm(addr['cep']).replace(/\D+/g, ''),
    norm(addr['logradouro']).split(/[\s,]+/)[0] ?? '',
  ].filter(Boolean);
  return parts.length >= 2 ? parts.join('|') : null;
}
