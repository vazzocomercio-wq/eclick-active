/**
 * Placeholder resolver compartilhado entre frontend e backend.
 *
 * Usado em:
 *   - Backend: automations.service (action `send_message` resolve antes de despachar)
 *   - Backend: message_templates (subject/body)
 *   - Backend: emails outbound (PARTE 3)
 *   - Frontend: preview no `<PlaceholderInput>` (mostra como ficaria com dados reais)
 *
 * Sintaxe:
 *   {{categoria.campo}}
 *
 * Categorias suportadas:
 *   - deal:    titulo, valor, stage, responsavel, numero, ai_score, ai_next_action
 *   - contato: nome, telefone, email, empresa, temperatura, ai_summary
 *   - empresa: nome, telefone, email, site
 *   - agente:  nome, telefone, email
 *   - custom.<NOME_DO_CAMPO> — lê de custom_fields jsonb
 *
 * Quando o placeholder não resolve:
 *   - `'empty'` (default): substitui por string vazia
 *   - `'keep'`: mantém o placeholder original (útil pra preview no editor)
 */

const PLACEHOLDER_REGEX = /\{\{(\w+)\.([\w-]+)\}\}/g;

export interface PlaceholderDealCtx {
  titulo?: string | null;
  valor?: number | null;
  stage?: string | null;
  responsavel?: string | null;
  numero?: number | null;
  ai_score?: number | null;
  ai_next_action?: string | null;
  custom_fields?: Record<string, unknown> | null;
}

export interface PlaceholderContactCtx {
  nome?: string | null;
  telefone?: string | null;
  email?: string | null;
  empresa?: string | null;
  temperatura?: 'cold' | 'warm' | 'hot' | 'very_hot' | null;
  ai_summary?: string | null;
  custom_fields?: Record<string, unknown> | null;
}

export interface PlaceholderCompanyCtx {
  nome?: string | null;
  telefone?: string | null;
  email?: string | null;
  site?: string | null;
  custom_fields?: Record<string, unknown> | null;
}

export interface PlaceholderAgentCtx {
  nome?: string | null;
  telefone?: string | null;
  email?: string | null;
}

export interface PlaceholderContext {
  deal?: PlaceholderDealCtx | null;
  contato?: PlaceholderContactCtx | null;
  empresa?: PlaceholderCompanyCtx | null;
  agente?: PlaceholderAgentCtx | null;
}

export interface ResolveOptions {
  /** Comportamento quando placeholder não tem valor — 'empty' (default) ou 'keep'. */
  missing?: 'empty' | 'keep';
}

/**
 * Resolve placeholders num template, substituindo {{categoria.campo}}
 * pelos valores em `context`. Retorna sempre uma string nova.
 */
export function resolvePlaceholders(
  template: string,
  context: PlaceholderContext,
  options: ResolveOptions = {},
): string {
  if (!template || !template.includes('{{')) return template;
  const missing = options.missing ?? 'empty';

  return template.replace(PLACEHOLDER_REGEX, (match, category: string, field: string) => {
    const resolved = lookup(context, category, field);
    if (resolved === undefined || resolved === null || resolved === '') {
      return missing === 'keep' ? match : '';
    }
    return String(resolved);
  });
}

function lookup(
  ctx: PlaceholderContext,
  category: string,
  field: string,
): unknown {
  // custom.<key> → procura em qualquer entidade que tenha custom_fields
  if (category === 'custom') {
    return (
      ctx.deal?.custom_fields?.[field] ??
      ctx.contato?.custom_fields?.[field] ??
      ctx.empresa?.custom_fields?.[field]
    );
  }

  switch (category) {
    case 'deal':
      return formatDealField(ctx.deal ?? null, field);
    case 'contato':
      return formatContactField(ctx.contato ?? null, field);
    case 'empresa':
      return formatCompanyField(ctx.empresa ?? null, field);
    case 'agente':
      return ctx.agente ? (ctx.agente as Record<string, unknown>)[field] : null;
    default:
      return null;
  }
}

function formatDealField(deal: PlaceholderDealCtx | null, field: string): unknown {
  if (!deal) return null;
  if (field === 'valor' && typeof deal.valor === 'number') {
    return deal.valor.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      maximumFractionDigits: 2,
    });
  }
  if (field === 'numero' && typeof deal.numero === 'number') {
    return `#${deal.numero}`;
  }
  return (deal as unknown as Record<string, unknown>)[field];
}

function formatContactField(c: PlaceholderContactCtx | null, field: string): unknown {
  if (!c) return null;
  if (field === 'temperatura' && c.temperatura) {
    return TEMP_LABEL[c.temperatura];
  }
  return (c as unknown as Record<string, unknown>)[field];
}

function formatCompanyField(c: PlaceholderCompanyCtx | null, field: string): unknown {
  if (!c) return null;
  return (c as unknown as Record<string, unknown>)[field];
}

const TEMP_LABEL: Record<NonNullable<PlaceholderContactCtx['temperatura']>, string> = {
  cold: 'frio',
  warm: 'morno',
  hot: 'quente',
  very_hot: 'muito quente',
};

// ──────────────────────────────────────────────────────────
// Catálogo pra UI de autocomplete
// ──────────────────────────────────────────────────────────

export interface PlaceholderCatalogItem {
  /** String inserida no template (ex: `{{deal.titulo}}`). */
  token: string;
  /** Rótulo amigável (ex: "Título do deal"). */
  label: string;
  /** Categoria pra agrupamento na UI. */
  category: 'deal' | 'contato' | 'empresa' | 'agente' | 'custom';
}

/**
 * Lista canônica de placeholders. UI usa pra dropdown agrupado.
 */
export const PLACEHOLDER_CATALOG: PlaceholderCatalogItem[] = [
  // Deal
  { token: '{{deal.titulo}}', label: 'Título do deal', category: 'deal' },
  { token: '{{deal.valor}}', label: 'Valor (R$)', category: 'deal' },
  { token: '{{deal.stage}}', label: 'Stage atual', category: 'deal' },
  { token: '{{deal.responsavel}}', label: 'Responsável atribuído', category: 'deal' },
  { token: '{{deal.numero}}', label: 'Número do deal', category: 'deal' },
  { token: '{{deal.ai_score}}', label: 'AI score', category: 'deal' },
  { token: '{{deal.ai_next_action}}', label: 'Próxima ação sugerida', category: 'deal' },

  // Contato
  { token: '{{contato.nome}}', label: 'Nome do contato', category: 'contato' },
  { token: '{{contato.telefone}}', label: 'Telefone', category: 'contato' },
  { token: '{{contato.email}}', label: 'Email', category: 'contato' },
  { token: '{{contato.empresa}}', label: 'Empresa', category: 'contato' },
  { token: '{{contato.temperatura}}', label: 'Temperatura', category: 'contato' },
  { token: '{{contato.ai_summary}}', label: 'Resumo IA', category: 'contato' },

  // Empresa
  { token: '{{empresa.nome}}', label: 'Nome da empresa', category: 'empresa' },
  { token: '{{empresa.telefone}}', label: 'Telefone', category: 'empresa' },
  { token: '{{empresa.email}}', label: 'Email', category: 'empresa' },
  { token: '{{empresa.site}}', label: 'Site', category: 'empresa' },

  // Agente
  { token: '{{agente.nome}}', label: 'Nome do agente', category: 'agente' },
  { token: '{{agente.telefone}}', label: 'Telefone', category: 'agente' },
  { token: '{{agente.email}}', label: 'Email', category: 'agente' },
];
