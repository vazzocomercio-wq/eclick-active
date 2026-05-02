# DEPLOY — e-Click Active

Guia passo a passo pra subir o monorepo em produção. Stack:

| Componente | Plataforma | Domínio |
|---|---|---|
| **Web** (Next.js 15) | Netlify | `active.eclick.app.br` |
| **API** (NestJS) | Railway (Docker) | `api.active.eclick.app.br` |
| **Workers** (Baileys) | Railway (Docker) | privado (interno) |
| **DB** | Supabase Cloud | `hzhrkfdwzxalaromcffn.supabase.co` |

---

## 0. Pré-requisitos

- Conta Railway com billing ativo (Free tier não suporta Docker custom + persistência)
- Conta Netlify
- Acesso ao DNS do domínio `eclick.app.br` (Cloudflare/Registro.br/etc.)
- Supabase project já provisionado e migrations aplicadas (001 → 016)
- Variáveis abaixo coletadas:
  - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
  - `ANTHROPIC_API_KEY` (claude.com/console)
  - `OPENAI_API_KEY` (opcional — só pra embeddings da KB e match semântico)
  - `INTERNAL_API_KEY` — gere com `openssl rand -hex 32` (mesmo valor em api e workers)

---

## 1. Railway — API + Workers

Railway suporta Dockerfiles direto do GitHub. Vamos criar **2 services** no mesmo project pra que `api` e `workers` falem via rede privada.

### 1.1 Project setup

1. Acessa [railway.app](https://railway.app/new) → **New Project** → **Deploy from GitHub repo**
2. Seleciona `vazzocomercio-wq/eclick-active`. Branch: `main`.

### 1.2 Service `api`

1. Após o import, Railway cria 1 service. Renomeia pra **api**.
2. **Settings → Source** → **Root Directory**: deixa vazio (monorepo root).
3. **Settings → Build** → **Dockerfile path**: `apps/api/Dockerfile`.
4. **Settings → Deploy** → **Start Command**: deixa vazio (Dockerfile já tem CMD).
5. **Variables** — adiciona TODAS as vars do `apps/api/.env.example`:
   - `PORT` = 3001
   - `CORS_ORIGINS` = `https://active.eclick.app.br,https://www.active.eclick.app.br`
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - `ANTHROPIC_API_KEY`
   - `OPENAI_API_KEY` (opcional)
   - `INTERNAL_API_KEY` (gerado acima)
   - `WORKER_INTERNAL_URL` = `http://workers.railway.internal:3030` (ajusta o nome do service depois)
6. **Settings → Networking** → **Generate Domain** → marca como `api-production-xxxx.up.railway.app` (temporário). Vamos trocar por custom domain abaixo.

### 1.3 Service `workers`

1. No mesmo project: **+ New** → **GitHub Repo** → mesmo repo.
2. Renomeia o service pra **workers**.
3. **Settings → Build** → **Dockerfile path**: `apps/workers/Dockerfile`.
4. **Variables**:
   - `WORKER_INTERNAL_PORT` = 3030
   - `INTERNAL_API_URL` = `http://api.railway.internal:3001` (ou usa o domínio público temporário)
   - `INTERNAL_API_KEY` = **mesmo valor** do api
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `BAILEYS_LOG_LEVEL` = `warn`
   - `BAILEYS_POLL_INTERVAL_SEC` = 3
5. **Settings → Networking** → **Public Networking**: **OFF** (workers não precisa internet pública). Ativa apenas **Private Networking**.
6. Volume persistente pro estado do Baileys: **Settings → Volumes** → **+ Add Volume** → mount em `/app/apps/workers/baileys-state`. (Estado se perde se Container reiniciar — Baileys precisa re-pareamento via QR sem volume.)

### 1.4 Custom domain pra API

1. **Service api → Settings → Networking → Custom Domain** → adiciona `api.active.eclick.app.br`.
2. Railway mostra um CNAME tipo `xxxxx.up.railway.app`. Vai pra seção 3 (DNS).
3. Após validar DNS, Railway emite TLS automático (Let's Encrypt).

### 1.5 Após deploy

- Logs: `Deployments → último deploy → View Logs`. Espera ver:
  - `[api] e-Click Active API listening on port 3001`
  - `[api] CORS allowed origins: https://active.eclick.app.br, https://www.active.eclick.app.br, ...`
- Testa: `curl https://api.active.eclick.app.br/` (ainda sem auth → vai dar 401, mas confirma que sobe)

---

## 2. Netlify — Web

### 2.1 Site setup

1. [netlify.com](https://app.netlify.com/start) → **Import from Git** → `vazzocomercio-wq/eclick-active`.
2. **Build settings** (Netlify deve detectar via `netlify.toml` automaticamente — só confirma):
   - **Base directory**: vazio
   - **Build command**: `npm install && npm run build:shared && npm run build --workspace=@eclick-active/web`
   - **Publish directory**: `apps/web/.next`
   - **Functions directory**: `.netlify/functions-internal`
3. **Plugin**: `@netlify/plugin-nextjs` (já no `netlify.toml`).

### 2.2 Environment variables

Em **Site settings → Environment variables**, adiciona:

```
NEXT_PUBLIC_API_URL=https://api.active.eclick.app.br
NEXT_PUBLIC_SUPABASE_URL=https://hzhrkfdwzxalaromcffn.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
NODE_VERSION=20
NPM_VERSION=10
NEXT_TELEMETRY_DISABLED=1
```

Marca todas como "All deploy contexts".

### 2.3 Custom domain

1. **Domain settings** → **Add custom domain** → `active.eclick.app.br`.
2. Adiciona também `www.active.eclick.app.br` (redireciona pro apex via `netlify.toml`).
3. Netlify mostra os DNS records que precisa criar — vai pra seção 3.
4. TLS é automático (Let's Encrypt) após DNS validar.

---

## 3. DNS — `eclick.app.br`

No painel do registrador (Cloudflare recomendado pela edge + DNSSEC):

| Type | Name | Value | TTL |
|---|---|---|---|
| `A` | `active` | `<IP que Netlify dá>` ou usa **ALIAS/CNAME** pra `<seu-site>.netlify.app` | 300 |
| `CNAME` | `www.active` | `<seu-site>.netlify.app` | 300 |
| `CNAME` | `api.active` | `<your-api>.up.railway.app` (Railway dá esse value após adicionar custom domain) | 300 |

> **Cloudflare**: marca os registros do `active` e `www.active` como **Proxied** (laranja) pra ganhar CDN+DDoS protection. O `api.active` deixa como **DNS only** (cinza) pra não ter Cloudflare entre Railway e o cliente — o WebSocket do Socket.IO funciona melhor sem proxy intermediário.

Aguarda propagação (`dig active.eclick.app.br`, 5–30 min). Netlify e Railway detectam automaticamente.

---

## 4. Supabase — CORS + URL allowlist

No Supabase Studio → **Authentication → URL Configuration**:

- **Site URL**: `https://active.eclick.app.br`
- **Redirect URLs** (adiciona todos):
  - `https://active.eclick.app.br/**`
  - `https://www.active.eclick.app.br/**`
  - `http://localhost:3000/**` (pra dev)

Em **Project Settings → API → CORS** (se houver — Supabase normalmente já lida sozinho com REST):
- Permite `https://active.eclick.app.br`, `https://www.active.eclick.app.br`.

---

## 5. Verificação pós-deploy

Checklist:

- [ ] `curl https://api.active.eclick.app.br/` retorna 401 (sem auth — comportamento esperado)
- [ ] `https://active.eclick.app.br` carrega (sem TLS warning)
- [ ] Login funciona (testa email/senha existente)
- [ ] Inbox carrega conversas
- [ ] Manda mensagem nova → status atualiza em tempo real (Socket.IO funcionando)
- [ ] Recebe inbound do WhatsApp → aparece sem refresh (workers + Baileys + realtime OK)
- [ ] Suggestion bar de IA aparece em conversas com mensagens (ANTHROPIC_API_KEY configurada)
- [ ] `/configuracoes/agente-ia/skills` lista skills (15+ migrations aplicadas)

---

## 6. Operação contínua

### Logs
- Railway: `Deployments → View Logs` (em tempo real)
- Netlify: `Deploys → último → Function logs` (Next.js SSR)
- Supabase: `Logs → Postgres / API / Realtime`

### Rollback
- **Netlify**: `Deploys → versão anterior → Publish deploy`
- **Railway**: `Deployments → versão anterior → Redeploy` (3 cliques)

### Migrations
- Sempre aplica via Supabase Studio SQL Editor (manual — é a convenção do projeto)
- Atualiza `HANDOFF.md` com a próxima migration number livre depois de aplicada

### Restart de services
- Railway: `Settings → Danger Zone → Restart`
- Netlify: redeploy via "Trigger deploy" no UI

---

## 7. Cost estimate (referência inicial)

| Serviço | Plan | Custo mensal aproximado |
|---|---|---|
| Railway api | Hobby ($5/mo) ou Pro ($20+/mo) | $5 – $20 |
| Railway workers | Hobby (com volume) | $5 – $10 |
| Netlify | Starter (free) ou Pro ($19/mo) | $0 – $19 |
| Supabase | Free tier ou Pro ($25/mo) | $0 – $25 |
| Anthropic API | Pay-per-use | $5 – $50/mo (depende do tráfego) |
| OpenAI embeddings | Pay-per-use | $1 – $10/mo |
| **Total inicial** |  | **~$15 – $135/mo** |

---

## 8. Troubleshooting

### `CORS bloqueado: <origin>`
- Confere `CORS_ORIGINS` no Railway service `api`. Tem que conter o domínio que está fazendo a request.

### Socket.IO fica desconectando
- Cloudflare proxy interfere com WebSocket — desabilita o proxy (cinza) no `api.active.eclick.app.br`.
- Confere se Railway tem upgrade pra WebSocket habilitado (default sim).

### Baileys não mantém pareamento entre deploys
- Sem volume persistente no service workers, o estado se perde. Confere que o volume está montado em `/app/apps/workers/baileys-state`.

### Build falha no Netlify por memória
- Netlify Free dá 8GB de build. Se passar, ativa `NEXT_BUILD_TARGET=server` ou aumenta plano.

### Lint bloqueia deploy
- O `next.config.ts` tem `eslint.ignoreDuringBuilds = true` por design. Type-check (estrito) roda no CI/turbo separadamente, é a fonte de verdade.

---

## 9. Próximos passos (não cobertos aqui)

- **CI/CD**: GitHub Action que roda `npm run type-check + npm run build:all` em cada PR antes de merge
- **Monitoring**: Sentry pro front + Logflare pra Railway
- **CDN de assets**: Cloudflare R2 pra mídia do WhatsApp (hoje fica em Supabase Storage se configurado)
- **Backups**: Supabase faz daily backup automático no plano Pro
