-- ============================================================
-- 008: Adiciona channel_type 'whatsapp_free' (Baileys)
-- ============================================================
-- Z-API é o canal WhatsApp pago oficial; 'whatsapp_free' é o
-- WhatsApp via protocolo Web (Baileys), sem custo por mensagem.
-- O worker mantém sessão persistente via WebSocket.
-- ============================================================

ALTER TABLE active.channels
  DROP CONSTRAINT IF EXISTS channels_channel_type_check;

ALTER TABLE active.channels
  ADD CONSTRAINT channels_channel_type_check
  CHECK (channel_type IN (
    'whatsapp', 'whatsapp_free', 'instagram', 'messenger', 'telegram',
    'email', 'webchat', 'tiktok', 'mercadolivre'
  ));

-- Índice parcial pra polling do worker: lista canais Baileys que
-- precisam ter sessão ativa em memória. Filtra disconnected/error
-- (worker só conecta active/pending).
CREATE INDEX IF NOT EXISTS idx_channels_baileys_active
  ON active.channels (org_id, id)
  WHERE channel_type = 'whatsapp_free'
    AND status IN ('active', 'pending');
