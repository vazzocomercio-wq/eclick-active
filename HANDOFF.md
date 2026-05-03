# HANDOFF — eclick-active

> Documento de continuidade entre sessões. Lê isso primeiro ao começar nova sessão.
> Última atualização: **2026-05-03** (sessão extensa de fixes + features)

---

## Bug ativo no momento do handoff (PRIORIDADE)

**Sintoma**: mensagens outbound enviadas via `/conversations/start` (botão "Nova conversa" no Inbox) **não chegam ao destinatário** mesmo com Baileys retornando `OK + channel_message_id`.

**Onde paramos**:
- Caso de teste real: contato **Deiselene** (`Deise`), número `+55 71 99409-5636`
- Confirmado que Vazzo (canal pareado) e Deiselene **conversam normalmente via WhatsApp manual** (não é bloqueio nem número errado)
- Confirmado que via CRM as mensagens nunca chegam (testado várias vezes)
- JID **finalmente** salvo correto após múltiplos fixes: `5571994095636@s.whatsapp.net` (com o 9)

**Fixes já entregues nessa cadeia (commits dessa sessão)**:
- `34e36fd` — content shape `{ body }` em vez de `{ text }`
- `69d77ca` — partition pruning no UPDATE de messages (eq created_at + org_id)
- `bed92ba` — remove coluna `delivered_at` fantasma
- `198f228` — helper `brPhoneCandidates` pra normalizar phone BR (preferir 9 inicial)
- `a405b50` — força JID com 9 quando candidate é formato moderno (workaround "shadow account" WhatsApp BR)
- **(WIP, não commitado)** — log explícito do JID final no `sendMessage` do worker (já adicionado em `apps/workers/src/whatsapp/baileys.session.ts`, falta commit)

**Próximos passos pra debugar (próxima sessão)**:
1. **Commit do log de debug** que está no working tree:
   ```ts
   // apps/workers/src/whatsapp/baileys.session.ts linha ~140
   console.log(`[baileys ${channelId}] sendMessage → input="..." normalized="..." jid="..." kind=...`);
   ```
2. **Testar manual no celular do Vazzo**: confirmar se msg manual chega na Deiselene (separar bug Baileys de bug WhatsApp)
3. **Pegar logs do `active-workers`** durante envio CRM, ver:
   - JID exato sendo enviado pra `sock.sendMessage`
   - Resposta do `sock.sendMessage` (msg_id, status)
4. **Hipóteses ainda em aberto**:
   - JID com 9 ainda não é o "correto" — talvez a Deiselene esteja com JID `lid` (`...@lid`) em vez de `@s.whatsapp.net`
   - Sessão Baileys pode ter cache antigo do contato — testar `sock.assertSessions` ou re-pareamento
   - Versão do `@whiskeysockets/baileys` (^6.7.18) pode ter bug específico — considerar atualizar
   - WhatsApp pode ter aplicado restrição silenciosa ao número Vazzo (fingerprinting de bot)
5. **Plan B**: implementar action `send_via_workspace_baileys_send_raw` que aceita JID custom direto, pra testar diferentes formatos sem passar pelo resolveRecipient.

---

## Estado geral

**Última migration**: `031_contacts_search_ilike.sql`
**Próxima migration**: `032_*.sql`

**Migrations dessa sessão (precisam estar aplicadas no Supabase Studio)**:
- `028_ai_concierge.sql` — pipelines/stages ganham coluna `description` (pra IA usar no roteamento)
- `029_whatsapp_validation.sql` — campos whatsapp_verified/jid/profile_* em contacts + tabela whatsapp_validation_queue
- `030_unarchive_on_inbound.sql` — trigger SQL: msg inbound desarquiva conversa automaticamente
- `031_contacts_search_ilike.sql` — `search_contacts` reescrito com ILIKE (busca por substring "Dei" acha "Deise")

**Branches**: `main` no eclick-active.

**Type-check status**: ✅ tsc 4/4 limpo (api, web, workers, shared) no último commit deployado.

**Último commit no main**: `a405b50` (BR phone shadow account workaround)
**Working tree**: alterações não commitadas em `apps/workers/src/whatsapp/baileys.session.ts` (log de debug do JID).

---

## Features novas dessa sessão

### Bloco AI Concierge (concluído A+B+C+D)
**Migration 028** + 4 commits.

Saudação + roteamento automático de leads com IA:
1. Cliente manda 1ª msg → IA cumprimenta com pergunta de sondagem (custom da persona OU gerada na hora)
2. Cliente responde → IA lê pipelines/stages com descrições + business_context da org → escolhe pipeline+stage dinamicamente
3. Cria deal no pipeline correto + atualiza temperatura do contato + manda bridge message

Settings em `organizations.settings.ai_concierge`:
```json
{ "enabled": false, "auto_reply": false, "send_bridge_message": true, "business_context": "" }
```

Polimento (Bloco D):
- `response_delay_seconds` da persona aplicado antes de cada outbound (humanização, cap 30s)
- Log estruturado em `ai_interactions` com tipos `concierge_greeting` / `concierge_route`, custo USD calculado, tokens reais

UI: `/configuracoes/concierge` — toggle, business_context textarea, lista de pipelines/stages com descrições editáveis inline.

Arquivos chave:
- `apps/api/src/modules/ai/ai-concierge.service.ts` (810+ linhas, helper `applyResponseDelay`, `logInteraction`, `askIaToRoute`, `generateGreeting`, `sendOutbound`)
- `apps/web/components/configuracoes/concierge-section.tsx`

### Bloco Conversa Ativa (concluído A+B+C+D+E+F+G)
**Migration 029** + múltiplos commits.

Vendedor inicia conversa do CRM (não precisa cliente mandar primeiro):
- Validação de número WhatsApp via Baileys/Z-API (badges visuais ✅/❓/❌)
- `WhatsappValidatorService` com `validatePhone`, `enqueue` (pra batch), `getStats`
- Auto-validate ao criar/atualizar contato com phone
- `ConversationsService.startConversation` (WIP — bug ativo)
- UI: botão "Nova" no Inbox + dialog com ContactPicker
- Atalho no Contact/Deal Detail Sheet (estado vazio da aba Conversas)
- Bulk actions em `/contatos`: seleção em massa + verificar WhatsApp + excluir
- Trigger automation `whatsapp_verified` (transição não→verified dispara checkTriggers)

Arquivos chave:
- `apps/api/src/modules/contacts/whatsapp-validator.service.ts`
- `apps/workers/src/whatsapp/baileys.session.ts` (`checkNumber`, `checkSingle`, helper `brPhoneCandidates`)
- `apps/api/src/modules/conversations/conversations.service.ts` (`startConversation`, `delete`, `updateMessageStatus`)
- `apps/web/components/inbox/start-conversation-dialog.tsx`
- `apps/web/components/contacts/whatsapp-verified-badge.tsx`
- `apps/web/components/contacts/bulk-actions-bar.tsx`
- `apps/web/components/contacts/avatar-with-channel.tsx` — badge do canal sobreposto no avatar (✅ funcionando em conversation-item, chat-header, contact-panel)

### Realtime triple defesa (commit `0f4288d`)
useInbox tem 3 camadas:
1. **Optimistic update** — agente arquiva/resolve/marca lida → remove/atualiza local na hora (chamado pelo `onAction` do ChatPanel)
2. **Polling 30s silencioso** — refetch sem mostrar loading enquanto aba visível
3. **Refetch ao voltar pra aba** — visibility/focus dispara refresh imediato

Plus: `conversation:updated` agora emite em `create`, `update`, `markAsRead`, `toggleStar`, `delete` (não só nos webhooks).

### Outras features pequenas
- Auto-unarchive de conversa quando msg inbound chega (trigger SQL `unarchive_on_inbound`, migration 030)
- Ações novas no chat: **Desarquivar** (toggle) + **Excluir permanentemente** (DELETE /conversations/:id)
- Cursor sempre ativo no `MessageInput` (mount, depois de enviar, ao trocar conversa)
- Badges de canal sobrepostos no avatar (chat-header + lista + painel direito)
- `search_contacts` agora ILIKE em vez de tsvector (digitar "De" acha "Deise")
- Socket.IO renova token a cada reconnect (callback `auth` em vez de estático) — corrige loop de "WebSocket closed before established"

---

## Bugs corrigidos nessa sessão (cronológico)

| # | Bug | Commit |
|---|---|---|
| 1 | TikTokProvider não registrado em ChannelsModule (DI runtime, tsc não pega) | (sessão anterior) |
| 2 | Worker bind 127.0.0.1 não funciona em Railway → fix WORKER_INTERNAL_BIND=0.0.0.0 | (sessão anterior) |
| 3 | `INTERNAL_API_URL` errada apontando pra api.eclick.app.br (SaaS) em vez de api.active. | (env Railway) |
| 4 | `EventsGateway.emitToOrg` crashava com TypeError 'rooms' undefined (namespace vs server) | `431c783` |
| 5 | Canal `whatsapp_free` entrava 'active' em vez de 'pending' (truthy credentials) | `d11a849` |
| 6 | Canais pending órfãos quando user fechava dialog | `0d89876` |
| 7 | `output_config.format.json_schema` requer additionalProperties=false (rejeita) | `501eace` |
| 8 | content shape `{ text }` em vez de `{ body }` no startConversation | `34e36fd` |
| 9 | Inbox sem realtime — Supabase realtime do schema active não tem publication | `daec89c` |
| 10 | Mutators de conversation não emitiam `conversation:updated` | `3f9d6ab` |
| 11 | Socket.IO loop "closed before established" — token Supabase estático expirava | `abddfb9` |
| 12 | Botão MoreVertical do Contact Sheet sobrepondo X de fechar | `abddfb9` |
| 13 | Tela `/contatos` sem realtime — manda mensagem nova, contato novo não aparecia | `10629d9` |
| 14 | search_contacts com tsvector não fazia substring ("De" não achava "Deise") | `52ae645` (migration) |
| 15 | Update de messages sem partition pruning silenciava | `69d77ca` |
| 16 | Coluna fantasma `delivered_at` no update (não existe em schema) | `bed92ba` |
| 17 | onWhatsApp BR retorna JID legacy sem 9 (formato pré-2012) | `198f228` |
| 18 | Shadow account: foto/dados existem mas conta ativa é só no JID com 9 | `a405b50` |

---

## Migrations da sessão (precisam estar aplicadas)

```bash
ls supabase/migrations/02*.sql 03*.sql
028_ai_concierge.sql           ← pipelines/stages.description (pra Concierge)
029_whatsapp_validation.sql    ← contacts.whatsapp_* + queue
030_unarchive_on_inbound.sql   ← trigger desarquiva ao receber msg
031_contacts_search_ilike.sql  ← search_contacts com ILIKE
```

User confirmou ter aplicado todas no Supabase Studio.

---

## Variáveis de ambiente críticas (Railway)

### `active-api`
```
INTERNAL_API_KEY=<secret compartilhado>
WORKER_INTERNAL_URL=http://active-workers.railway.internal:3030
ANTHROPIC_API_KEY=...
SUPABASE_URL=https://hzhrkfdwzxalaromcffn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

### `active-workers`
```
INTERNAL_API_KEY=<MESMO da api>
INTERNAL_API_URL=https://api.active.eclick.app.br  ← PRESTAR ATENÇÃO: com "active." (não confundir com api.eclick.app.br do SaaS)
WORKER_INTERNAL_PORT=3030
WORKER_INTERNAL_BIND=0.0.0.0  (Dockerfile já seta)
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

---

## Snippet de teste/diagnóstico (Console DevTools)

Pra retomar testando rápido:

```js
// Pega session token e bate em endpoints de diagnóstico
const projectRef = 'hzhrkfdwzxalaromcffn';
const baseName = `sb-${projectRef}-auth-token`;
const cookies = Object.fromEntries(
  document.cookie.split('; ').map(c => {
    const i = c.indexOf('=');
    return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))];
  })
);
let raw = cookies[baseName] ?? '';
if (!raw) {
  let i = 0;
  while (cookies[`${baseName}.${i}`]) raw += cookies[`${baseName}.${i++}`];
}
if (raw.startsWith('base64-')) raw = atob(raw.slice(7));
const session = JSON.parse(raw);
const auth = { Authorization: 'Bearer ' + session.access_token };
window._auth = auth; // pra reusar

// Health
fetch('https://api.active.eclick.app.br/health?_=' + Date.now(), { cache: 'no-store' })
  .then(r => r.json()).then(d => console.log('commit:', d.commit));

// Pega última conversa + mensagens
async function debugLast() {
  const inbox = await (await fetch('https://api.active.eclick.app.br/conversations?limit=1', { headers: auth })).json();
  const conv = inbox.data?.[0];
  console.log('Conv:', conv?.id, '·', conv?.contact_name);
  const msgs = await (await fetch('https://api.active.eclick.app.br/conversations/' + conv.id + '/messages?limit=5', { headers: auth })).json();
  console.log(JSON.stringify((msgs.data ?? msgs).map(m => ({
    direction: m.direction, status: m.status, text: m.plain_text?.slice(0, 30),
    error_code: m.error_code, error_message: m.error_message
  })), null, 2));
}
window.debugLast = debugLast;

// Re-verifica WhatsApp do contato da conversa atual
async function reverify() {
  const inbox = await (await fetch('https://api.active.eclick.app.br/conversations?limit=1', { headers: auth })).json();
  const contactId = inbox.data?.[0]?.contact_id;
  const r = await (await fetch('https://api.active.eclick.app.br/contacts/' + contactId + '/verify-whatsapp', {
    method: 'POST',
    headers: auth,
  })).json();
  console.log(JSON.stringify(r.result, null, 2));
}
window.reverify = reverify;

console.log('Helpers prontos: debugLast(), reverify()');
```

---

## Como retomar com o Claude (próxima sessão)

Primeira mensagem sugerida:

> Lê `HANDOFF.md` em `C:\Users\ECLICK 1\eclick-active\` e a memory. Continuando bug ativo do "Nova conversa" — mensagem outbound não chega na Deiselene mesmo com JID `5571994095636@s.whatsapp.net`. Bug 18 da lista. Já temos log de debug não-commitado em `apps/workers/src/whatsapp/baileys.session.ts`. Próximos passos no início do HANDOFF (commit do log + teste manual + investigar JID `@lid` ou cache Baileys).

Ou se quiser começar features novas:

> Lê `HANDOFF.md`. Quero começar bloco novo: [descrição]. AI Concierge + Conversa Ativa estão em produção (com bug ativo no envio outbound).

---

## Comandos úteis

```bash
# Type-check 4/4 (sempre rodar antes de commit)
node node_modules/typescript/bin/tsc --noEmit -p packages/shared/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p apps/api/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p apps/workers/tsconfig.json

# Status git
git status --short
git log --oneline -10

# Diagnóstico Concierge
curl -s "https://api.active.eclick.app.br/health?_=$(date +%s)" | jq

# Subir migration manualmente
cat supabase/migrations/0XX_*.sql  # cola no Supabase Studio
```

---

## TODOs flagados (próximos blocos plausíveis)

1. **Resolver bug do envio outbound** (PRIORIDADE 1)
2. **Métricas visuais do AI Concierge** no dashboard (custo total, latência, leads roteados, taxa de sucesso por intent)
3. **Indicador "digitando..." real** via Baileys (`sock.sendPresenceUpdate('composing', jid)`) durante o response_delay
4. **UI editor de automações estilo Kommo** (drag-drop blocks, mais visual que o atual)
5. **Email provider real** (nodemailer + SMTP, hoje é stub)
6. **Page builder com IA** + páginas publicadas (commit `9519764` da sessão anterior — testado parcialmente)
