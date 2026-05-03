-- ============================================================
-- 025: Canal TikTok — interações (comentários, follows, menções)
-- ============================================================
-- TikTok hoje não tem DM API aberta pra todos os apps. O canal funciona
-- como camada de engajamento: webhooks de comentários/follows criam
-- contatos + conversations no CRM. Cada comentário = uma mensagem.
-- Threads = conversation por (canal, vídeo, comment_id raiz).
--
-- Quando TikTok liberar Business Messages API (2026+), a tabela
-- tiktok_interactions ganha tipo 'dm' e a arquitetura plug-and-play.
-- ============================================================

CREATE TABLE IF NOT EXISTS active.tiktok_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES active.channels(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES active.contacts(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES active.conversations(id) ON DELETE SET NULL,
  interaction_type text NOT NULL
    CHECK (interaction_type IN ('comment', 'mention', 'follow', 'like', 'share', 'dm')),
  /** ID do vídeo do business onde a interação aconteceu (TikTok video_id) */
  video_id text,
  /** URL pública do vídeo — pra agente abrir no TikTok pelo card */
  video_url text,
  /** ID do comentário (TikTok comment_id) — usado em reply */
  comment_id text,
  /** ID do comentário pai quando esta é uma reply de reply (threading) */
  parent_comment_id text,
  content text,
  username text,
  user_avatar_url text,
  /** open_id do TikTok user (escopado por app) */
  external_user_id text,
  replied boolean NOT NULL DEFAULT false,
  reply_content text,
  /** Resultado da IA classifying: 'lead' | 'question' | 'praise' | 'complaint' | 'spam' */
  ai_intent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tiktok_interactions_org
  ON active.tiktok_interactions (org_id);
CREATE INDEX IF NOT EXISTS idx_tiktok_interactions_contact
  ON active.tiktok_interactions (contact_id);
CREATE INDEX IF NOT EXISTS idx_tiktok_interactions_video
  ON active.tiktok_interactions (org_id, video_id);
CREATE INDEX IF NOT EXISTS idx_tiktok_interactions_type
  ON active.tiktok_interactions (org_id, interaction_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tiktok_interactions_unanswered
  ON active.tiktok_interactions (org_id, created_at DESC)
  WHERE replied = false AND interaction_type = 'comment';
CREATE UNIQUE INDEX IF NOT EXISTS uq_tiktok_interactions_comment
  ON active.tiktok_interactions (org_id, channel_id, comment_id)
  WHERE comment_id IS NOT NULL;

ALTER TABLE active.tiktok_interactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_isolation" ON active.tiktok_interactions;
CREATE POLICY "org_isolation" ON active.tiktok_interactions
  FOR ALL USING (org_id = active.get_user_org_id());
