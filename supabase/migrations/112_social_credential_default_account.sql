-- 112 — Conta padrão por canal em social_channel_credentials
--
-- Contexto: quando uma org tem MAIS DE UMA conta ativa no mesmo canal, o
-- findActive() escolhia por `ORDER BY created_at DESC LIMIT 1` — ou seja, a
-- última conectada ganhava, sem ninguém decidir isso.
--
-- Efeito real (auditoria 23/08/2026, org Vazzo Comercio): o OAuth do Studio
-- Cortes importou de uma vez todas as 6 contas de Instagram que o usuário do
-- Facebook administra. Como todas nasceram em 31/05 e a @vazzooficial é de
-- 22/05, a conta padrão do Instagram da Vazzo virou a @s2trader — um perfil
-- sem relação com a loja, e ainda por cima com "User access is restricted".
-- Qualquer publicação agendada (o worker chama publishContent SEM alvo)
-- tentaria a conta errada. O mesmo vale pro TikTok, onde a padrão virou
-- @eclick_oficial em vez de @vazzobrasil.
--
-- A coluna torna a escolha EXPLÍCITA. O índice parcial garante no banco que
-- existe no máximo uma padrão por (org, canal) — não dá pra ficar ambíguo
-- por corrida entre dois writers.
--
-- Idempotente. Não marca ninguém como padrão: enquanto o lojista não
-- escolher, o findActive prefere falhar a adivinhar (ver
-- social-channel-credentials.service.ts).

ALTER TABLE active.social_channel_credentials
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN active.social_channel_credentials.is_default IS
  'Conta usada quando a publicação não escolhe alvo explícito. Máx. 1 por (org_id, channel) entre as ativas.';

-- Só uma padrão por org+canal, e só entre as ativas: desativar uma conta não
-- deve bloquear marcar outra como padrão.
CREATE UNIQUE INDEX IF NOT EXISTS social_channel_credentials_one_default_per_channel
  ON active.social_channel_credentials (org_id, channel)
  WHERE is_default AND is_active;

-- Busca do findActive: (org, canal, ativa) com a padrão na frente.
CREATE INDEX IF NOT EXISTS social_channel_credentials_org_channel_active
  ON active.social_channel_credentials (org_id, channel, is_active);
