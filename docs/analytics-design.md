# Active Intelligence (Ads & Social Analytics + Hub) — Design Doc

> Documento canônico do projeto. Lê isso ao iniciar nova sessão.
> Última atualização: **2026-05-05** (escopo + decisões fechadas, código não iniciado).

---

## Status

**Fase atual**: design fechado, aguardando GO pra começar Bloco A.

**Última coisa feita**: Responsividade Fase 1 (commit `ad74671`).

**Próxima ação**: implementar **Bloco A** (LlmProvider abstraction).

---

## O que é

Sistema de **monitoramento ativo + alertas inteligentes** pro CRM Active.

**Não confundir** com o Intelligence Hub do `eclick-backend` (SaaS) — esse já está em produção lá e tem foco diferente (estoque/preço/margem de marketplace). Este aqui é pro **Active (CRM)** e foca em:

1. **Performance de campanhas pagas** (Meta + Google Ads) — spend, ROAS, CPL, CTR, etc.
2. **Dados orgânicos** das contas/perfis (alcance, seguidores, engajamento)
3. **Leads que vieram dessas campanhas** (Meta Lead Ads via webhook → vira `contact` no CRM)
4. **Atribuição last-click** via UTM no contato/deal — fecha o ciclo "anúncio → lead → conversa → deal → R$"
5. **Alertas via WhatsApp** pro gestor cadastrado quando algo merece atenção

A inteligência é o que **o SaaS não tem**: cruzar marketing pago + Concierge IA + funil de vendas.

---

## Decisões fechadas (não revisitar sem motivo)

| # | Pergunta | Decisão |
|---|---|---|
| 1 | Plataformas no MVP | **Meta + Google Ads** |
| 2 | Auth flow | **OAuth nativo desde MVP** |
| 3 | Webhook Meta Lead Ads no MVP | **Sim** |
| 4 | Granularidade de métricas | **Campaign-level** (adset/ad fica Fase 2) |
| 5 | Atribuição | **Last-click UTM** |
| 6 | Camada 4 (LLM narrativa) no MVP | **Sim, opcional por org** |
| 7 | Abstração `LlmProvider` antes do Analytics | **Sim, Bloco A primeiro** |

**Princípio adicional do user**: as métricas monitoradas são **editáveis** — user escolhe subset do catálogo curado por plataforma + define thresholds. IA opera em camadas (ver abaixo) que respeitam essa configuração.

**LLM provider e modelo**: selecionável pelo user, por org. Suporte: `claude-sonnet-4-6`, `claude-opus-4`, `gpt-5`, `gpt-5-mini`, `gemini-2.5-pro`, `gemini-2.5-flash`. Camadas 1-3 funcionam sem LLM.

---

## Arquitetura — 4 camadas de inteligência

A IA não é caixa preta. São 4 camadas independentes:

### Camada 1 — Regras determinísticas (sempre ativa)
SQL puro. Pra cada métrica `enabled=true` com `threshold_mode='manual'`:
```
SE valor_atual VIOLA target_value POR > critical_pct → signal critical
SE VIOLA POR > warning_pct → signal warning
```
Custo zero. Latência ms. Previsível. **99% dos alertas saem daqui.**

### Camada 2 — Anomaly detection estatística (opt-in)
Quando `threshold_mode='auto'`:
```
baseline = média rolling de N dias (default 30)
σ = desvio padrão
SE valor_atual desvia > 2σ → warning ; > 3σ → critical
```
Útil pra métricas voláteis. Ainda SQL puro.

### Camada 3 — Sinais compostos (templates)
Cruzam várias métricas. User liga/desliga, **não** escreve fórmula. Templates iniciais:
- `creative_fatigue` — CTR↓ + frequency↑ + CPC↑
- `audience_burnout` — frequency > 4 + CTR cai > 30% em 7d
- `scaling_inefficiency` — spend dobra mas conversões crescem < 50%
- `pixel_drift` — conversões caem > 50% sem mudar spend (pixel quebrado?)
- `lead_unattended` — lead de ad chegou e não recebeu resposta em > 1h

### Camada 4 — Narrativa via LLM (opcional por org)
LLM recebe `{metric_key, current, threshold, severity, contexto}` e escreve a mensagem WhatsApp humana. Resumo semanal toda segunda 8h consolida tudo. **Org sem provider configurado** ainda recebe alerta — só com texto template cru ("ROAS 1.8x abaixo de 3x").

---

## Os 8 blocos sequenciais

### Bloco A — `LlmProvider` abstraction (FAZER PRIMEIRO)
**Goal**: substituir `AnthropicClient` cravado por interface genérica resolvida por org.

**Migration 040**: `org_llm_credentials` (org_id PK, provider, api_key_ciphertext via AES-GCM, model_default, updated_at).

**Files**:
- `apps/api/src/common/llm/llm-provider.interface.ts` — `LlmProvider` contract: `chat({system, messages, max_tokens, json_mode}) → {text, inputTokens, outputTokens, latencyMs, costUsd}`
- `apps/api/src/common/llm/anthropic.provider.ts`
- `apps/api/src/common/llm/openai.provider.ts`
- `apps/api/src/common/llm/google.provider.ts`
- `apps/api/src/common/llm/llm.service.ts` — resolve provider por org, cacheia client, tracking unificado em `ai_interactions`
- `apps/api/src/common/llm/llm.module.ts` (@Global)

**Refactor consumers** (substituir Anthropic SDK direto):
- `apps/api/src/modules/ai/ai-concierge.service.ts` (greeting + route)
- `apps/api/src/modules/re-engagement/re-engagement.service.ts`
- `apps/api/src/modules/attachments/attachments.service.ts` (Vision + audio summary)
- `apps/api/src/modules/ai/ai.service.ts` se chamar Anthropic direto
- `apps/api/src/modules/copilot/copilot.service.ts` se chamar

**Endpoints**:
- `GET /settings/llm` — provider + model atual (sem expor api_key)
- `PATCH /settings/llm` — atualiza provider/model/api_key

**Env novo**:
- `LLM_CRED_ENCRYPTION_KEY` (32 bytes hex, gerar com `openssl rand -hex 32`)

**Models suportados (catálogo)**:
- `anthropic`: `claude-sonnet-4-6`, `claude-opus-4`, `claude-haiku-4`
- `openai`: `gpt-5`, `gpt-5-mini`, `gpt-4.1`
- `google`: `gemini-2.5-pro`, `gemini-2.5-flash`

**Estimativa**: ~2h.

---

### Bloco B — Ad Integrations + OAuth Meta
**Migration 041**: `ad_integrations` (org_id, platform, ad_account_id, account_name, access_token_ciphertext, refresh_token_ciphertext, expires_at, scope, status, last_sync_at, error_message).

**Files**:
- `apps/api/src/modules/ads/ad-integrations.service.ts` — OAuth init/callback, refresh automático
- `apps/api/src/modules/ads/oauth/meta-oauth.controller.ts`
- `apps/api/src/modules/ads/ads.module.ts`

**Endpoints**:
- `GET /ad-integrations/meta/connect` — gera URL OAuth (state CSRF, scopes)
- `GET /ad-integrations/meta/callback` — recebe code, troca por token, persiste
- `GET /ad-integrations` — lista contas conectadas
- `DELETE /ad-integrations/:id` — desconecta

**Você fornece (env novos)**:
- `META_APP_ID`
- `META_APP_SECRET`
- `META_OAUTH_REDIRECT_URI` (default `https://active.eclick.app.br/api/ad-integrations/meta/callback`)

**Setup do user**: criar app Meta em developers.facebook.com tipo "Business" com scopes `ads_read`, `pages_show_list`, `leads_retrieval`, `pages_read_engagement`.

**Estimativa**: ~3h.

---

### Bloco C — Meta Connector + Sync
**Migration 042**: `ad_campaigns` (id, org_id, integration_id, platform, external_id, name, status, objective, daily_budget, lifetime_budget, started_at, ended_at, raw, updated_at).

**Migration 043**: `ad_metrics_daily` (id, org_id, campaign_id, platform, date, spend, impressions, clicks, ctr, cpc, cpm, conversions, cost_per_conversion, roas, raw_metrics jsonb) **PARTITION BY RANGE (date) com partições mensais**.

**Files**:
- `apps/api/src/modules/ads/connectors/meta.connector.ts` — chama Marketing API: `/me/adaccounts`, `/{ad_account_id}/campaigns`, `/{ad_account_id}/insights` (level=campaign)
- `apps/api/src/modules/ads/ads-sync.worker.ts` — cron `*/1h` pra cada `ad_integration` ativa: campaigns + 7 dias de insights
- Backfill on-connect: ao plugar, puxa últimos 90 dias

**Endpoint**: `POST /ad-integrations/:id/sync` (manual trigger)

**Dependência npm**: `node-fetch` já vem com Node 20. Não precisa Meta SDK — fetch direto.

**Estimativa**: ~4h.

---

### Bloco D — Google Ads Connector
**Files**:
- `apps/api/src/modules/ads/oauth/google-oauth.controller.ts`
- `apps/api/src/modules/ads/connectors/google-ads.connector.ts`

**Você fornece (env novos)**:
- `GOOGLE_ADS_DEVELOPER_TOKEN` ⚠️ requer aprovação Google (~3-7d). **Pedir agora pra ter pronto quando chegar neste bloco.**
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI`

**Setup user**: criar projeto Google Cloud + ativar Google Ads API + OAuth credentials + request developer token via https://ads.google.com/aw/apicenter.

**Dependência npm**: `google-ads-api` (cuida de auth + rate limiting).

**Schema reusa** `ad_integrations`, `ad_campaigns`, `ad_metrics_daily` (já têm coluna `platform`).

**Estimativa**: ~4h.

---

### Bloco E — Metric Catalog + Configs
**Migration 044**: `ad_metric_catalog` (key PK, platform, display_name, description, data_type, direction, aggregation, unit). Read-only pro user, populada via SQL seed (~150 Meta + ~200 Google).

**Migration 045**: `ad_metric_configs` (org_id, metric_key, enabled, threshold_mode, target_value, warning_pct, critical_pct, baseline_window_days, aggregation_window, routing_manager_ids[]).

**Files**:
- `apps/api/src/modules/ads/metric-catalog.service.ts` (read-only)
- `apps/api/src/modules/ads/metric-config.service.ts` (CRUD)

**Defaults opinionados** quando org conecta primeira conta: ROAS, CPA, CTR, Frequency, Spend, ROAS últimos 7d → todos `enabled=true` com `threshold_mode='manual'` e thresholds sugeridos.

**Endpoints**:
- `GET /ad-metric-catalog?platform=meta` — lista completa com metadata
- `GET /ad-metric-configs` — seleção atual da org
- `PATCH /ad-metric-configs/:metric_key` — toggle/edita threshold

**Estimativa**: ~3h (catálogo grande, mas é dado estático).

---

### Bloco F — Lead Ads Webhook + Concierge link
**Migration 046**: `ad_leads` (org_id, platform, ad_id, campaign_id, raw_payload, processed_at, contact_id, conversation_id, source_form_id).

**Files**:
- `apps/api/src/modules/ads/webhooks/meta-lead.controller.ts`
  - `GET /webhooks/meta/lead-ads?hub.verify_token=...` — verificação inicial
  - `POST /webhooks/meta/lead-ads` — recebe leads
    - Valida `X-Hub-Signature-256` com `META_APP_SECRET`
    - Cria row em `ad_leads`
    - Promove pra `contacts` (cria/atualiza por phone)
    - Adiciona tag `LEAD_META_<campaign_slug>` (UPPERCASE_SNAKE_CASE)
    - Cria conversa com `metadata.source_campaign={name, id, ad_id}`
    - Dispara Concierge greeting (já com contexto da campanha disponível na persona)

**Você fornece**: configurar webhook URL no app Meta (Painel > Webhooks > Page > leadgen) + `META_WEBHOOK_VERIFY_TOKEN` (eu gero, você cola).

**Estimativa**: ~2h.

---

### Bloco G — Signal Detector (Camadas 1+2+3)
**Migration 047**: `ad_signals` (id, org_id, platform, campaign_id, signal_type, severity, current_value, threshold_value, payload, dedupe_key, generated_at, status).

**Files**:
- `apps/api/src/modules/ads/signals/signal-detector.service.ts`
  - Camada 1 (manual thresholds): SQL puro contra `ad_metric_configs` × `ad_metrics_daily`
  - Camada 2 (auto baseline): rolling avg ± 2σ por métrica
  - Camada 3 (composed templates): hard-coded `creative_fatigue`, `audience_burnout`, `scaling_inefficiency`, `pixel_drift`, `lead_unattended`
- `apps/api/src/modules/ads/signals/signal-detector.worker.ts` — cron `*/15min` pra todas as orgs com Analytics ativo

**Estimativa**: ~4h.

---

### Bloco H — Alert Managers + Routing + Delivery (Camada 4)
**Migrations 048, 049, 050**:
- `alert_managers` (org_id, name, phone, department, preferences jsonb, verification_code, verification_expires_at, verified_at)
- `alert_routing_rules` (org_id, signal_type, min_severity, manager_ids[], delivery_mode, business_hours_only)
- `alert_deliveries` (org_id, signal_id|signals_batch[], manager_id, message_text, channel_message_id, status, retry_count, ack_at, sent_at)

**Files**:
- `apps/api/src/modules/alerts/alert-managers.service.ts` — CRUD + `verify-phone` (envia código WhatsApp via Baileys) + `confirm-phone`
- `apps/api/src/modules/alerts/alert-routing.service.ts`
- `apps/api/src/modules/alerts/alert-engine.service.ts`:
  - Lê `ad_signals` pendentes
  - Dedupe por `dedupe_key` na janela
  - Routing → resolve managers
  - Delivery `immediate` envia já / `digest_*` agrupa
  - **Camada 4**: monta texto via `LlmService.chat(orgId, ...)` se org tem provider; senão template cru
  - Dispatch via `ChannelDispatcherService`
  - Registra em `alert_deliveries`
- `apps/api/src/modules/alerts/alert-engine.worker.ts`:
  - Tick `*/5min` pra `immediate`
  - Cron `0 8,14,18 * * *` pra digests (no tz da org via `getOrgTimezone`)
  - Cron `0 8 * * 1` resumo semanal (LLM consolida)

**Endpoints**:
- `GET/POST/PATCH/DELETE /alert-managers`
- `POST /alert-managers/:id/verify-phone`
- `POST /alert-managers/:id/confirm-phone`
- `GET/POST /alert-routing-rules`
- `GET /alert-deliveries`
- `GET /ad-signals?status=pending|sent`

**Estimativa**: ~5h.

---

## Ordem de execução

```
A (LlmProvider) ─┐
                 ├─→ todos os outros usam LlmService
B (Integrations) ─→ C (Meta sync) ──┐
                                    ├─→ E (Catalog/Config)
                  → D (Google sync) ─┘                    ├─→ G (Detector) ─→ H (Alerts)
                                                          ↓
                                  F (Lead webhook) ───────┘
```

**Dependência crítica**: D depende do `GOOGLE_ADS_DEVELOPER_TOKEN` que demora 3-7d. Solicitar agora junto com Bloco B pra estar pronto quando chegar em D.

---

## Tempo total estimado

| Bloco | Estimativa |
|---|---|
| A — LlmProvider | 2h |
| B — Ad Integrations + OAuth Meta | 3h |
| C — Meta Connector + Sync | 4h |
| D — Google Ads Connector | 4h + espera approval |
| E — Metric Catalog + Configs | 3h |
| F — Lead Ads Webhook | 2h |
| G — Signal Detector | 4h |
| H — Alert Managers + Engine | 5h |
| **Total** | **~27h** distribuído em 6-8 sessões |

---

## Tabela de envs novos

| Env | Bloco | Quem fornece |
|---|---|---|
| `LLM_CRED_ENCRYPTION_KEY` | A | gerado por mim no commit |
| `META_APP_ID` | B | user (developers.facebook.com) |
| `META_APP_SECRET` | B | user |
| `META_OAUTH_REDIRECT_URI` | B | user (default `https://active.eclick.app.br/api/ad-integrations/meta/callback`) |
| `META_WEBHOOK_VERIFY_TOKEN` | F | gerado por mim, user cola no Meta |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | D | user (3-7d approval) |
| `GOOGLE_OAUTH_CLIENT_ID` | D | user |
| `GOOGLE_OAUTH_CLIENT_SECRET` | D | user |
| `GOOGLE_OAUTH_REDIRECT_URI` | D | user |

---

## Tabela de migrations

| # | Nome | Bloco | Particionada |
|---|---|---|---|
| 040 | `org_llm_credentials` | A | não |
| 041 | `ad_integrations` | B | não |
| 042 | `ad_campaigns` | C | não |
| 043 | `ad_metrics_daily` | C | **sim — mensal** |
| 044 | `ad_metric_catalog` | E | não |
| 045 | `ad_metric_configs` | E | não |
| 046 | `ad_leads` | F | não |
| 047 | `ad_signals` | G | não |
| 048 | `alert_managers` | H | não |
| 049 | `alert_routing_rules` | H | não |
| 050 | `alert_deliveries` | H | não (mas considerar particionar se volume crescer) |

---

## Como retomar a sessão (checklist)

Ao iniciar nova sessão sobre este projeto:

1. ✅ Ler este doc inteiro
2. ✅ Ler `HANDOFF.md` (estado geral do repo)
3. ✅ Confirmar último commit: `git -C /c/Users/ECLICK\ 1/eclick-active log -1 --oneline`
4. ✅ Verificar TSC limpo: `npm run type-check`
5. ✅ Perguntar ao user qual bloco começar (default: o próximo na ordem)
6. ✅ Antes de codar, confirmar envs necessários do bloco já estão no `apps/api/.env` (ou no Railway prod)
7. ⚠️ **Não confundir** com Intelligence Hub do `eclick-backend` (SaaS) — é projeto distinto, em produção lá

## Decisões em aberto (precisam ser tomadas em algum momento)

- **Provider LLM default da org "Vazzo"** quando Bloco A entrar em uso — provavelmente `anthropic / claude-sonnet-4-6` (já é o padrão).
- **Plataforma onde testar primeiro** — campanha real Meta da Vazzo? Conta de teste?
- **Volume real esperado de signals/dia** — afeta strategy de dedupe e digest. MVP assume ≤ 500 signals/dia/org.
- **UI completo** está fora do escopo do design. User pediu pra não detalhar UI agora — quando chegar a hora, abrir nova fase de design.

---

## Histórico breve da decisão

- **2026-05-05** — User confirma que Intelligence Hub do SaaS já está em prod e NÃO deve ser replicado no Active. Pivota pra Ads & Social Analytics + Hub adaptado.
- **2026-05-05** — User decide que métricas devem ser editáveis (catálogo + seleção), IA opera em camadas, provider/modelo selecionável por org.
- **2026-05-05** — Respostas do user às 7 decisões: 1b, 2a, 3a, 4a, 5a, 6a, 7a.
- **2026-05-05** — Doc fechado. Aguardando GO pro Bloco A.
