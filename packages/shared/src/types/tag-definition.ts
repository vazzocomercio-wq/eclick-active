/**
 * Catálogo de tags da org. Cada org tem 2 espaços separados:
 *   - entity_type='contact' → fala sobre o contato (perfil, segmento)
 *   - entity_type='deal'    → fala sobre o card/deal (qualificação, necessidades)
 *
 * Os arrays `tags` em `contacts` e `deals` continuam denormalizados (text[])
 * pra leitura rápida no kanban e listas; esta tabela é o catálogo MASTER
 * que define visual, descrição, categoria e contagem de uso.
 */
export type TagEntityType = 'contact' | 'deal';

export interface TagDefinition {
  id: string;
  org_id: string;
  entity_type: TagEntityType;
  /** Texto visível pro usuário (ex: "Convênio Gama"). 1-60 chars. */
  label: string;
  /** Slug estável usado no array `tags` (ex: "CONVENIO_GAMA"). UPPERCASE_SNAKE_CASE. */
  slug: string;
  /**
   * Cor opcional. Quando NULL o frontend usa hash automático do TagPills
   * (paleta 8 cores curadas). Quando preenchido pode ser hex (#RRGGBB)
   * ou um dos 8 nomes da paleta: amber, emerald, sky, violet, rose, cyan,
   * fuchsia, orange.
   */
  color: string | null;
  description: string | null;
  category: string | null;
  usage_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTagDefinitionDto {
  entity_type: TagEntityType;
  label: string;
  /** Opcional — se omitido, gerado automaticamente do label. */
  slug?: string;
  color?: string | null;
  description?: string | null;
  category?: string | null;
}

export interface UpdateTagDefinitionDto {
  label?: string;
  color?: string | null;
  description?: string | null;
  category?: string | null;
}

/**
 * Usado pelo Concierge IA: passa lista de slugs gerados pela IA, backend
 * cria entradas que ainda não existem no catálogo (label = slug humanizado),
 * incrementa usage_count nas existentes, retorna lista completa.
 */
export interface UpsertTagDefinitionsDto {
  entity_type: TagEntityType;
  slugs: string[];
}
