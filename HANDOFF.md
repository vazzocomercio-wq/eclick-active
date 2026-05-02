# HANDOFF — eclick-active

> Documento de continuidade entre sessões do Claude Code. Lê isso primeiro ao começar nova sessão.
> Última atualização: 2026-05-02

---

## Estado atual

**Última migration**: `011_automations_stage_id_and_webhooks.sql` (Bloco D não exigiu migration nova)
**Próxima migration**: `012_*.sql`

**Branches**: trabalhando direto em `master` no eclick-active. Commits manuais quando user pede.

**Type-check status** (último validado): ✅ tsc api + web limpos após Bloco D.

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

### Bloco D — Calendário nativo (concluído — mais recente)
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
