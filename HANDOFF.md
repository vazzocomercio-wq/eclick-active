# HANDOFF — eclick-active

> Documento de continuidade entre sessões do Claude Code. Lê isso primeiro ao começar nova sessão.
> Última atualização: 2026-05-02

---

## Estado atual

**Última migration**: `014_ai_persona_and_business_hours.sql` (criada — usuário precisa rodar no Studio)
**Próxima migration**: `015_*.sql`

**Branches**: `main` no eclick-active (não master).

**Type-check status** (último validado): ✅ tsc 5/5 packages limpos após Bloco E.

---

## Blocos entregues

### Bloco A — Custom fields + numeração de leads (concluído)
- Migration 009: `custom_field_groups`, `custom_field_definitions`, `deal_number` sequence
- Backend: `custom-fields.service.ts`, integração com deals/contacts
- Frontend: admin UI em `/configuracoes/campos-personalizados`, dynamic renderer
- `deal_number` auto-incremental por org (ex: `#0042`)

### Bloco B — Funil inteligente (concluído)
- Migration 010: `pipelines.archived_at`
- Quick-add deal (form simplificado no board)
- Auto-leads (criação de deal a partir de mensagem inbound sem deal aberto)
- Pipeline templates (clonar pipeline pronto)
- AI fill-field (sugestões via Anthropic)
- SLA pulse (animação visual em deals com SLA estourado)
- Won/Lost columns colapsíveis
- WebSocket toasts (deals criados/movidos)
- Move-and-delete stage dialog (move deals antes de deletar)

### Bloco E — Agente de IA configurável (concluído — mais recente)
- **Migration 014**: `ai_agent_personas`, `organizations.business_hours` jsonb, `ai_test_conversations` (TTL 24h via pg_cron quando habilitado)
- **Migration 013**: `conversations.status` ganhou `'archived'` (soft-delete de conversas)
- **Migration 012**: REPLICA IDENTITY FULL nas partições de messages + função `create_messages_partition` atualizada + `create_ai_interactions_partition` (nova)
- **Shared**: tipos `AiAgentPersona`, `BusinessHoursConfig`, `AiTestConversation`, `AiTestMessage` em `packages/shared/src/types/ai-persona.ts`
- **API**:
  - `apps/api/src/modules/ai-persona/` — service + controller; `buildSystemPrompt()` é o coração: transforma persona em system prompt rico (role, tone, length, language, guidelines, forbidden_topics, fallback)
  - `apps/api/src/modules/business-hours/` — `isWithinBusinessHours()`, `nextOpenAt()`, `update()`, endpoints `GET/PATCH /settings/business-hours`
  - `apps/api/src/modules/ai-test/` — sessão sandbox com TTL 24h. `sendMessage()` roda classify + RAG + reply com persona, retorna metadata (intent, sentiment, KB sources, ações hipotéticas, latência). Não toca em contatos/deals reais.
  - Integrações: `ai.service.suggestResponse` e `copilot.service` agora prepend persona system prompt antes do system específico da feature
  - Endpoint novo: `POST /automations/to-text` (reverse de `generate`) — converte automação estruturada em descrição PT-BR
- **Frontend**:
  - Rota nova `/configuracoes/agente-ia` com 4 abas: Persona, Horário Comercial, Modo Teste, Estatísticas
  - **Persona tab** completa: form com nome, papel, personalidade, tom (4 opções com exemplos), tamanho, idioma, delay slider, list editors pra guidelines + forbidden_topics, mensagens de saudação/fallback, toggle is_default
  - **Business Hours tab** completa: master toggle, timezone select, grade semanal com toggle por dia + inputs HH:mm + barra visual proporcional
  - **Modo Teste tab** completo: chat com seleção de persona, sugestões pré-definidas (preço/reclamação/agendamento/saudação), bubbles com metadata (intent, sentiment, temperature, KB sources, ações hipotéticas, latência)
  - **Estatísticas tab** placeholder (depende de novo endpoint /ai/stats — TODO)
  - Entry "Agente de IA" adicionado ao sidebar de `/configuracoes`
  - API clients: `ai-persona.ts`, `business-hours.ts`, `ai-test.ts`
- **TODOs pendentes** (Bloco E não cobriu):
  - Webhook auto-respond fora do horário (zapi/baileys → check business hours → gerar resposta com persona → enviar). Requer wiring em zapi-webhook.service.ts e baileys.session.ts
  - Briefing matinal: function `generateMorningBriefing()` + cron job (15min antes da abertura) + UI card no /central-de-acao
  - Stats endpoint `GET /ai/stats?period=...` + frontend com recharts
  - Dual builder UI no frontend de automações (split-view com sync bidirecional). Backend já pronto (`POST /automations/to-text`)
  - Avatar uploader (galeria de ícones ou upload custom)

### Bloco D — Calendário nativo (anterior)
- **Sem migration** (reusa `active.tasks` com seus campos `due_date`, `task_type`, etc.)
- **Backend**:
  - `apps/api/src/modules/tasks/dto/calendar-tasks.query.dto.ts` — `from`, `to`, `user_id?`, `task_type[]?` (csv ou repeat)
  - `apps/api/src/modules/tasks/tasks.service.ts` — `getCalendar(orgId, filters)` retorna `CalendarDay[]` agrupado por `YYYY-MM-DD` (timezone do servidor)
  - `apps/api/src/modules/tasks/tasks.controller.ts` — `GET /tasks/calendar` (declarado antes de `:id`)
  - Tipos exportados: `CalendarDay`, `CalendarTask` (shape slim para o calendário)
- **Frontend**:
  - `apps/web/app/(dashboard)/calendario/page.tsx` — rota
  - `apps/web/components/calendario/calendar-utils.ts` — helpers de data (start/end of week/month, monthGridRange), color map por `task_type`, `HOUR_RANGE` (8-20), `HOUR_HEIGHT_PX = 56`
  - `apps/web/components/calendario/calendar-page.tsx` — orquestrador (DnD context, view switching, realtime, swipe mobile, popover, NewTaskDialog wire)
  - `apps/web/components/calendario/calendar-header.tsx` — nav (< | label | >), Hoje, Dia/Semana/Mês toggle (escondido em mobile), filtro "Só minhas" + multi-select de tipos
  - `apps/web/components/calendario/month-view.tsx` — grid 7×N, dia com até 3 pills + overflow `+N mais`, droppable por dia, click célula vazia → criar tarefa
  - `apps/web/components/calendario/week-view.tsx` — gutter de horas + 7 colunas, all-day strip, blocos posicionados por hora, NowLine vermelha
  - `apps/web/components/calendario/day-view.tsx` — coluna principal + sidebar à direita com lista checkable
  - `apps/web/components/calendario/task-pill.tsx` — pill draggable (mês)
  - `apps/web/components/calendario/task-block.tsx` — bloco draggable (semana/dia) com barra lateral colorida
  - `apps/web/components/calendario/task-popover.tsx` — popover com Concluir/Editar
  - `apps/web/components/sidebar.tsx` — entry "Calendário" entre "Tarefas" e "Copiloto IA"
  - `apps/web/components/tarefas/new-task-dialog.tsx` — props novas `defaultDueDate`, `defaultDueTime`
  - `apps/web/lib/api/tasks.ts` — `tasksApi.calendar()` + tipos `CalendarTask`/`CalendarDay`/`CalendarTasksParams`
- **Realtime**: subscription `active.tasks` com refetch debounced (250ms)
- **Drag-and-drop**: `@dnd-kit/core` (já instalado), `useDraggable` em pills/blocks + `useDroppable` por dia. PATCH `due_date` preservando hora. Optimistic + revert em erro.
- **Mobile**: media-query `max-width: 767px` força visão Dia + swipe horizontal (60px threshold) navega entre dias
- **Sem dependência nova**

### Bloco C — Motor de automações expandido (anterior)
- Migration 011:
  - `automations.stage_id` (nullable, FK pipeline_stages)
  - `webhook_endpoints` (org_id, name, url, events[], secret, is_active, failure_count)
  - `webhook_deliveries` (endpoint_id, event_type, payload, response_status, response_body, attempt, status)
  - Reafirma `email` no enum CHECK de `channels.channel_type`

- **Shared**:
  - `packages/shared/src/utils/placeholder-resolver.ts` — `resolvePlaceholders()` + `PLACEHOLDER_CATALOG` (20 placeholders, 5 categorias)
  - `packages/shared/src/types/webhook.ts` — `WebhookEventType` (18 events), `WebhookEndpoint`, `WebhookDelivery`

- **Backend**:
  - `apps/api/src/common/placeholder/placeholder.service.ts` (`@Global` module) — `buildContext({orgId, dealId?, contactId?, companyId?, userId?})`
  - `apps/api/src/common/channels/providers/email/email.provider.ts` — STUB (lança `NotImplementedException`)
  - `apps/api/src/modules/webhooks/outbound/outbound-webhook.service.ts` — CRUD + `deliver()` com HMAC + retry setTimeout
  - `apps/api/src/modules/webhooks/outbound/outbound-webhook.controller.ts` — endpoints `/webhooks/endpoints` + `/webhooks/deliveries/:id/retry`
  - `apps/api/src/modules/webhooks/webhooks.module.ts` — marcado `@Global`
  - `apps/api/src/modules/automations/automations.service.ts` — usa PlaceholderService; novo método `interpolateRich`; filter `stage_id` no `checkTriggers`
  - `apps/api/src/modules/automations/dto/automation.dto.ts` — `stage_id?: string | null`
  - `apps/api/src/modules/automations/automations.controller.ts` — `GET /automations?stage_id=X&global_only=true`
  - `apps/api/src/modules/deals/deals.service.ts` — chama `webhooks.deliver` em created/updated/stage_changed/won/lost
  - `apps/api/src/modules/contacts/contacts.service.ts` — chama `webhooks.deliver('contact.created')`

- **Frontend**:
  - `apps/web/lib/api/outbound-webhooks.ts` — client API
  - `apps/web/lib/api/automations.ts` — `list({stageId, globalOnly}, signal?)`
  - `apps/web/components/configuracoes/webhooks-section.tsx` — UI completa (cards, dialog criar/editar com auto-secret, sheet detalhe com timeline de deliveries + retry)
  - `apps/web/components/ui/placeholder-input.tsx` — textarea com dropdown ao digitar `{{`, navegação ↑↓ Enter Esc, preview live
  - `apps/web/components/funis/stage-automations-sheet.tsx` — Sheet com lista + toggle + delete + form criação
  - `apps/web/components/funis/pipeline-config-sheet.tsx` — botão `⚡` por stage abre `<StageAutomationsSheet>`
  - `apps/web/app/(dashboard)/configuracoes/page.tsx` — seção "Webhooks" na sidebar

---

## TODOs flagados (não pedidos pelo user, mas óbvios pra próximos blocos)

### Email
- [ ] Implementar email provider real (nodemailer + SMTP) substituindo o stub
- [ ] Action `send_email` no automations runner (paralela a `send_message`)
- [ ] UI de configuração SMTP em `/configuracoes/canais`

### Placeholders
- [ ] Wirar `<PlaceholderInput>` em pontos de uso reais:
  - `MessageInput` em `/conversas` (para envio manual com placeholders)
  - Form de criação de automação em `<StageAutomationsSheet>` (campo "Mensagem a enviar")
  - Templates de mensagem (se virar feature)

### Webhooks
- [ ] Disparar `webhooks.deliver` em outros services:
  - `tasks.service.ts` → `task.created`, `task.completed`
  - `conversations.service.ts` → `conversation.opened`, `conversation.closed`
  - `ai/copilot.service.ts` → `ai.response_generated`
- [ ] Migrar retry de setTimeout pra BullMQ/Redis quando volume aumentar
- [ ] Particionamento mensal de `webhook_deliveries` (segue o padrão de `messages`/`ai_interactions`)

### Stage automations UX
- [ ] Form completo (não só send_message): suporte a múltiplas actions encadeadas
- [ ] Botão "Descrever com IA" (já existe `automacoesApi.generate` no shared)
- [ ] Templates pré-prontos ("Saudação ao receber lead", "Notificar fechamento", etc.)

---

## Próximo bloco — sugestões plausíveis

User não pediu ainda. Hipóteses pelo padrão dos blocos anteriores:

1. **Bloco D — Email + canais expandidos**: implementar email real (nodemailer), wire de `send_email` action, UI SMTP, talvez stub de Telegram/Instagram providers.

2. **Bloco D — Tarefas + agenda**: módulo `tasks` ainda básico, daria pra expandir com lembretes, atribuições, integração com agenda visual.

3. **Bloco D — Relatórios + dashboards**: cards de métricas no `/dashboard` (deals criados/fechados, MRR, conversion rate, lead time por stage), gráficos com recharts.

4. **Bloco D — Refinamentos do C**: amarrar os TODOs flagados (placeholder input em pontos reais, webhooks em mais services, stage automations multi-action).

Sem confirmar qual o user quer — perguntar no início da sessão.

---

## Arquivos críticos de contexto

Caso precise refrescar entendimento de padrões:

| Pra entender | Ler |
|---|---|
| Cross-process Baileys | `apps/api/src/common/channels/providers/baileys/baileys.provider.ts` + `apps/workers/src/internal-server.ts` |
| Automations engine | `apps/api/src/modules/automations/automations.service.ts` |
| Webhook delivery | `apps/api/src/modules/webhooks/outbound/outbound-webhook.service.ts` |
| Placeholder resolver | `packages/shared/src/utils/placeholder-resolver.ts` |
| Multi-tenant pattern | qualquer service do api — sempre filtra `org_id` no admin client |
| Migrations | `supabase/migrations/011_*.sql` (último exemplo de policies + tabelas novas) |

---

## Comandos úteis

```bash
# rodar tudo
npm run dev

# só type-check (preferido ao final de bloco)
npm run type-check

# build completo
npm run build

# lint
npm run lint
```

---

## Como retomar com o Claude

Na próxima sessão, primeira mensagem:

> "Lê HANDOFF.md em eclick-active e a memory. Continuando o trabalho — quero começar o Bloco D: [descrição]"

Ou se for fix/refinamento de Bloco C:

> "Lê HANDOFF.md. Quero amarrar o TODO X do Bloco C: [especificar]"

A memory captura padrões duráveis (Baileys cross-process, stage-bound automations, etc.). Este HANDOFF captura estado específico do trabalho em curso (TODOs ativos, último bloco entregue).
