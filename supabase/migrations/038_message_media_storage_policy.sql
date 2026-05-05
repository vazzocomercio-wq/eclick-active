-- 038: Storage policy pra bucket `message-media`
--
-- ⚠️ APLICAR VIA SUPABASE STUDIO — NÃO funciona via _admin_exec_sql
-- (service_role não tem permissão em storage.objects).
--
-- Como aplicar:
--   1. Abre https://supabase.com/dashboard/project/<PROJECT>/sql/new
--   2. Cola o SQL abaixo
--   3. Roda
--
-- Por que precisa: backend hoje gera signed URLs de 30min via service_role,
-- então a policy é OPCIONAL pra fluxo atual funcionar. Mas habilitar essa
-- policy permite frontend autenticado baixar arquivos direto (sem precisar
-- passar pelo backend pra pedir nova signed URL toda vez que expira).
--
-- Idempotente: DROP IF EXISTS antes de CREATE.

DROP POLICY IF EXISTS message_media_org_read ON storage.objects;

CREATE POLICY message_media_org_read ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'message-media'
    AND (storage.foldername(name))[1] = active.get_user_org_id()::text
  );

-- (opcional) Permite que frontend autenticado faça UPLOAD direto pro bucket
-- caso a UI implemente upload de mídia pelo agente humano. Default é negar
-- (comentado) — habilitar só quando UI de upload existir.
-- DROP POLICY IF EXISTS message_media_org_write ON storage.objects;
-- CREATE POLICY message_media_org_write ON storage.objects
--   FOR INSERT
--   WITH CHECK (
--     bucket_id = 'message-media'
--     AND (storage.foldername(name))[1] = active.get_user_org_id()::text
--   );
