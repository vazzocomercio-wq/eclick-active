/**
 * KB estática do Copiloto Flutuante v1 do e-Click Active.
 *
 * Cada entry tem:
 *   - routes:   patterns Next.js (ex '/whatsapp', '/automacoes/:id', '/*')
 *               '*' como segmento = wildcard de 1 segmento; final '/*' = qualquer suffix.
 *               ':param' = qualquer valor naquele segmento.
 *   - category: agrupamento pra UI de "ver todos os tópicos"
 *   - title/content: markdown PT-BR
 *
 * Ordem de match: `matchKbEntries` retorna entries cujo route bate, na ordem
 * em que aparecem na constante. Convenção: entries específicas primeiro,
 * '/*' por último.
 */

export interface KbEntry {
  routes: string[];
  category: string;
  title: string;
  content: string;
  tags?: string[];
}

export const KB_CATEGORIES = [
  'GENERAL',
  'INBOX',
  'WHATSAPP',
  'AUTOMATIONS',
  'CONTACTS',
  'DEALS',
  'TASKS',
  'KNOWLEDGE',
  'INTELLIGENCE',
  'COMMERCE',
  'SAC',
  'AGENDA',
  'SOCIAL',
  'CONFIG',
] as const;

export type KbCategory = (typeof KB_CATEGORIES)[number];

export const KB: KbEntry[] = [
  // ── INBOX / CONVERSAS ─────────────────────────────────
  {
    routes: ['/conversas', '/conversas/:id'],
    category: 'INBOX',
    title: 'Caixa unificada de conversas',
    content: [
      'A caixa unificada agrupa **todas as conversas** dos canais conectados (WhatsApp, Instagram, formulários de site, etc).',
      '',
      '- **Filtros**: status (aberta/fechada), atribuição, tags, canal.',
      '- **IA**: classifica intent (orçamento, dúvida, reclamação) e sugere respostas no rodapé.',
      '- **Atalho**: `j`/`k` navega entre conversas.',
      '- Clique numa conversa pra abrir o painel de mensagens com contexto do contato/deal vinculado.',
    ].join('\n'),
    tags: ['inbox', 'conversas', 'mensagens'],
  },
  {
    routes: ['/conversas/:id'],
    category: 'INBOX',
    title: 'Detalhe da conversa',
    content: [
      'Esta tela mostra o thread completo + painel lateral com:',
      '- **Contato vinculado**: nome, telefone, tags, temperatura.',
      '- **Deal aberto** (se houver): valor, etapa, próxima ação.',
      '- **Tarefas e notas** relacionadas.',
      '',
      'Botões importantes:',
      '- **Atribuir** muda o responsável.',
      '- **Resolver** fecha a conversa (move pra lista de fechadas).',
      '- **Mesclar contato** combina duplicidades.',
    ].join('\n'),
    tags: ['conversa', 'thread'],
  },

  // ── WHATSAPP ──────────────────────────────────────────
  {
    routes: ['/configuracoes/whatsapp', '/configuracoes/canais'],
    category: 'WHATSAPP',
    title: 'Conectar WhatsApp via Baileys',
    content: [
      'O Active usa **Baileys** (multi-device, sem API oficial) pra conectar.',
      '',
      '1. Vá em *Configurações → Canais → Adicionar WhatsApp*.',
      '2. Escaneie o QR code com seu celular (WhatsApp → Aparelhos conectados).',
      '3. A sessão é **persistida** — não precisa reconectar a cada reload.',
      '',
      '**Sinal verde** no header do canal = sessão ativa. **Vermelho** = sessão caiu (reabra a tela ou clique *Reconectar*).',
      '',
      '⚠ Use um número dedicado pra evitar bloqueio. Spam massivo é a causa #1 de bloqueio.',
    ].join('\n'),
    tags: ['whatsapp', 'baileys', 'qr', 'sessao'],
  },
  {
    routes: ['/configuracoes/whatsapp', '/configuracoes/canais'],
    category: 'WHATSAPP',
    title: 'Erros comuns de sessão WhatsApp',
    content: [
      '**QR não aparece** → atualize a página; verifique se o backend está rodando (`/health`).',
      '**Sessão cai sozinha** → telefone offline >14 dias; reconecte escaneando QR novamente.',
      '**Mensagens não chegam** → verifique se o channel está marcado como `is_active`.',
      '**Limite de envio** → WhatsApp barra envios em massa de números novos. Aqueça gradualmente.',
    ].join('\n'),
    tags: ['whatsapp', 'troubleshooting'],
  },
  {
    routes: ['/whatsapp-commerce', '/whatsapp-commerce/:slug', '/loja'],
    category: 'COMMERCE',
    title: 'WhatsApp Commerce — vendas pelo chat',
    content: [
      'Loja AI Commerce transforma o WhatsApp em canal de venda completo:',
      '- Catálogo lê do SaaS via bridge (cross-schema view).',
      '- Carrinho persistente por contato; abandono detectado em ~30min.',
      '- Pagamento via Mercado Pago Preferences ou PIX manual (BR Code).',
      '- 7 tools no Copilot (search_products, manage_cart, checkout…).',
      '- Recovery: automação default `cart_abandoned` envia mensagem 1h após.',
    ].join('\n'),
    tags: ['commerce', 'loja', 'pagamento'],
  },

  // ── AUTOMACOES ────────────────────────────────────────
  {
    routes: ['/automacoes', '/automacoes/:id'],
    category: 'AUTOMATIONS',
    title: 'Como funciona o motor de automações',
    content: [
      'Toda automação tem 3 partes:',
      '1. **Trigger** (gatilho): `message_received`, `deal_stage_changed`, `cart_abandoned`, `order_paid`, etc.',
      '2. **Trigger config**: filtros opcionais (canal, intent, valor mínimo…).',
      '3. **Actions**: lista ordenada — `send_message`, `create_task`, `move_deal`, `wait`, `condition` (if/else), e ações de commerce (`send_tracking`, `request_review`).',
      '',
      'O execute roda actions em sequência **best-effort**: erro em uma não para as próximas. Logs ficam em `/automacoes/:id/logs`.',
    ].join('\n'),
    tags: ['automacoes', 'trigger', 'action'],
  },
  {
    routes: ['/automacoes', '/automacoes/:id'],
    category: 'AUTOMATIONS',
    title: 'Placeholders nas mensagens',
    content: [
      'Em `send_message` (e templates) você pode interpolar:',
      '- `{{contact.name}}` / `{{contact.first_name}}`',
      '- `{{cart.total}}` / `{{cart.items_count}}` (em triggers `cart_*`)',
      '- `{{order.number}}` / `{{order.total}}` / `{{order.tracking_code}}` / `{{order.carrier}}` (em triggers `order_*`)',
      '- Campos canônicos via `PlaceholderService`: `{{contato.email}}`, `{{deal.titulo}}` etc.',
      '',
      'Se o campo não resolver, vira string vazia.',
    ].join('\n'),
    tags: ['placeholder', 'template'],
  },
  {
    routes: ['/automacoes', '/automacoes/:id'],
    category: 'AUTOMATIONS',
    title: 'Automações vinculadas a estágio do funil',
    content: [
      'Você pode atrelar uma automação a uma **stage específica** do pipeline.',
      'Quando o trigger é `deal_stage_changed` (ou `deal_created`), o engine só dispara se o deal estiver no `stage_id` da automação.',
      'Se `stage_id` é null, a automação é **global** e dispara independente de stage.',
      'Use isso pra montar fluxos por etapa do funil sem misturar.',
    ].join('\n'),
    tags: ['stage', 'pipeline', 'funil'],
  },
  {
    routes: ['/automacoes', '/automacoes/:id'],
    category: 'AUTOMATIONS',
    title: 'Webhooks de automação',
    content: [
      'Triggers `webhook` aceitam POST externo em `/webhooks/automation/:id` com HMAC opcional.',
      'O payload vai pro `trigger_event.payload` e pode ser usado nas actions (futuro: extração de campos via JSONPath).',
      'Cada execução gera log em `/automacoes/:id/logs` com status (success/partial/failed) + duração.',
    ].join('\n'),
    tags: ['webhook', 'integracao'],
  },

  // ── CONTACTS ──────────────────────────────────────────
  {
    routes: ['/contatos', '/contatos/:id'],
    category: 'CONTACTS',
    title: 'Gerenciar contatos',
    content: [
      'Lista paginada com filtros (tag, temperatura, fonte, busca por nome/telefone/email).',
      '- **Temperatura**: `cold/warm/hot/very_hot` — atualizada por automação ou manual.',
      '- **Tags**: livres (cor por hash). Use pra segmentação em re-engajamento.',
      '- **WhatsApp verified**: badge verde quando o número foi confirmado pelo Baileys.',
      '',
      '**Importar CSV**: Configurações → Importar contatos.',
    ].join('\n'),
    tags: ['contatos', 'crm'],
  },
  {
    routes: ['/contatos/:id'],
    category: 'CONTACTS',
    title: 'Detalhe do contato',
    content: [
      'Mostra timeline completa: conversas, deals, tarefas, notas, atividades de IA.',
      'No header você vê tags, temperatura, fonte e canal preferido.',
      'Botão **Mesclar** combina duplicidades — o contato selecionado vira o canônico.',
    ].join('\n'),
    tags: ['contato', 'timeline'],
  },

  // ── DEALS / FUNIS ─────────────────────────────────────
  {
    routes: ['/funis', '/funis/:id'],
    category: 'DEALS',
    title: 'Funis e deals',
    content: [
      'Cada funil tem stages ordenadas. Deals são cards arrastados entre stages.',
      '- **Drag & drop** atualiza `stage_id` + dispara `deal_stage_changed`.',
      '- **WIP limits** por stage avisam quando entupir.',
      '- **AI score** (0-100) sugere prioridade — calculado pelo intelligence hub.',
    ].join('\n'),
    tags: ['funil', 'pipeline', 'kanban'],
  },
  {
    routes: ['/funis', '/funis/:id'],
    category: 'DEALS',
    title: 'Funil "Anúncios ML" — cards avançam sozinhos',
    content: [
      'Os cards do funil **Anúncios ML** avançam automaticamente, guiados pelo e-Click SaaS:',
      '- Anúncio **publicado** no Mercado Livre → card vai pra **Incluir Campanha**.',
      '- Anúncio entra numa **campanha de promoção** ativa → card vai pra **Incluir ADS**.',
      '- Anúncio entra numa **campanha de ADS** (publicidade paga) → card vai pra **Concluído**.',
      'Cada card mostra um **botão de atalho** pro próximo passo (criar campanha, gerenciar ADS).',
      'Cada mudança de etapa gera uma **tarefa** pro operador: 1 dia de prazo na criação, 3h nas demais.',
      'O avanço é só pra frente — um evento atrasado nunca regride o card. Pra encerrar, mova de "Concluído" pra "Ganho".',
      'Decidiu não fazer ADS? É só arrastar o card pra "Concluído" no kanban.',
    ].join('\n'),
    tags: ['funil', 'anuncios', 'mercado livre', 'automacao'],
  },

  // ── TASKS ─────────────────────────────────────────────
  {
    routes: ['/tarefas'],
    category: 'TASKS',
    title: 'Tarefas e follow-ups',
    content: [
      'Tarefas podem ser criadas manualmente ou por automação (`create_task`).',
      'Status: `pending`, `in_progress`, `completed`, `cancelled`, `overdue`.',
      'Quando uma tarefa **vence sem ser concluída**, dispara `task_overdue` — útil pra alertar agente.',
    ].join('\n'),
    tags: ['tarefa', 'todo'],
  },

  // ── KNOWLEDGE ─────────────────────────────────────────
  {
    routes: ['/conhecimento'],
    category: 'KNOWLEDGE',
    title: 'Base de conhecimento (RAG)',
    content: [
      'A base de conhecimento usa **pgvector** pra busca semântica.',
      '- Adicione documentos (FAQs, scripts, políticas) por categoria.',
      'O atendente IA usa esses docs como contexto ao responder em conversas.',
      '- **Chunking**: docs são fatiados automaticamente em ~500 tokens.',
      '- **Reembedding**: rode quando trocar o modelo de embedding.',
    ].join('\n'),
    tags: ['rag', 'kb', 'embeddings'],
  },

  // ── INTELLIGENCE ──────────────────────────────────────
  {
    routes: ['/intelligence', '/intelligence/:tab'],
    category: 'INTELLIGENCE',
    title: 'Intelligence Hub — analytics A-H',
    content: [
      'O Intelligence Hub do Active organiza analytics em 8 blocos (A-H):',
      '- **A**: Provider de LLM (multi-provider, fallback automático).',
      '- **B**: Métricas de atendimento (tempo de resposta, NPS).',
      '- **C**: Performance de funil (conversão por stage).',
      '- **D**: Análise de conversas (intents, sentiment).',
      '- **E-H**: alertas, previsão, segmentação, recomendações.',
      '',
      'Doc canônico: `eclick-active/docs/analytics-design.md`.',
    ].join('\n'),
    tags: ['analytics', 'intelligence'],
  },
  {
    routes: ['/*'],
    category: 'INTELLIGENCE',
    title: 'Toasts in-app de signals (Active Intelligence)',
    content: [
      'Sempre que o detector inserir um signal pending em ad_signals, um',
      'toast aparece no canto da tela (qualquer rota dentro de /dashboard):',
      '',
      '- **critical** → toast vermelho, fica até dismissar manualmente',
      '- **warning** → toast amarelo, auto-dismiss em 30s',
      '- Click no botão "Ver" leva pra `/intelligence` (tab Signals)',
      '',
      'Dedup por signal_id em memória (Set de 500 últimos) — mesmo signal',
      'não toastra 2x se o socket re-conectar.',
      '',
      'Complementa a entrega WhatsApp por managers (AlertEngine). Toast é pra',
      'quem está com o Active aberto no momento; WhatsApp é pra quem não tá.',
    ].join('\n'),
    tags: ['toast', 'realtime', 'signals', 'intelligence', 'in-app'],
  },
  {
    routes: ['/intelligence', '/configuracoes/ad-metrics'],
    category: 'INTELLIGENCE',
    title: 'Sinais compostos disponíveis (Camada 3 do detector)',
    content: [
      'Além dos sinais por métrica individual (threshold/anomaly), o detector',
      'cruza métricas pra padrões "compostos":',
      '',
      '- **creative_fatigue** — CTR cai >20% + frequência sobe >30% + CPC sobe >20% (7d vs 7d)',
      '- **audience_burnout** — frequência atual >4 + CTR cai >30%',
      '- **scaling_inefficiency** — spend dobra mas conversões crescem <50% (crítico se ≥200%)',
      '- **pixel_drift** — conversões caem >50% mantendo spend praticamente igual',
      '- **roas_collapse** — ROAS médio 7d cai pra <70% do prior (crítico <50%)',
      '- **cpa_inflation** — CPA dobra sem volume proporcional (≥1.5× warning, ≥2× critical)',
      '- **budget_pacing** — gasto diário 7d excede daily_budget configurado',
      '  (≥110% warning, ≥130% critical). Só dispara se campanha tem daily_budget',
      '',
      'Todos dedup por (campaign_id, dia). Ação típica: revisar criativo,',
      'audiência, landing page, ou rebalancear orçamento.',
    ].join('\n'),
    tags: ['signals', 'composed', 'detector', 'patterns'],
  },
  {
    routes: ['/configuracoes', '/configuracoes/ad-metrics', '/intelligence'],
    category: 'INTELLIGENCE',
    title: 'Auditoria de cobertura de métricas (signal detector)',
    content: [
      'Configs de métricas com `enabled=true` que **silenciosamente nunca disparam**',
      'são detectadas pelo audit de cobertura. Causas comuns:',
      '',
      '- **text_incompatible**: métricas tipo ranking (quality_ranking, etc.) —',
      '  pipeline numérico não compara. Status flagged automaticamente.',
      '- **computed_only**: métricas derivadas (conversion_rate, link_ctr…) que',
      '  o connector atual não preenche. Disponível em sprint futura.',
      '- **orphan_no_value**: tem rows em ad_metrics_daily mas a chave nunca',
      '  aparece em raw_metrics — connector não solicita esse field.',
      '- **no_data**: sem rows em ad_metrics_daily na janela. Confirme sync',
      '  Meta/Google (ads-sync-worker).',
      '',
      'Endpoint: `GET /ad-signals/metric-coverage` retorna report completo',
      '(enabled_count, orphan_count, items[]). Também logado como warn no',
      'detector quando rodando.',
    ].join('\n'),
    tags: ['audit', 'coverage', 'signals', 'troubleshooting'],
  },

  // ── SAC ───────────────────────────────────────────────
  {
    routes: ['/sac', '/sac/:tab'],
    category: 'SAC',
    title: 'Central de Atendimento (SAC)',
    content: [
      'O SAC organiza tickets de pós-venda separados das conversas comuns.',
      '- **Riscos** (`/sac/riscos`): identifica clientes em risco de churn via IA.',
      '- **Performance**: KPIs do time (TMA, FCR, CSAT).',
      '- **Templates**: respostas prontas com placeholders.',
    ].join('\n'),
    tags: ['sac', 'suporte', 'pos-venda'],
  },

  // ── AGENDA ────────────────────────────────────────────
  {
    routes: ['/agenda', '/agenda/:date'],
    category: 'AGENDA',
    title: 'Agenda + Google Calendar / Calendly',
    content: [
      'Agenda própria + sync bidirecional com Google Calendar e Calendly.',
      '- **IA detecta intent de agendamento** nas conversas e sugere slots.',
      '- **Tools no Copilot**: `check_available_slots`, `schedule_appointment`, `send_scheduling_link`.',
      'Setup em *Configurações → Integrações*.',
    ].join('\n'),
    tags: ['agenda', 'calendario', 'agendamento'],
  },
  {
    routes: ['/conversas', '/conversas/:id', '/agenda'],
    category: 'AGENDA',
    title: 'IA oferece e marca horário sozinha',
    content: [
      'Quando a IA (Concierge) já **qualificou** um lead cujo serviço precisa de hora marcada, ela **oferece o agendamento** na própria conversa (ex: "Posso já ver os horários disponíveis pra você?").',
      '',
      '- Se o lead **aceita** (ou pede agendamento direto), a IA **busca a agenda real** da equipe e lista os horários livres **numerados**.',
      '- O lead responde só com o **número** → a IA **cria o agendamento automaticamente** e confirma.',
      '- Os horários vêm de quem está **ativo na Equipe** (owner/admin/agent) com **disponibilidade / horário de funcionamento** configurado. Se a pessoa tem *especialidade* cadastrada, a IA tenta casar com o que o lead pediu.',
      '',
      '**Pré-requisito pra aparecer horário:** ao menos 1 membro ativo com agenda/horário comercial em *Configurações → Equipe / Organização*. Sem isso (ou sem vaga livre), o lead recebe um aviso de que a equipe retorna com as opções — a IA **não** promete horário que não existe.',
    ].join('\n'),
    tags: ['agenda', 'agendamento', 'concierge', 'ia', 'slots'],
  },

  // ── SOCIAL ────────────────────────────────────────────
  {
    routes: ['/social', '/producao/conteudo', '/producao/criativos'],
    category: 'SOCIAL',
    title: 'Produção de conteúdo + multi-stage approval',
    content: [
      'Produção AI gera conteúdo pra Instagram/TikTok/LinkedIn:',
      '- **Drafts** com IA (descrição, bullets, capa).',
      '- **Multi-stage approval**: link público pra cliente revisar antes de publicar.',
      '- **A/B tests** automáticos depois do post.',
    ].join('\n'),
    tags: ['social', 'conteudo', 'criativos'],
  },
  {
    routes: ['/social/criar', '/social'],
    category: 'SOCIAL',
    title: 'Criar post: produto do catálogo + design do Canva como imagem',
    content: [
      'Na tela **Criar conteúdo** (`/social/criar`) você tem dois jeitos de dar uma **imagem real** pro post (a imagem gerada por IA no Active ainda cai num placeholder não-publicável):',
      '',
      '**1. Produto do catálogo (SaaS):** escolha um produto no seletor "Produto do catálogo" → a IA escreve o post sobre ele e usa a **foto real** do produto como imagem. Puxa do catálogo do e-Click (ponte SaaS→Active).',
      '',
      '**2. Design do Canva:** no seletor "Imagem do post" clique em **Usar um design do Canva** → busque e escolha um design → o e-Click **exporta** o design como imagem e usa no post (visual branded seu). Precisa ter o **Canva conectado** no e-Click (SaaS → Integrações). A exportação leva alguns segundos.',
      '',
      'Se você escolher os dois, o **Canva tem prioridade** sobre a foto do produto. Toda imagem vira **https** automaticamente — o Instagram recusa imagens http.',
    ].join('\n'),
    tags: ['social', 'criar', 'canva', 'catalogo', 'produto', 'imagem', 'instagram'],
  },
  {
    routes: ['/social/criar', '/social'],
    category: 'SOCIAL',
    title: 'Criar Reel/vídeo com IA (estilo + roteiro)',
    content: [
      'Na aba **Vídeo/Reel** (`/social/criar`) a IA gera um **Reel** a partir de um produto do catálogo:',
      '',
      '**Passo a passo:** escolha o **produto** (a foto dele é a base do vídeo) → escolha **como gerar** (Animar a foto real OU Cena por IA com o produto) → escolha o **estilo** (360°, Cinemagraph, Loop, Unboxing, UGC… — os marcados "experimental" dependem de pessoa/áudio e a qualidade varia) → a **estrutura do roteiro** (Dor+Solução+Benefício, AIDA, PAS…) → duração → **Gerar Reel**.',
      '',
      'A IA escreve o **roteiro + legenda** seguindo o estilo/estrutura e gera o **vídeo** no motor (Kling) — é **assíncrono**, leva de **1 a 3 minutos**. Pode deixar a tela aberta; o preview aparece quando fica pronto. Depois é só **aprovar e publicar** (vai como Reel no Instagram).',
      '',
      '**Custo:** geração de vídeo consome créditos (vídeo é caro). **Dica:** os estilos 🟢 recomendados (produto em movimento) saem melhor que os 🟡 experimentais.',
    ].join('\n'),
    tags: ['social', 'reel', 'video', 'criar', 'instagram', 'kling', 'produto'],
  },
  {
    routes: ['/social/tendencias', '/social'],
    category: 'SOCIAL',
    title: 'Radar de Conteúdo: tendências da sua categoria + o que postar',
    content: [
      'O **Radar de Conteúdo** (`/social/tendencias`) mostra **o que está bombando na sua categoria** e te ajuda a decidir qual conteúdo criar — cruzando tendências externas com o seu comércio (margem, estoque, Radar de mercado).',
      '',
      '**Como usar:**',
      '- Em **Categorias monitoradas** clique **Monitorar** → escolha a **rede** (YouTube, Google Trends, Meta Ad Library, Instagram, TikTok) + a **categoria** (ex: iluminação) + **palavras-chave**. O radar passa a vigiar essa área.',
      '- **Fontes de tendência** mostra o estado de cada conector: 🟢 *coletando* ou ⚪ *planejado* (com a fase em que entra).',
      '- **O que está bombando** lista os **itens individuais** (cada vídeo, criativo, som) com suas métricas próprias (views, etc.) — não só agregados.',
      '- **Sinais de tendência** destacam formatos/sons/temas em alta; **Briefs de conteúdo** são pautas prontas que a IA monta a partir disso.',
      '',
      'O Radar evolui em fases: conectores YouTube + Google Trends, depois Meta Ad Library + Instagram, briefs com IA, e TikTok. As fontes só coletam dados reais quando as chaves de API são conectadas.',
    ].join('\n'),
    tags: ['social', 'tendencias', 'radar', 'trends', 'youtube', 'tiktok', 'meta', 'conteudo', 'o que postar'],
  },

  // ── BLOG IA ───────────────────────────────────────────
  {
    routes: ['/blog-ia'],
    category: 'SOCIAL',
    title: 'Blog IA: gerar, agendar e publicar artigos GEO',
    content: [
      'O **Blog IA** (`/blog-ia`) é o motor de conteúdo do blog público (eclick.app.br/blog). A IA **escreve o artigo + gera a capa**, você **revisa e publica** (humano no controle).',
      '',
      '**Como criar um artigo:**',
      '- Digite o **tema/pauta** + escolha o **pilar** editorial (GEO 101, Ciência aplicada, Como fazer, etc.) → **Gerar artigo**. Leva ~1 min (texto + capa por IA).',
      '- Sem ideia? Em **"A IA sugere pautas"** clique **Sugerir pautas** (ou dê uma semente) → a IA propõe pautas ancoradas nos pilares e nas lacunas do que já foi escrito → **Gerar** em 1 clique.',
      '- **Gerar em lote**: cria 5 artigos de uma vez (a lista atualiza sozinha conforme ficam prontos).',
      '',
      '**GEO embutido:** os artigos já nascem otimizados pra serem **citados pelos motores de IA** (ChatGPT/Gemini/Perplexity) — citam fontes, usam estatísticas, têm FAQ e mapeiam as perguntas que respondem. A IA também pode inserir **1-2 imagens ilustrativas no corpo** do artigo (além da capa).',
      '',
      '**Voz da marca:** no topo, abra **"Voz da marca"** e descreva o tom/diretrizes editoriais (ex: técnico-honesto, sem jargão de guru, sempre citar fontes). A IA **segue isso** ao gerar artigos e sugerir pautas — todo conteúdo sai consistente com a marca.',
      '',
      '**Publicar / agendar:** cada rascunho em revisão tem **Publicar** (vai pro ar na hora em eclick.app.br/blog) ou **Agendar** (escolha data/hora — um worker publica sozinho no horário). **Arquivar** descarta.',
      '',
      '**Visões:** alterne entre **Lista** e **Calendário** (calendário editorial mostra os posts agendados/publicados por dia). Pro controle fino da IA, use o **Estúdio** (botão no topo) → ver tópico do Estúdio do Blog.',
    ].join('\n'),
    tags: ['blog', 'blog-ia', 'geo', 'conteudo', 'artigo', 'publicar', 'agendar', 'voz', 'marca', 'pauta', 'calendario', 'imagem'],
  },
  {
    routes: ['/blog-ia/estudio'],
    category: 'SOCIAL',
    title: 'Estúdio do Blog: prompts editáveis + base de conhecimento',
    content: [
      'O **Estúdio do Blog** (`/blog-ia/estudio`) dá controle fino sobre como a IA escreve:',
      '',
      '**Prompts da IA:** edite os system prompts do **artigo** e das **pautas** direto na UI. Cada um mostra se está no **Padrão** (do código) ou **Personalizado**. Botões: **Salvar**, **Restaurar padrão** (volta pro default) e **✨ Gerar com IA** (descreva o que quer mudar — ex: "tom mais provocador, foco em marketplace BR" — e a IA reescreve o prompt mantendo o formato de saída). Cuidado: editar o prompt muda TODO conteúdo gerado dali em diante.',
      '',
      '**Base de conhecimento:** adicione **URLs** (o e-Click extrai o texto da página) ou **notas/textos** que a IA usa como **referência factual** ao escrever — ela embasa o conteúdo nesses dados (não copia literal). Útil pra injetar dados seus, estudos, ou contexto da sua operação. Some/remova fontes quando quiser.',
    ].join('\n'),
    tags: ['blog', 'estudio', 'prompt', 'conhecimento', 'knowledge', 'geo', 'editar', 'ia'],
  },

  // ── CONFIG ────────────────────────────────────────────
  {
    routes: ['/configuracoes', '/configuracoes/:tab'],
    category: 'CONFIG',
    title: 'Configurações importantes',
    content: [
      '**Canais**: WhatsApp Baileys, Z-API, Instagram, formulários.',
      '**Equipe**: convide membros (roles `owner/admin/agent`).',
      '**LLM**: chave Anthropic/OpenAI/Google + modelo default. Sem chave configurada, cai pro `ANTHROPIC_API_KEY` env.',
      '**Integrações**: Google Calendar, Calendly, Mercado Pago, Slack.',
      '**Marca**: logo, cores e nome usados em e-mails e landing pages.',
    ].join('\n'),
    tags: ['config', 'setup'],
  },
  {
    routes: ['/aceitar-convite', '/configuracoes', '/configuracoes/equipe'],
    category: 'CONFIG',
    title: 'Convidar membros + aceitar convite',
    content: [
      'Owner/admin pode convidar membros em *Configurações → Equipe*:',
      '- Email + display_name + role (owner/admin/agent)',
      '- Plano da org tem limite de membros (campo `max_users`)',
      '',
      '**Fluxo do convidado:**',
      '1. Recebe email "Você foi convidado para o e-Click Active" (template em PT-BR)',
      '2. Clica em "Aceitar convite e criar senha"',
      '3. Cai em `/aceitar-convite` — página completa a sessão a partir do hash',
      '4. Define senha + confirma nome → redireciona pra /central-de-acao',
      '',
      'Backend: `team.service.ts` chama `auth.inviteUserByEmail` passando:',
      '- `redirectTo: <WEB_BASE_URL>/aceitar-convite` (não confia só em Site URL global)',
      '- `data.org_name` no metadata pra mostrar nome no formulário de senha',
      '',
      'Se o link expirar (24h), basta peer novo convite.',
    ].join('\n'),
    tags: ['convite', 'equipe', 'auth', 'onboarding'],
  },
  {
    routes: ['/configuracoes/integracoes', '/configuracoes/llm'],
    category: 'CONFIG',
    title: 'Configurar provedor de LLM',
    content: [
      'Active suporta multi-provider: Anthropic (default), OpenAI, Google.',
      '- Cole a API key do provedor — fica criptografada (AES-256-GCM) no banco.',
      '- Selecione modelo padrão (ex: `claude-haiku-4-5-20251001`, `gpt-4o-mini`).',
      '- Cada feature pode ter override de modelo (ex: `copilot_help` usa Haiku).',
      '- **Fallback**: se a key cair, o provider Anthropic do env é usado (mas perde isolamento por org).',
    ].join('\n'),
    tags: ['llm', 'provider', 'anthropic', 'openai'],
  },
  {
    routes: ['/configuracoes', '/configuracoes/ai-usage'],
    category: 'CONFIG',
    title: 'Uso de IA — custos e orçamento mensal',
    content: [
      'A aba **Uso de IA** mostra o gasto real com chamadas LLM no mês corrente, com:',
      '- **Gasto total** em USD + número de chamadas',
      '- **Tokens** de entrada/saída acumulados',
      '- **Sparkline** dos últimos 30 dias',
      '- **Breakdown** por feature (suggest_response, classify_intent, alert_narrative…) e por modelo',
      '',
      '**Orçamento mensal opcional:**',
      '- Defina valor em USD pra ver % consumido em tempo real',
      '- Threshold (default 80%) dispara alerta no Intelligence Hub',
      '- **Hard cap** liga uma trava: ao atingir 100%, novas chamadas de IA são',
      '  bloqueadas com erro 400 ("Orçamento mensal de IA atingido…") até virar o mês',
      '  ou aumentar o orçamento. Útil pra evitar surpresas na fatura Anthropic.',
      '',
      'Sem orçamento configurado, a página funciona só como telemetria — nada é bloqueado.',
      'Tracking é registrado em `active.ai_interactions` a cada chamada via `LlmService`.',
    ].join('\n'),
    tags: ['ia', 'custos', 'budget', 'cap', 'observabilidade'],
  },
  {
    routes: ['/configuracoes', '/configuracoes/:tab'],
    category: 'CONFIG',
    title: 'Chaves de IA (BYOK) — use seus próprios créditos',
    content: [
      'A aba **Chaves de IA** deixa cada org conectar as **próprias chaves** de IA',
      'pra consumir os créditos dela (não os da plataforma).',
      '',
      '- **Provedor de chat** (Anthropic / OpenAI / Google) + modelo + chave de API.',
      '  A chave fica criptografada (AES-GCM) e só os últimos 4 dígitos aparecem.',
      '- **Chave OpenAI dedicada**: aparece quando o provedor de chat NÃO é OpenAI.',
      '  Necessária pra transcrição de áudio (Whisper), busca semântica (embeddings)',
      '  e geração de imagens (DALL·E) — recursos OpenAI-only.',
      '- **Usar minhas próprias chaves** (modo `own`): quando ligado, a IA usa só as',
      '  chaves da org. **Sem chave, os recursos de IA ficam bloqueados** com um aviso',
      '  "Conecte sua chave de IA" (BYOK obrigatório). Em modo `platform`, usa a chave',
      '  do servidor (default).',
      '',
      '⚠ Ao ligar o modo próprio você precisa salvar a chave de chat antes, senão a IA',
      'trava. Trocar de provedor exige enviar a nova chave.',
    ].join('\n'),
    tags: ['ia', 'byok', 'chave', 'api key', 'openai', 'anthropic', 'gemini', 'creditos'],
  },

  // ── GENERAL fallback ──────────────────────────────────
  {
    routes: ['/*'],
    category: 'GENERAL',
    title: 'Tour rápido pelo Active',
    content: [
      'O e-Click Active é o CRM de **WhatsApp + IA** pra times de venda e atendimento.',
      '',
      '**Top features:**',
      '- 📥 *Caixa unificada* de conversas (WhatsApp, Insta, web).',
      '- 🤖 *Atendente IA* responde com base na sua KB.',
      '- ⚡ *Automações visuais* com triggers + actions.',
      '- 📊 *Funis Kanban* drag-and-drop.',
      '- 🛒 *Loja AI Commerce* — vender direto no chat.',
      '',
      'Use `Cmd/Ctrl + K` pra me chamar em qualquer tela. 👋',
    ].join('\n'),
    tags: ['intro', 'tour'],
  },
  {
    routes: ['/'],
    category: 'GENERAL',
    title: 'Por onde começar?',
    content: [
      '1. Conecte um canal de WhatsApp (*Configurações → Canais*).',
      '2. Importe seus contatos via CSV.',
      '3. Crie 1-2 automações simples (boas-vindas + cart abandonado).',
      '4. Ative o atendente IA com sua base de conhecimento.',
      '5. Acompanhe em */intelligence*.',
    ].join('\n'),
    tags: ['onboarding'],
  },
];

// ───────────────────────────────────────────────
// Matching: pattern Next.js → regex
// ───────────────────────────────────────────────

/**
 * Converte um pattern (`'/automacoes/:id'`, `'/whatsapp/*'`) em regex.
 * Suporta:
 *  - `:param` casa qualquer valor exceto `/`
 *  - `*` casa "qualquer caminho a partir daqui" (greedy até o fim)
 *  - rotas literais casam exato (com ou sem trailing slash)
 */
function patternToRegex(pattern: string): RegExp {
  // Escape regex specials, depois substitui :param e *
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\/\*$/g, '(?:/.*)?') // /* no final = sufixo opcional
    .replace(/\*/g, '[^/]+') // * em meio de path = um segmento
    .replace(/:[^/]+/g, '[^/]+'); // :param = um segmento

  return new RegExp(`^${escaped}/?$`);
}

const COMPILED_KB = KB.map((entry) => ({
  entry,
  regexes: entry.routes.map(patternToRegex),
}));

/**
 * Retorna entries da KB cujo route casa com o pathname dado.
 * Resultado preserva ordem da KB (entries específicas vêm antes de '/*').
 */
export function matchKbEntries(pathname: string): KbEntry[] {
  const normalized = pathname.split('?')[0]?.split('#')[0] ?? pathname;
  const out: KbEntry[] = [];
  for (const { entry, regexes } of COMPILED_KB) {
    if (regexes.some((r) => r.test(normalized))) {
      out.push(entry);
    }
  }
  return out;
}

/** Agrupa KB inteira por category — usado no fallback "ver todos os tópicos". */
export function listKbByCategory(): Record<string, KbEntry[]> {
  const grouped: Record<string, KbEntry[]> = {};
  for (const entry of KB) {
    const c = entry.category;
    if (!grouped[c]) grouped[c] = [];
    grouped[c].push(entry);
  }
  return grouped;
}
