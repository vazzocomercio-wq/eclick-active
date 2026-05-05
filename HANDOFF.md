# HANDOFF — eclick-active

> Documento vivo de continuidade entre sessões. **Lê isso primeiro ao começar nova sessão.**
> Última atualização: **2026-05-05** (responsividade Fase 1 + design do Active Intelligence)

---

## 🎯 Próximo trabalho planejado

**Active Intelligence (Ads & Social Analytics + Hub)** — design fechado, aguardando GO.

📄 **Doc canônico**: [`docs/analytics-design.md`](./docs/analytics-design.md)

Resumo:
- Sistema de monitoramento ativo (Meta + Google Ads) + alertas WhatsApp
- 8 blocos sequenciais (A-H), ~27h total
- **Próxima ação**: implementar **Bloco A** (LlmProvider abstraction)
- Decisões 1-7 fechadas (ver doc)
- ⚠️ **NÃO** confundir com Intelligence Hub do `eclick-backend` (SaaS) — em prod lá, projeto distinto

---

## Estado atual

**Última migration aplicada via API**: `039_re_engagement.sql`
**Migration aplicada via Studio**: `038_message_media_storage_policy.sql` (2026-05-05)
**Próxima migration livre**: `040_*.sql`

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
