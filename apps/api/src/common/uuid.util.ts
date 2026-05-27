const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Retorna o valor só se for um UUID válido; senão `null`.
 *
 * Uso: colunas uuid (ex.: social_contents.related_product_id) que recebem um
 * "ref de produto" que NEM SEMPRE é uuid. Produtos do catálogo SaaS têm id uuid;
 * produtos do TikTok Shop têm id numérico (string) e não existem na tabela de
 * produtos — então o link vira `null` (a geração segue por título/foto/desc).
 * Sem isso, gravar um id não-uuid numa coluna uuid estoura (erro 500).
 */
export function asUuidOrNull(value: string | null | undefined): string | null {
  return value && UUID_RE.test(value) ? value : null;
}
