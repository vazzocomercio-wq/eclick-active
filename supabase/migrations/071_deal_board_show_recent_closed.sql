-- 071_deal_board_show_recent_closed.sql
--
-- Bug: a view active.v_deal_board (que alimenta o kanban) excluía TODO deal
-- ganho/perdido (WHERE won_at IS NULL AND lost_at IS NULL). As colunas
-- "Ganho"/"Perdido" do board ficavam sempre vazias — qualquer card movido pra
-- elas era filtrado pra fora e "sumia" do kanban inteiro.
--
-- Fix: a view passa a incluir deals fechados nos últimos 30 dias, então o card
-- aparece na coluna terminal correspondente. Deals fechados mais antigos saem
-- pra não inchar o board. Também expõe won_at/lost_at pra que o backend
-- distinga ativo de fechado (ex: somar só ativos no summary do funil).

CREATE OR REPLACE VIEW active.v_deal_board AS
SELECT
  d.id,
  d.org_id,
  d.pipeline_id,
  d.stage_id,
  d.title,
  d.value,
  d.currency,
  d.expected_close_date,
  d.ai_score,
  d.ai_risk,
  d.ai_next_action,
  d.ai_close_probability,
  d.tags,
  d.position,
  d.stage_entered_at,
  d.created_at,
  -- Contact
  ct.id AS contact_id,
  ct.name AS contact_name,
  ct.phone AS contact_phone,
  ct.avatar_url AS contact_avatar,
  ct.temperature AS contact_temperature,
  -- Company
  co.id AS company_id,
  co.name AS company_name,
  -- Stage
  ps.name AS stage_name,
  ps.color AS stage_color,
  ps.position AS stage_position,
  ps.probability AS stage_probability,
  ps.sla_hours,
  -- Assignment
  om.display_name AS agent_name,
  om.avatar_url AS agent_avatar,
  -- Time in stage
  EXTRACT(EPOCH FROM (now() - d.stage_entered_at)) / 3600 AS hours_in_stage,
  -- SLA breach flag
  CASE
    WHEN ps.sla_hours IS NOT NULL
      AND EXTRACT(EPOCH FROM (now() - d.stage_entered_at)) / 3600 > ps.sla_hours
    THEN true
    ELSE false
  END AS sla_breached,
  -- Estado terminal: NULL = ativo. Backend usa pra somar só ativos no summary.
  d.won_at,
  d.lost_at
FROM active.deals d
  LEFT JOIN active.contacts ct ON ct.id = d.contact_id
  LEFT JOIN active.companies co ON co.id = d.company_id
  LEFT JOIN active.pipeline_stages ps ON ps.id = d.stage_id
  LEFT JOIN active.org_members om ON om.user_id = d.assigned_to AND om.org_id = d.org_id
WHERE
  -- Deal ativo (não fechado)
  (d.won_at IS NULL AND d.lost_at IS NULL)
  -- OU fechado recentemente (≤ 30 dias) — fica visível na coluna terminal
  OR COALESCE(d.won_at, d.lost_at) > (now() - INTERVAL '30 days');
