# e-Click Active

CRM de Inteligência Comercial Ativa, AI-first, multi-tenant.

Domínio: [active.eclick.app.br](https://active.eclick.app.br)

## Estrutura (monorepo)

```
eclick-active/
├── apps/
│   ├── api/        # NestJS — REST + webhooks (porta 3001)
│   ├── web/        # Next.js 15 App Router + Tailwind + shadcn/ui (porta 3000)
│   └── workers/    # Node.js — jobs assíncronos, processadores de fila
├── packages/
│   └── shared/     # Tipos TS espelhando o schema do Supabase
├── supabase/
│   └── migrations/ # Schema SQL versionado (001_foundation_schema.sql)
├── turbo.json
└── package.json
```

## Stack

- **Frontend**: Next.js 15 (App Router) + React 19 + Tailwind CSS 3.4 + shadcn/ui
- **Backend**: NestJS 11 + Supabase (PostgreSQL + Auth + Storage)
- **Workers**: Node.js 20 + tsx
- **AI**: Anthropic Claude (Haiku 4.5 default, Sonnet 4.6 para Copilot)
- **Build**: Turborepo + npm workspaces

## Brand

- Cyan: `#00E5FF` (primary)
- Verde: `#4ADE50` (accent / success)
- Dark bg: `#09090B`
- Surface: `#111115`
- Border: `#2A2A2E`

Tema dark/light, dark é default.

## Quick start

```bash
npm install
npm run dev   # roda api (3001), web (3000), workers em paralelo
```

Variáveis de ambiente necessárias em cada app — veja `.env.example` em cada pasta.

## Banco

Migration de fundação em [supabase/migrations/001_foundation_schema.sql](supabase/migrations/001_foundation_schema.sql). Para executar, ver [supabase/README.md](supabase/README.md).
