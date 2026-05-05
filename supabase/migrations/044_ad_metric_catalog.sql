-- ============================================================
-- 044: ad_metric_catalog — catálogo curado de métricas (read-only)
-- ============================================================
-- Bloco E do Active Intelligence: catálogo das métricas que o user
-- pode monitorar. Read-only do ponto de vista da app — atualizado via
-- migration quando provider lançar métrica nova.
--
-- direction = higher_better | lower_better (orienta interpretação
--   do threshold: ROAS abaixo do alvo = ruim; CPA acima do alvo = ruim)
-- aggregation = sum | avg | last (como agregar entre dias na janela)
-- data_type = currency | int | percent | ratio | text
-- unit = USD | BRL | count | pct | etc. (label na UI)
--
-- Seed: ~40 métricas core (Meta + Google). Outras podem ser adicionadas
-- via UPDATE em migrations futuras sem mudar schema.
-- ============================================================

CREATE TABLE IF NOT EXISTS active.ad_metric_catalog (
  key            text PRIMARY KEY,
  platform       text NOT NULL CHECK (platform IN ('meta', 'google', 'shared')),
  display_name   text NOT NULL,
  description    text NOT NULL,
  data_type      text NOT NULL CHECK (data_type IN ('currency', 'int', 'percent', 'ratio', 'text')),
  direction      text NOT NULL CHECK (direction IN ('higher_better', 'lower_better', 'neutral')),
  aggregation    text NOT NULL CHECK (aggregation IN ('sum', 'avg', 'last')),
  unit           text NOT NULL,
  /** Categoria pra agrupar na UI: spend / reach / engagement / conversion / quality / video */
  category       text NOT NULL,
  /** Se a métrica é "core" (vira default em new orgs) ou "advanced" (opt-in). */
  is_core        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_metric_catalog_platform
  ON active.ad_metric_catalog (platform, category);

-- ─────────────────────────────────────────────────────────────
-- Seed: métricas core (Meta + Google + shared)
-- ─────────────────────────────────────────────────────────────

INSERT INTO active.ad_metric_catalog
  (key, platform, display_name, description, data_type, direction, aggregation, unit, category, is_core)
VALUES
  -- ── Spend (shared) ──
  ('spend',                'shared', 'Investimento',          'Valor total gasto na campanha', 'currency', 'neutral',       'sum',  'USD',   'spend',      true),
  ('daily_budget',         'shared', 'Orçamento diário',      'Limite diário definido na campanha', 'currency', 'neutral', 'last', 'USD',   'spend',      false),
  ('lifetime_budget',      'shared', 'Orçamento total',       'Limite total da campanha', 'currency', 'neutral',          'last', 'USD',   'spend',      false),

  -- ── Reach / Awareness (shared) ──
  ('impressions',          'shared', 'Impressões',            'Quantas vezes os anúncios foram exibidos', 'int', 'higher_better', 'sum', 'count', 'reach', true),
  ('reach',                'meta',   'Pessoas alcançadas',    'Pessoas únicas que viram seus anúncios', 'int', 'higher_better', 'sum', 'count', 'reach', true),
  ('frequency',            'meta',   'Frequência',            'Média de vezes que cada pessoa viu o anúncio', 'ratio', 'lower_better', 'last', 'count', 'reach', true),
  ('cpm',                  'shared', 'CPM',                   'Custo por mil impressões', 'currency', 'lower_better', 'avg', 'USD', 'reach', true),
  ('cpp',                  'meta',   'CPP',                   'Custo por mil pessoas alcançadas', 'currency', 'lower_better', 'avg', 'USD', 'reach', false),

  -- ── Engagement (shared) ──
  ('clicks',               'shared', 'Cliques',               'Total de cliques nos anúncios', 'int',     'higher_better', 'sum', 'count', 'engagement', true),
  ('ctr',                  'shared', 'CTR',                   'Click-through rate (cliques / impressões)', 'percent', 'higher_better', 'avg', 'pct', 'engagement', true),
  ('cpc',                  'shared', 'CPC',                   'Custo por clique', 'currency', 'lower_better', 'avg', 'USD', 'engagement', true),
  ('link_clicks',          'meta',   'Cliques no link',       'Cliques que levaram pra fora do Meta (link_clicks no Meta)', 'int', 'higher_better', 'sum', 'count', 'engagement', false),
  ('link_ctr',             'meta',   'CTR de link',           'Cliques no link / impressões', 'percent', 'higher_better', 'avg', 'pct', 'engagement', false),
  ('engagement_rate',      'meta',   'Taxa de engajamento',   'Engajamentos (reactions, comments, shares) / impressões', 'percent', 'higher_better', 'avg', 'pct', 'engagement', false),
  ('post_engagements',     'meta',   'Engajamentos no post',  'Soma de reações, comentários e compartilhamentos', 'int', 'higher_better', 'sum', 'count', 'engagement', false),

  -- ── Conversion (shared) ──
  ('conversions',          'shared', 'Conversões',            'Total de conversões atribuídas', 'int', 'higher_better', 'sum', 'count', 'conversion', true),
  ('cost_per_conversion',  'shared', 'CPA',                   'Custo médio por conversão (cost per action)', 'currency', 'lower_better', 'avg', 'USD', 'conversion', true),
  ('conversion_rate',      'shared', 'Taxa de conversão',     'Conversões / cliques', 'percent', 'higher_better', 'avg', 'pct', 'conversion', true),
  ('roas',                 'shared', 'ROAS',                  'Retorno sobre o gasto em ads (receita / spend)', 'ratio', 'higher_better', 'avg', 'x', 'conversion', true),
  ('conversion_value',     'shared', 'Receita atribuída',     'Soma do valor das conversões', 'currency', 'higher_better', 'sum', 'USD', 'conversion', false),
  ('lead_count',           'shared', 'Leads',                 'Conversões do tipo lead/registration', 'int', 'higher_better', 'sum', 'count', 'conversion', true),
  ('cost_per_lead',        'shared', 'CPL',                   'Custo por lead', 'currency', 'lower_better', 'avg', 'USD', 'conversion', true),
  ('purchases',            'shared', 'Compras',               'Conversões do tipo purchase', 'int', 'higher_better', 'sum', 'count', 'conversion', false),
  ('cost_per_purchase',    'shared', 'Custo por compra',      'Spend / purchases', 'currency', 'lower_better', 'avg', 'USD', 'conversion', false),

  -- ── Video (Meta) ──
  ('video_plays',          'meta',   'Reproduções de vídeo',  'Vezes que o vídeo começou a tocar', 'int', 'higher_better', 'sum', 'count', 'video', false),
  ('video_p25_watched',    'meta',   'Vídeos 25% assistidos', 'Visualizações que chegaram a 25%', 'int', 'higher_better', 'sum', 'count', 'video', false),
  ('video_p50_watched',    'meta',   'Vídeos 50% assistidos', 'Visualizações que chegaram a 50%', 'int', 'higher_better', 'sum', 'count', 'video', false),
  ('video_p75_watched',    'meta',   'Vídeos 75% assistidos', 'Visualizações que chegaram a 75%', 'int', 'higher_better', 'sum', 'count', 'video', false),
  ('video_p100_watched',   'meta',   'Vídeos completos',      'Visualizações que chegaram a 100%', 'int', 'higher_better', 'sum', 'count', 'video', false),
  ('video_avg_play_time',  'meta',   'Tempo médio de vídeo',  'Tempo médio (s) que o vídeo ficou tocando', 'ratio', 'higher_better', 'avg', 's', 'video', false),

  -- ── Quality rankings (Meta) ──
  ('quality_ranking',          'meta', 'Ranking de qualidade',     'Como o criativo se compara aos anúncios concorrentes (above_average / average / below_average)', 'text', 'higher_better', 'last', 'rank', 'quality', false),
  ('engagement_rate_ranking',  'meta', 'Ranking de engajamento',   'Engajamento esperado vs concorrentes', 'text', 'higher_better', 'last', 'rank', 'quality', false),
  ('conversion_rate_ranking',  'meta', 'Ranking de conversão',     'Taxa de conversão esperada vs concorrentes', 'text', 'higher_better', 'last', 'rank', 'quality', false),

  -- ── Google-specific ──
  ('search_impression_share',     'google', 'Impression share', 'Impressions / total disponível na busca', 'percent', 'higher_better', 'avg', 'pct', 'reach', true),
  ('search_top_impression_share', 'google', 'Top impression share', 'Impressions na parte superior dos resultados', 'percent', 'higher_better', 'avg', 'pct', 'reach', false),
  ('quality_score',               'google', 'Quality score',        'Nota de qualidade do anúncio (1-10)', 'int', 'higher_better', 'avg', 'score', 'quality', false),
  ('search_lost_is_budget',       'google', 'Impressões perdidas (orçamento)', 'Pct de impressions perdidas por orçamento limitado', 'percent', 'lower_better', 'avg', 'pct', 'spend', false),
  ('search_lost_is_rank',         'google', 'Impressões perdidas (ranking)', 'Pct de impressions perdidas por ranking baixo', 'percent', 'lower_better', 'avg', 'pct', 'quality', false),
  ('absolute_top_impression_pct', 'google', 'Posição absoluta superior', 'Impressions no topo absoluto', 'percent', 'higher_better', 'avg', 'pct', 'reach', false)
ON CONFLICT (key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description  = EXCLUDED.description,
  data_type    = EXCLUDED.data_type,
  direction    = EXCLUDED.direction,
  aggregation  = EXCLUDED.aggregation,
  unit         = EXCLUDED.unit,
  category     = EXCLUDED.category,
  is_core      = EXCLUDED.is_core;

COMMENT ON TABLE active.ad_metric_catalog IS
  'Catálogo curado de métricas. Read-only do ponto de vista da app — atualizar via migration UPDATE quando provider lançar nova.';
