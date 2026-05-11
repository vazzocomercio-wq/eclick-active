# HANDOFF — eclick-active

> Documento vivo de continuidade entre sessões. **Lê isso primeiro ao começar nova sessão.**
> Última atualização: **2026-05-06** (Onda 4 / A3 — Automation Bridge SaaS↔Active entregue + smoke test ok)

---

## 🆕 ENTREGA DESTA SESSÃO — Onda 4 / A3 (Automation Bridge)

**Status: 100% COMPLETO E VALIDADO EM PROD.** SaaS já tem envs configuradas, aguardando Sprint 4 do motor `StoreAutomationEngine`.

### O que foi feito
Receivers no Active pra que o `StoreAutomationEngine` do SaaS (projeto `eclick-backend`) dispare ações que dependem da infra WhatsApp/cart do Active.

**Endpoints novos** (server-to-server, autenticados via shared secret):
- `POST /commerce/automation-bridge/notify-lojista` — notifica owner da org no WhatsApp
  - Severity `critical|high` → envio imediato
  - Severity `medium` → fila pra digest 4h
  - Severity `low|opportunity` → fila pra digest diário 9h
- `POST /commerce/automation-bridge/trigger-cart-recovery` — dispara WhatsApp pra carrinhos abandonados
  - Aceita `cart_ids[]` direto OU segmento (`abandoned_24h|48h|7d`)
  - Sequencial com `rate_limit_ms` configurável; pula carts convertidos/cancelados

**Arquivos novos**:
- `supabase/migrations/068_automation_bridge.sql` — tabela `active.automation_executions` (audit trail)
- `apps/api/src/modules/automation-bridge/`:
  - `automation-bridge.types.ts` — DTOs + interface `OrgAutomationBridgeSettings`
  - `automation-bridge.guard.ts` — valida header `X-Automation-Bridge-Token` (constant-time compare, fail-safe)
  - `automation-bridge.service.ts` — `notifyLojista`, `triggerCartRecovery`, `runDigest`, `resolveOwnerTarget`
  - `automation-bridge.controller.ts` — 2 POST sob `/commerce/automation-bridge/*` (sem AuthGuard, só Guard de secret)
  - `notify-digest.worker.ts` — setInterval 4h (medium) + 30min check pro daily 9h
  - `automation-bridge.module.ts` — registrado em `app.module.ts`

**Arquivos modificados**:
- `apps/api/src/app.module.ts` — `+ AutomationBridgeModule`
- `apps/api/src/modules/automations/automations.service.ts` — bugfix B6 (`sendCommerceMessage`)
- `apps/api/.env.example` — `AUTOMATION_BRIDGE_SECRET=` + `DISABLE_AUTOMATION_DIGEST_WORKER`

### Bugfix relevante (Onda 2 também)
O resolver de canal WhatsApp filtrava `channel_type='whatsapp'` + `is_active=true`. Mas:
- Active usa `channel_type='whatsapp_free'` (Baileys) **e** `'whatsapp'` (Z-API) — precisa do `.in([...])`
- Coluna correta é `status` (text) com valor `'active'` — não existe `is_active`

Corrigido nos dois lugares (bridge novo + B6 antigo) no commit `7c8b2f5`.

### Configuração operacional (já feita)

**Active Railway (`active-api`)**: env `AUTOMATION_BRIDGE_SECRET` configurada (gerada com `openssl rand -hex 32`).

**SaaS Railway (`eclick-backend`)**: envs configuradas
- `ACTIVE_AUTOMATION_BRIDGE_SECRET` (deve bater com a do Active — verificar visualmente comparando primeiros/últimos 8 chars)
- `ACTIVE_AUTOMATION_BRIDGE_URL=https://api.active.eclick.app.br`

**Org Vazzo configurada** via SQL:
```sql
UPDATE active.organizations
SET settings = settings || jsonb_build_object(
  'automation_bridge', jsonb_build_object(
    'owner_contact_id', '<UUID_DO_CONTATO_SILVIO>'
  )
)
WHERE name ILIKE '%vazzo%';
```
Contato `Silvio Júnior` com phone `5571993167000` virou owner notification target.

### Smoke tests validados ✅

1. **Critical → imediato**: `curl POST /notify-lojista severity=critical` → mensagem chegou no WhatsApp do Silvio (5571993167000)
2. **Medium → digest queue**: `curl POST /notify-lojista severity=medium` → row criada em `automation_executions` com status=pending, queued_for_digest=true (vai disparar no próximo tick 4h)
3. **Cart recovery vazio**: `curl POST /trigger-cart-recovery segment=abandoned_24h` → dispatched=0 (sem carts no momento, comportamento correto)
4. **Audit trail**: rows persistidas corretamente em `active.automation_executions` com payload, severity, status, digest_id

### Pendências externas (não bloqueia Active)

- **SaaS Sprint 4**: enable auto-execution do `StoreAutomationEngine` chamando os endpoints. Quando o time SaaS terminar, basta. Não tem trabalho aqui no Active.
- **UI opcional futura**: `/configuracoes/integracoes` ganhar seção pra editar `automation_bridge.owner_contact_id` (hoje só via SQL)

### ✅ Dívida de segurança RESOLVIDA — secret rotacionado (2026-05-11)

O `AUTOMATION_BRIDGE_SECRET` foi rotacionado com sucesso:

- Novo secret gerado (32 bytes hex aleatórios)
- Aplicado nos **dois** Railways simultaneamente:
  - `active-api` → env `AUTOMATION_BRIDGE_SECRET`
  - `eclick-backend` (SaaS) → env `ACTIVE_AUTOMATION_BRIDGE_SECRET`
- Smoke tests validados:
  - `POST /commerce/automation-bridge/notify-lojista` com secret novo → HTTP 200 (`execution_id` persistido em `automation_executions`)
  - Mesmo endpoint com secret antigo → HTTP 401 (guard rejeita)

O secret atual NÃO foi colado em chat/screenshot. Se precisar rotacionar de novo no futuro, repita o mesmo processo (gerar com `openssl rand -hex 32`, atualizar os 2 Railways, smoke test).

### Commits desta sessão
```
9661132  feat(automation-bridge): A3 SaaS↔Active receivers + digest worker
7c8b2f5  fix(channels): whatsapp_free + status='active' em bridge e B6
1db3656  fix(automation-bridge): drop FK org_id (referência LÓGICA cross-project)
```

### Bugfix pós-deploy — FK física em `automation_executions.org_id`

**Sintoma**: inserts vindos do SaaS quebravam com FK violation em `automation_executions_org_id_fkey`.

**Causa**: o SaaS dispara com seu próprio `organization_id` (`public.organizations` do projeto SaaS), que não bate com nenhuma row em `active.organizations`. Apesar de o Supabase Auth ser compartilhado, os schemas têm tabelas de orgs DISTINTAS — a referência é lógica, não física.

**Fix**: migration `069_automation_bridge_drop_org_fk.sql`
```sql
ALTER TABLE active.automation_executions
  DROP CONSTRAINT IF EXISTS automation_executions_org_id_fkey;
```
Mantém o índice `idx_auto_exec_org` (não é tocado pelo DROP CONSTRAINT).

**Validação**: insert com `org_id='00000000-0000-0000-0000-000000000001'` (UUID inexistente em active.organizations) passou após o drop. Cleanup feito.

**Smoke test SaaS-side esperado** após este fix: `GET /store-automation/bridge-health` deve retornar `{ configured: true, reachable: true, authenticated: true, response: { ok: true, queued_for_digest: true } }`.

---

## 🎯 Próximo trabalho planejado

**Active Intelligence (Ads & Social Analytics + Hub)** — **TODOS os 8 blocos entregues + UI completa**.

📄 **Doc canônico**: [`docs/analytics-design.md`](./docs/analytics-design.md)

Estado:
- ✅ **Bloco A** (LlmProvider abstraction) — A.1 + A.2
- ✅ **Bloco B** (Ad Integrations + OAuth Meta) — OAuth flow Meta funcional
- ✅ **Bloco C** (Meta Connector + Sync) — campaigns + insights diários, cron 1h, backfill 90d
- ✅ **Bloco D** (Google Ads Connector) — código pronto; ATIVAÇÃO precisa de `GOOGLE_ADS_DEVELOPER_TOKEN` (3-7d approval)
- ✅ **Bloco E** (Metric Catalog + Configs) — 40 métricas core seeded
- ✅ **Bloco F** (Lead Ads Webhook) — código pronto; ATIVAÇÃO precisa de app Meta + `META_WEBHOOK_VERIFY_TOKEN`
- ✅ **Bloco G** (Signal Detector) — 3 camadas + worker 15min + dedupe diário + lead_unattended (depende de F estar ativo)
- ✅ **Bloco H** (Alert Managers + Engine + Camada 4 LLM) — fecha o ciclo. Worker 5min immediate + slot horário
- ✅ **Cold outbound fix** — `resolveJid` via `onWhatsApp` no worker Baileys. Desbloqueou `/conversa/nova` E o verify-phone
- ✅ **UI** — 3 telas em `/configuracoes`:
  - **Integrações de Ads** — conectar Meta/Google + sync manual + desconectar
  - **Métricas Monitoradas** — catálogo agrupado por categoria, toggle enabled, configurar threshold (manual/auto), warning/critical pcts, janela
  - **Inteligência (Alertas)** — 4 tabs: Gestores (CRUD + verify-phone), Regras (signal_type→managers), Sinais (read-only + ack + detect manual), Entregas (listing com texto consolidado)

Sprint principal **completo**. Tudo aguardando envs externas pra ativar produção real.
- ⚠️ **Solicitar `GOOGLE_ADS_DEVELOPER_TOKEN` agora** via https://ads.google.com/aw/apicenter
- ⚠️ **Configurar app Meta** em developers.facebook.com (Business type)
- Decisões 1-7 fechadas (ver doc)
- ⚠️ **NÃO** confundir com Intelligence Hub do `eclick-backend` (SaaS) — em prod lá, projeto distinto

### Bloco H entregue — sumário

- Migrations 048 (`alert_managers`), 049 (`alert_routing_rules`), 050 (`alert_deliveries`)
- `alerts/alert-managers.service.ts` — CRUD + verificação de phone via WhatsApp:
  - Código 6 dígitos + expires 10min, throttle 1min entre reenvios
  - **Usa cold outbound fix** — manda código pelo `ChannelDispatcher.send` mesmo pra phone que nunca conversou
  - `phone_masked` na resposta da API (oculta dígitos por padrão)
- `alerts/alert-routing.service.ts` — CRUD rules + `resolveRecipients()`:
  - Match por `signal_type` (exato ou `*`) + `min_severity`
  - Dedupe por manager (rule de menor `priority` vence)
- `alerts/message-formatter.ts` — Camada 4:
  - `formatImmediate()` (1 signal) e `formatDigest()` (N signals consolidados)
  - Cache de 60s pra `org_llm_credentials` lookup
  - Fallback determinístico (`narrator='template'`) preserva entrega quando LLM não configurado
- `alerts/alert-engine.service.ts` — pipeline 3 etapas:
  - `processSignals(orgId)` — pega `ad_signals` pending → routing → cria deliveries (immediate ou deferred)
  - `dispatchPending(orgId)` — pega deliveries com `message_text` pronto → dispatch via `ChannelDispatcher`. Retry com backoff (max 3)
  - `processDigestSlot(orgId, slot)` — agrupa deferred do dia em 1 delivery consolidado por manager
  - `business_hours_only` flag converte alerts fora de 8-20h pro digest_8h
- `alerts/alert-engine.worker.ts` — 2 ciclos:
  - `tickImmediate` 5min — processSignals + dispatchPending
  - `tickSlot` 1h — checa hora local da org (via `getOrgTimezone`) → dispara slots `digest_8h/14h/18h` + `weekly` (segunda 8h)
  - Anti-double-fire por `${orgId}:${slot}:${date}:${hour}` Set
  - `DISABLE_ALERT_ENGINE_WORKER=true` desliga em dev
- Endpoints:
  - `GET/POST/PATCH/DELETE /alert-managers` + `POST /:id/verify-phone` + `POST /:id/confirm-phone`
  - `GET/POST/PATCH/DELETE /alert-routing-rules`
  - `GET /alert-deliveries?status=&manager_id=&limit=` + `POST /alert-deliveries/:id/ack`

### Bloco G entregue — sumário

- Migration `047_ad_signals.sql` — `ad_signals` com `dedupe_key` UNIQUE parcial (1 pendente/dia/dedupe_key) + RLS + indexes pra Bloco H consumir pendentes
- `signals/signal-detector.service.ts` — implementa as 3 camadas:
  - **Camada 1 (regras determinísticas)**: SQL puro contra `ad_metric_configs` × `ad_metrics_daily`. Pra cada config `enabled+threshold_mode='manual'` com `target_value`, agrega métrica na janela e compara com target±warning_pct/critical_pct respeitando `direction` (higher_better/lower_better/neutral)
  - **Camada 2 (anomaly detection)**: pra `threshold_mode='auto'`, calcula rolling avg + stddev da janela de baseline (default 30d), dispara warning ≥2σ / critical ≥3σ. Só sinaliza se a direção da anomalia for "ruim" pelo catálogo
  - **Camada 3 (sinais compostos hardcoded)**: 7d vs 7d window comparison
    - `creative_fatigue` — CTR↓>20% + freq↑>30% + CPC↑>20%
    - `audience_burnout` — freq>4 + CTR cai >30%
    - `scaling_inefficiency` — spend dobra (>=100%) mas conversões crescem <50% (critical se spend >=200%)
    - `pixel_drift` — conversões caem >50% sem mudar spend (<20% delta)
- Dedupe via `dedupe_key = "<signal_type>:<campaign_id|metric>:<YYYY-MM-DD>"` + UNIQUE pendente
- `signals/signal-detector.worker.ts` — `setInterval` 15min, BOOT_DELAY 7min (depois do AdsSyncWorker em 5min). `DISABLE_SIGNAL_DETECTOR_WORKER=true` desliga
- `signals/ad-signals.controller.ts`:
  - `GET /ad-signals?status=pending|sent|acked|expired&limit=N` — lista com join campaign
  - `POST /ad-signals/:id/ack` — marca como visto (qualquer membro autenticado)
  - `POST /ad-signals/detect` — trigger manual (útil pra seedar primeiros sinais sem esperar 15min)
- **Decidido fora do MVP**: `lead_unattended` (depende do Bloco F — Lead Ads webhook)

### Bloco E entregue — sumário

- Migration `044_ad_metric_catalog.sql` — catálogo curado read-only com seed de **~40 métricas** (Meta + Google + shared) cobrindo spend, reach, engagement, conversion, video, quality
- Migration `045_ad_metric_configs.sql` — configs por org+métrica (threshold mode manual/auto, target_value, warning/critical pcts, baseline window, aggregation window, routing_manager_ids)
- `metric-catalog.service.ts` — read-only com cache em memória, métodos `list(platform)`, `get(key)`, `listCore(platform)`
- `metric-config.service.ts` — `list()` mescla rows persistidas com defaults virtuais (core=enabled, non-core=disabled, warning 15%/critical 30%); `upsert()` valida bounds e merge com baseline
- Endpoints (auth required):
  - `GET /ad-metrics/catalog?platform=meta|google|shared|all`
  - `GET /ad-metrics/configs?platform=...`
  - `PATCH /ad-metrics/configs/:metricKey` (owner/admin)

### Bloco C entregue — sumário

- Migration `042_ad_campaigns.sql` (não particionada — campaigns são poucas)
- Migration `043_ad_metrics_daily.sql` (PARTITION BY RANGE date, mensal Jan/2026 → Dec/2027 + default)
- `apps/api/src/modules/ads/connectors/meta.connector.ts` — Graph API client v21.0:
  - `fetchCampaigns()` com paging
  - `fetchInsights()` com `level=campaign` + `time_increment=1` (diário)
  - `MetaApiError` com `isAuthError` (401 / fb_code 190 / 102) → flag automático `token_expired`
  - Conversion mapping: soma `lead`, `purchase`, `complete_registration`, `onsite_conversion.lead_grouped`, `offsite_conversion.fb_pixel_*` (configurável depois)
- `ads-sync.service.ts` — orquestra connector → upsert DB:
  - `syncIntegration(id, daysBack=7)` incremental
  - `backfillIntegration(id, daysBack=90)` chamado pelo callback OAuth async
  - Upsert por `(integration_id, external_id)` em campaigns, `(campaign_id, date)` em metrics; batches de 500
- `ads-sync.worker.ts` — `setInterval` 1h, BOOT_DELAY 5min, `DISABLE_ADS_SYNC_WORKER=true` desliga em dev
- `POST /ad-integrations/:id/sync` — trigger manual (síncrono, 10-30s pra 90d)
- Backfill on-connect já fica plumbed: callback Meta upserta integração e dispara `sync.backfillIntegration()` em background pra cada ad_account

### Bloco B entregue — sumário

- Migration `041_ad_integrations.sql` aplicada (tokens OAuth cifrados AES-GCM)
- `apps/api/src/common/crypto/aes-gcm.util.ts` — util genérica (encrypt/decrypt/lastFour/HMAC sign+verify) reusando `LLM_CRED_ENCRYPTION_KEY`. `common/llm/crypto.util.ts` virou shim
- `apps/api/src/modules/ads/`:
  - `ad-integrations.service.ts` — OAuth state HMAC, upsert pós-callback, list/disconnect, getAccessToken (decifra sob demanda + flagged token_expired automático)
  - `oauth/meta-oauth.controller.ts` — `GET /ad-integrations/meta/connect` (auth) + `GET /ad-integrations/meta/callback` (público, identidade vem do state assinado)
  - `ad-integrations.controller.ts` — `GET /ad-integrations`, `DELETE /ad-integrations/:id`
- **Envs novas necessárias** (cole em `apps/api/.env` + Railway `active-api`):
  - `META_APP_ID` — do app Meta Developers
  - `META_APP_SECRET` — secret do app
  - `META_OAUTH_REDIRECT_URI` — opcional (default `https://active.eclick.app.br/ad-integrations/meta/callback`)
  - `FRONTEND_BASE_URL` — opcional (default `https://active.eclick.app.br`)

### Bloco A entregue — sumário

- Migration `040_org_llm_credentials.sql` aplicada (cred per org cifrada AES-GCM)
- `apps/api/src/common/llm/`: interface `LlmProvider`, `LlmService`, providers Anthropic+OpenAI+Google(stub)
- `GET/PATCH /settings/llm` (owner/admin) — UI escolhe provider+modelo+api_key
- 7 services migrados pra `LlmService`: `re-engagement`, `ai-concierge`, `pages/ai-page-generator`, `attachments` (Vision+audio), `copilot` (via escape hatch `getAnthropicClientForOrg` enquanto interface não cobre tool-loop)
- `AnthropicClient` virou adapter sobre `LlmService` — os 3 services do `ai/` (ai.service, data-collection, transfer) ganham cred per org sem mudança de código
- **Env nova**: `LLM_CRED_ENCRYPTION_KEY` (32 bytes hex) — DEVE estar em `apps/api/.env` local + Railway `active-api`

### Limitações conhecidas / follow-ups do Bloco A

- Copilot tool-loop ainda é Anthropic-only (escape hatch). Quando interface cobrir tool_use/tool_result blocks multi-provider, copilot pode migrar.
- OpenAI provider rejeita PDF inline (Anthropic suporta nativo). Documentado no `LlmContentBlock.pdf_base64`.
- Google provider em stub — implementar quando precisar.
- `AIInteractionType` em `@eclick-active/shared` ainda é union restritiva e ficou desalinhada com features novas (`re_engagement`, `attachment_vision`, `page_generate`, etc.). DB aceita string crua, mas vale atualizar shared num bloco futuro pra ganhar type-safety.

---

## Estado atual

**Última migration aplicada via API**: `068_automation_bridge.sql` (Onda 4 / A3, 2026-05-06)
**Migration aplicada via Studio**: `038_message_media_storage_policy.sql` (2026-05-05)
**Próxima migration livre**: `046_*.sql` (reservada pro Bloco F — Lead Ads webhook quando o app Meta estiver configurado) ou `069_*.sql`

**Helper pra aplicar migrations rapidão (Claude usa esse)**:
```bash
node scripts/apply-migration.mjs supabase/migrations/038_NOVA.sql
```
Roda via RPC `public._admin_exec_sql` (SECURITY DEFINER, service_role).
**Limitação conhecida**: não pode mexer em `storage.objects` policies via
SQL — precisa fazer via Supabase Studio se for o caso.

**Branch**: `main` (todos os commits foram empurrados).

---

## Última conversa rápida (TL;DR pra retomar)

A sessão completou:
1. ✅ Bug 18 (outbound não chegando) — `assertSessions` + log interceptor pra recuperar Signal sessions
2. ✅ Drag-to-pan no kanban + scrollbar customizado global
3. ✅ Concierge IA — qualifying loop + tags semânticas + nome via pushName + lock anti-duplicado
4. ✅ Tags system completo (catálogo + UI + integração com Concierge)
5. ✅ **Fase 3 (Agendamento via IA) completa**:
   - 3.A — Migration 036 + DTO/service team com specialties + duração default
   - 3.B — UI no `/equipe` editar specialties + duração + buffer
   - 3.C — `findSlotsForOrg` filtra por specialty (GIN) + Concierge propõe 3 slots numerados
   - 3.D — `parseSlotChoice` + `appointments.create(createdByAi=true)` ao escolher
   - 3.E — `custom_fields_schema` por appointment_type + render dinâmico no dialog
   - 3.F — Timezone por org + reminders 24h/1h enviam WhatsApp via dispatcher
6. ✅ **2.B/C — Vision pra mídia inbound**:
   - AttachmentsService + Worker → Anthropic Sonnet 4.6 Vision
   - UI: AttachmentCard com signed URL + chip de summary IA

---

## Arquitetura — ponteiros pra arquivos chave

### Concierge (IA conversacional)
- `apps/api/src/modules/ai/ai-concierge.service.ts` — máquina de estados
  `idle → awaiting_response → awaiting_slot_choice → routed`
- Tags semânticas geradas via LLM, deduplicadas, normalizadas (UPPERCASE_SNAKE_CASE)
- Lock leader-based em `inFlightHandlers` evita greeting duplicado em msgs concorrentes
- Custo logado em `active.ai_interactions` (interaction_type: concierge_greeting/concierge_route/concierge_qualify)

### Agendamento (genérico por nicho)
- **Schema**: `org_members.specialties` (text[], GIN), `default_duration_minutes`, `default_buffer_minutes`
- **Slots**: `AppointmentsService.findSlotsForOrg(orgId, { specialty, daysAhead, limit })`
  - Filtro por specialty via `.contains('specialties', [specialty])`
  - Fallback automático pra todos os agentes ativos quando specialty não bate
  - Usa default_duration de cada agente (não depende de appointment_type)
- **Custom fields**: `appointment_types.custom_fields_schema` (jsonb array)
  - Validados em `AppointmentsService.validateCustomFields`
  - Salvos em `appointment.metadata.custom_fields`
  - UI renderiza via `apps/web/components/agenda/custom-fields-form.tsx`
- **Reminders**: `AppointmentsService.sendAppointmentReminder(appt, '24h'|'1h')`
  - Persiste msg outbound, manda via ChannelDispatcher
  - Texto pt-BR no timezone da org (`getOrgTimezone` helper, default America/Sao_Paulo)
- **Concierge integration**: quando IA detecta AGENDAMENTO_SOLICITADO + specialty_guess,
  propõe 3 slots → state awaiting_slot_choice → cria appointment com createdByAi=true

### Attachments (Vision)
- `apps/api/src/modules/attachments/`:
  - `attachments.service.ts` — processAttachment (download → Vision → save)
  - `attachments.worker.ts` — tick 30s, batch 5
  - `attachments.controller.ts` — GET /attachments/conversation/:id
- Storage bucket `message-media` (privado), signed URLs com TTL 30min
- Worker do Baileys (`apps/workers/src/whatsapp/baileys.session.ts`) já baixa
  mídia + cria row em attachments. Vision processa em background.
- UI: `AttachmentCard` em `apps/web/components/chat/attachment-card.tsx`
  + `useConversationAttachments` hook

### Storage / Supabase
- Schema namespace: `active.*`
- RPC `public._admin_exec_sql(text)` pra Claude rodar DDL/DML via PostgREST
- Bucket `message-media` (privado)
- Particionamento mensal: `messages`, `ai_interactions` (CASCADE FK não funciona — deletar manualmente)

---

## Setup operacional

**Comandos**:
- `npm run dev` — sobe api + web + workers via turbo
- `npm run type-check` — TSC em todos os apps
- `npm run build` — build prod

**Envs críticos** (`apps/api/.env`):
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — service role
- `ANTHROPIC_API_KEY` — Claude Sonnet 4.6
- `DISABLE_APPOINTMENT_WORKER=true` — desliga reminder worker (dev)
- `DISABLE_ATTACHMENTS_WORKER=true` — desliga vision worker (dev)

**Railway**: 4 services
- `active-api` (NestJS)
- `active-web` (Next.js)
- `active-workers` (Baileys + tsx)
- `baileys-manager` (cross-process spawn)

---

## Pendências e roadmap

### Imediato (low-effort)
1. ✅ **UI editor pra `custom_fields_schema`** — entregue em `ca18c27`.
   Em /configuracoes > Agenda agora tem seção "Tipos de agendamento" com
   editor visual completo de schema.
2. ✅ **Storage policy `message_media_org_read`** — aplicada via Studio em
   2026-05-05. Frontend autenticado agora pode baixar arquivos do bucket
   `message-media` direto, sem precisar pedir signed URL ao backend toda
   vez (signed URL continua sendo o caminho default por enquanto).
3. ✅ **Audio transcript via Whisper** — entregue em `50f1e7d`.
   Áudio inbound (audio/ogg do WhatsApp) agora vira transcript via
   Whisper + summary via Sonnet. UI tem TranscriptToggle expansível.
4. ✅ **Configuração de timezone na UI** — entregue em `25566f8`.
   /configuracoes > Organização tem dropdown com 25 timezones.

### Sprint próximo (já planejado)
- **Intelligence Hub**: 5 analyzers + alert routing — vê
  `.claude/projects/.../memory/project_intelligence_hub.md`
- **Templates de persona** por nicho (clínica, salão, oficina, B2B)
- **Cron de re-engagement / painel follow-ups**
- **Responsividade Fase 1** (sidebar/layout mobile — feedback recurring)
- **Configuração de timezone na UI** (`organizations.settings.timezone`).
  Hoje só funciona via UPDATE direto.

### Roadmap futuro — features pedidas mas não implementadas

#### 1. Chat interno entre usuários da mesma org
**Status**: feature nova, sem precedente no SaaS pra portar.

Cenário: members da org conversam entre si dentro do Active (estilo Slack/Teams light), pra discutir leads/deals sem precisar sair da plataforma.

Escopo proposto:
- Migration `internal_messages` (id, org_id, sender_user_id, recipient_user_id OR thread_channel_id, content_type text/file, attachments jsonb, read_at, created_at)
- Suporte a:
  - DMs 1:1 entre members
  - Canais (rooms) compartilhados — opcional, decisão de UX
  - Threading em msgs específicas (nice-to-have)
- Realtime via `EventsGateway` existente (já roda websocket pra events de org)
- Notificações: badge no sidebar + sound opcional + integração futura com push notifications
- UI: nova rota `/team-chat` ou drawer/painel lateral expansível
- Mention `@user` que dispara notificação direcionada
- Search por conteúdo
- Permissões: todo member vê DMs próprios; canais respeitam membership opcional

Estimativa: ~6-8h backend + ~6h UI.

#### 2. Widget de chat embutido (porta do SaaS)
**Status**: existe no SaaS em `eclick-backend/src/modules/widgets/`. Portar com adaptações.

Cenário: cliente cola um snippet JS no site dele e visitantes anônimos podem chatear. Conversa vira `conversation` no Active e o Concierge IA reage normalmente.

Escopo de porta (referência: `eclick-backend/src/modules/widgets/`):
- `chat-widget.service.ts` — CRUD widgets, gera `widget_token` único, valida `allowed_origins`
- `widgets.controller.ts` — endpoints autenticados pro dashboard CRUD
- `widget-public.controller.ts` — endpoints públicos consumidos pelo embed JS:
  - `POST /widget/<token>/init` — abre conversa anônima
  - `POST /widget/<token>/message` — envia msg
  - `GET /widget/<token>/messages?since=...` — long-poll OU upgrade pra SSE/websocket
- Migration `chat_widgets` (id, org_id, name, agent_id REF ai_persona, welcome_message, theme_color, position, require_name/email/phone, allowed_origins, widget_token, is_active)
- Conversa criada com `channel_type='widget'` (precisa adicionar enum + provider)
- AI Concierge reage automaticamente se `auto_reply` habilitado
- UI no dashboard: nova section em `/configuracoes > Widget` (CRUD + preview + snippet de embed)
- Embed JS estático servido via CDN/Netlify (`widget.js` que carrega iframe ou direto)
- Adaptações pro Active:
  - `supabaseAdmin` → `SupabaseService`
  - `atendente-ia` (SaaS) → `AiConciergeService` (Active) — Concierge já tem fluxo de greeting + qualify
  - Schema do SaaS usa `user_id` na ad-account; aqui é `org_id` puro

Estimativa: ~5h backend + ~4h UI + ~2h embed JS.

### Bugs conhecidos / observações
- **Card no kanban**: drag-to-pan tem `data-no-pan` no DealCardVisual pra
  não conflitar com dnd-kit. Se mudar root do card, redo isso.
- **Particionamento + CASCADE**: messages e ai_interactions são particionadas
  por mês. CASCADE FK NÃO funciona → deletar manualmente antes do parent.
- **Baileys "Closing session"**: log interceptor em pino destination dispara
  `refreshActiveSessionsAfterClose` (throttled 30s) chamando `assertSessions`
  pra recuperar Signal Protocol sessions silenciosamente perdidas.

---

## Tarefas comuns que vão pintar

### Aplicar migration nova
```bash
node scripts/apply-migration.mjs supabase/migrations/038_NOVA.sql
```

### Configurar owner do Automation Bridge (notify-lojista)
```sql
-- Pega o contact_id do dono e cola no settings JSONB
UPDATE active.organizations
SET settings = settings || jsonb_build_object(
  'automation_bridge', jsonb_build_object(
    'owner_contact_id', '<UUID_DO_CONTATO>'
  )
)
WHERE id = 'ORG_UUID';
```

### Smoke test manual do Automation Bridge
```bash
# Critical (envia imediato)
curl -i -X POST https://api.active.eclick.app.br/commerce/automation-bridge/notify-lojista \
  -H "X-Automation-Bridge-Token: $AUTOMATION_BRIDGE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"org_id":"<ORG_UUID>","severity":"critical","title":"Teste","body":"Teste smoke critical"}'

# Medium (vai pra digest 4h)
curl -i -X POST https://api.active.eclick.app.br/commerce/automation-bridge/notify-lojista \
  -H "X-Automation-Bridge-Token: $AUTOMATION_BRIDGE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"org_id":"<ORG_UUID>","severity":"medium","title":"Teste digest","body":"Teste smoke medium"}'
```

### Configurar timezone de uma org
```sql
UPDATE active.organizations
SET settings = settings || '{"timezone": "America/Manaus"}'::jsonb
WHERE id = 'ORG_UUID';
```

### Configurar custom_fields_schema dum tipo de agendamento
```sql
UPDATE active.appointment_types
SET custom_fields_schema = '[
  {"key":"weight_kg", "label":"Peso (kg)", "type":"number", "required":true, "min":0, "max":300},
  {"key":"reason", "label":"Motivo da consulta", "type":"textarea", "required":true, "max_length":500},
  {"key":"insurance", "label":"Convênio", "type":"select", "required":false, "options":["Particular","Unimed","Bradesco","Outros"]}
]'::jsonb
WHERE id = 'TYPE_UUID';
```

### Definir specialties + duração de um membro
Via UI: `/equipe` → clica no membro → seção "Agendamento".
Via SQL:
```sql
UPDATE active.org_members
SET specialties = ARRAY['nutricionista', 'endocrinologista'],
    default_duration_minutes = 60,
    default_buffer_minutes = 15
WHERE id = 'MEMBER_UUID';
```

### Forçar reprocessamento de attachment
```sql
UPDATE active.attachments
SET ai_processed_at = NULL, ai_summary = NULL, ai_extracted = NULL
WHERE id = 'ATT_UUID';
```
Worker pega no próximo tick (30s).

---

## Memória do Claude (referencias)

- `project_eclick_active.md` — meta-info do monorepo (caminho, schema, comandos)
- `project_eclick_active_arch.md` — decisões arquitetura
- `feedback_eclick_active_workflow.md` — workflow blocos A/B/C com tsc final
- `feedback_responsive_required.md` — UI deve funcionar mobile/tablet/desktop
- `feedback_callback_ref_pattern.md` — padrão pra DOM listeners + render condicional
- `feedback_tag_visual_style.md` — pílulas coloridas pras tags
- `feedback_beeps.md` — terminal beeps de status

---

## Commits desta sessão (cronológicos)

```
7c8b2f5  fix(channels): whatsapp_free + status='active' em bridge e B6
9661132  feat(automation-bridge): A3 SaaS↔Active receivers + digest worker
ad74671  feat(web): responsividade Fase 1 — sidebar mobile + drawer + back nav
b407e18  docs(handoff): atualiza com 1+2+3
f3c2989  feat(re-engagement): cron de reativação + painel UI
9389f9c  feat(ai-persona): templates de onboarding por nicho
441572e  feat(attachments): vídeo inbound transcrito via ffmpeg + Whisper
8446936  docs(handoff): marca migration 038 como aplicada
9cd3ab6  docs: storage policy 038 + atualiza HANDOFF
50f1e7d  feat(attachments): transcrição de áudio via OpenAI Whisper
25566f8  feat(configuracoes): seletor de timezone na seção Organização
ca18c27  feat(configuracoes): editor de tipos de agendamento + custom fields
7aea27b  docs(handoff): consolida sessão Concierge + Vision
088e4b9  feat(attachments): Vision OCR + UI no chat (2.B+2.C)
3cc4b09  feat(appointments): timezone por org + reminders WhatsApp (3.F)
d057f6d  feat(appointments): custom_fields_schema por type (3.E)
f94018d  feat(concierge): IA propõe horários e cria agendamento (3.C+3.D)
633ed9b  feat(equipe): UI specialties + duração + buffer (3.B)
d4619ae  feat(team): campos agendamento por profissional (3.A)
f0cd94b  fix(baileys): auto-recover Signal sessions ao Closing
f7f1220  fix(inbox): preview última msg em realtime
b982e3a  fix(chat): refetch silencioso on visibility/focus
f16fc87  fix(pipelines): MaxLength 500 → 2000 chars
```
