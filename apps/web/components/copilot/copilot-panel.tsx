'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Bot,
  CheckCircle2,
  ClipboardList,
  Compass,
  FileText,
  Headphones,
  Lightbulb,
  Megaphone,
  MessageSquare,
  Package,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  Zap,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChatInput } from '@/components/copiloto/chat-input';
import {
  ChatMessageItem,
  TypingIndicator,
} from '@/components/copiloto/chat-message';
import {
  AnimatedPromptSuggestions,
  type PromptSuggestion,
} from '@/components/ui/animated-prompt-suggestions';
import { useCopilot } from '@/hooks/use-copilot';
import type { CopilotContextType } from '@/lib/api/copilot';
import { cn } from '@/lib/utils';

export interface CopilotPanelProps {
  /**
   * Tipo de contexto. Quando `'general'` ou ausente, comportamento idêntico
   * ao `/copiloto`. Quando `'deal' | 'contact' | 'conversation'`, o backend
   * faz lookup da entidade e injeta o estado dela no prompt do turn.
   */
  contextType?: CopilotContextType;

  /** ID da entidade. Obrigatório quando `contextType !== 'general'`. */
  contextId?: string;

  /**
   * Rótulo exibido no header pra deixar visível qual entidade está em foco
   * (ex: "Acme Corp · #142"). Opcional — se ausente, mostra só o tipo.
   */
  contextLabel?: string;

  /**
   * Modo compacto (drawer/panel embutido). Esconde o header, encolhe chips
   * e padding. Largura fica controlada pelo container pai (~320px típico).
   */
  compact?: boolean;

  /** Mostrar cabeçalho com Bot/Sparkles/limpar histórico. Default: !compact. */
  showHeader?: boolean;

  /** Mostrar texto descritivo (subtítulo) abaixo do título. Default: !compact. */
  showDescription?: boolean;

  /** Classes extras no container raiz. */
  className?: string;
}

/**
 * Painel de copiloto reutilizável. Pode ser renderizado em página inteira
 * (`compact=false`) ou embutido em drawers/sidebars (`compact=true`). Quando
 * `contextType` é fornecido, sugestões rápidas e prompt do modelo recebem
 * contexto da entidade automaticamente.
 *
 * Uso:
 *   <CopilotPanel contextType="general" />                           // página /copiloto
 *   <CopilotPanel contextType="deal" contextId={dealId} compact />   // drawer do deal
 */
export function CopilotPanel({
  contextType = 'general',
  contextId,
  contextLabel,
  compact = false,
  showHeader,
  showDescription,
  className,
}: CopilotPanelProps) {
  const headerVisible = showHeader ?? !compact;
  const descriptionVisible = showDescription ?? !compact;

  // Estabiliza o objeto de contexto pra evitar re-render do hook a cada render
  // do pai. `useMemo` deps são primitivas — só reconstrói quando muda de fato.
  const context = useMemo(
    () => ({
      type: contextType,
      ...(contextId ? { id: contextId } : {}),
    }),
    [contextType, contextId],
  );

  const { messages, thinking, loadingHistory, error, send, clear } = useCopilot(context);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll para o fim em qualquer nova mensagem ou no load do histórico
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, thinking, loadingHistory]);

  function handleSubmit() {
    const trimmed = input.trim();
    if (!trimmed) return;
    setInput('');
    void send(trimmed);
  }

  function handleSuggestion(text: string) {
    setInput('');
    void send(text);
  }

  const isEmpty = !loadingHistory && messages.length === 0;
  const suggestions = QUICK_SUGGESTIONS[contextType];

  return (
    <div className={cn('flex h-full flex-col overflow-hidden', className)}>
      {headerVisible && (
        <header
          className={cn(
            'flex items-center justify-between border-b border-border',
            compact ? 'px-3 py-2' : 'px-6 py-4',
          )}
        >
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <Bot className={cn('text-primary', compact ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
              <h1
                className={cn('font-semibold truncate', compact ? 'text-sm' : 'text-lg')}
              >
                Copiloto IA
              </h1>
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary',
                )}
              >
                <Sparkles className="h-3 w-3" />
                AI
              </span>
            </div>
            {descriptionVisible && (
              <p className="text-xs text-muted-foreground">
                Seu assistente comercial inteligente. Pergunte qualquer coisa sobre seu CRM.
              </p>
            )}
          </div>

          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void clear()}
              className={compact ? 'h-7 px-2' : ''}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Limpar
            </Button>
          )}
        </header>
      )}

      {/* Badge de contexto ativo */}
      {contextType !== 'general' && (
        <ContextBadge type={contextType} label={contextLabel} compact={compact} />
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div
          className={cn(
            'mx-auto flex w-full flex-col',
            compact ? 'gap-3 px-3 py-3 max-w-full' : 'gap-6 px-4 py-6 max-w-3xl',
          )}
        >
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {loadingHistory ? (
            <SkeletonHistory />
          ) : isEmpty ? (
            <EmptyState contextType={contextType} compact={compact} />
          ) : (
            messages.map((m) => <ChatMessageItem key={m.id} message={m} />)
          )}

          {thinking && <TypingIndicator />}
        </div>
      </div>

      <div
        className={cn(
          'border-t border-border bg-background/95',
          compact ? 'px-3 py-3' : 'px-4 py-4',
        )}
      >
        <div
          className={cn(
            'mx-auto flex w-full flex-col gap-3',
            compact ? 'max-w-full' : 'max-w-3xl',
          )}
        >
          {/* Estado vazio = carrossel animado de sugestões. Modo full usa
              3 rows com chips full-size; modo compact (drawer) usa 2 rows
              compactas que cabem em 320px. */}
          {isEmpty && suggestions.length > 0 ? (
            <AnimatedPromptSuggestions
              suggestions={withIcons(contextType, suggestions)}
              onSuggestionClick={(text) => handleSuggestion(text)}
              speed={compact ? 35 : 45}
              rows={compact ? 2 : 3}
              compact={compact}
            >
              <ChatInput
                value={input}
                onChange={setInput}
                onSubmit={handleSubmit}
                disabled={thinking}
                placeholder={PLACEHOLDER[contextType]}
              />
            </AnimatedPromptSuggestions>
          ) : (
            <ChatInput
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              disabled={thinking}
              placeholder={PLACEHOLDER[contextType]}
            />
          )}

          {!compact && (
            <p className="text-center text-[11px] text-muted-foreground">
              Enter para enviar · Shift+Enter para nova linha
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Contextual quick suggestions
// ──────────────────────────────────────────────────────────

const QUICK_SUGGESTIONS: Record<CopilotContextType, string[]> = {
  general: [
    'Quais leads priorizar hoje?',
    'Resumo do meu funil',
    'Tarefas pendentes',
    'Por que perdi vendas esta semana?',
    'Crie follow-up para leads sem resposta',
    'Quais clientes não respondem há mais de 5 dias?',
    'Performance da equipe esta semana',
    'Análise de objeções recorrentes',
    'Sugestões para aumentar conversão',
    'Leads quentes sem atendimento',
    'Próximas tarefas críticas',
    'Onde estou perdendo deals?',
    // ── SAC ──
    'Quais tickets críticos eu tenho agora?',
    'Resumo do SAC hoje',
    'Performance do SAC esta semana',
    'Tickets com SLA vencido',
    'Pedidos atrasados sem ticket',
    'Quais produtos têm mais reclamações?',
    // ── Social AI ──
    'Cria um post sobre lançamento',
    'Faz carrossel de prova social',
    'Conteúdos pendentes de aprovação',
    'Resumo do Social AI hoje',
  ],
  deal: [
    'Próxima ação?',
    'Risco de perda?',
    'Gerar proposta',
    'Criar follow-up',
    'Análise da negociação',
    'Sugestões de fechamento',
    'Histórico de interações',
    'Comparar com deals similares',
    'Pontos de atenção',
  ],
  contact: [
    'Resumo do cliente',
    'Histórico de objeções',
    'Melhor abordagem',
    'Perfil de comportamento',
    'Probabilidade de compra',
    'Tópicos de interesse',
    'Próximos passos sugeridos',
    'Análise de engajamento',
    'Deals anteriores',
  ],
  conversation: [
    'Resumir conversa',
    'Sugerir resposta',
    'O que o cliente quer?',
    'Identificar urgência',
    'Próxima pergunta a fazer',
    'Sentiment do cliente',
    'Pontos não respondidos',
    'Resumir documentos enviados',
    'Sugestão de roteamento',
  ],
};

/** Mapping de palavra-chave da sugestão → ícone + cor de accent.
 *  Cycling determinístico: usa primeiro match da palavra-chave. */
const SUGGESTION_ICON_HINTS: Array<{
  match: RegExp;
  icon: LucideIcon;
  accent: string;
}> = [
  { match: /priorizar|prioridade|urgênc/i, icon: AlertTriangle, accent: '#f59e0b' },
  { match: /funil|kanban|pipeline/i, icon: Target, accent: '#00E5FF' },
  { match: /tarefa|task|pendente/i, icon: ClipboardList, accent: '#a78bfa' },
  { match: /perdi|perda|risco/i, icon: TrendingDown, accent: '#ef4444' },
  { match: /follow-up|follow up|reativ/i, icon: Zap, accent: '#fcd34d' },
  { match: /resum|análise|analisar/i, icon: FileText, accent: '#67e8f9' },
  { match: /performance|crescer|aumentar|conversão/i, icon: TrendingUp, accent: '#34d399' },
  { match: /cliente|contato|equipe/i, icon: Users, accent: '#a78bfa' },
  { match: /sugest|próxima ação|melhor|sugerir/i, icon: Lightbulb, accent: '#fde68a' },
  { match: /quente|engajamento|interesse/i, icon: Sparkles, accent: '#f472b6' },
  { match: /resposta|conversa|mensag/i, icon: MessageSquare, accent: '#00E5FF' },
  { match: /aprovado|completo|✓/i, icon: CheckCircle2, accent: '#34d399' },
  { match: /comparar|relatório|gráfic/i, icon: BarChart3, accent: '#67e8f9' },
  { match: /ticket|sac|reclama|atendimento|sla/i, icon: Headphones, accent: '#06b6d4' },
  { match: /pedido|atras|entrega|rastreio|reembolso|troca|devolu/i, icon: Package, accent: '#f59e0b' },
  { match: /post|carrossel|conte[uú]do|social|insta|reel|story/i, icon: Megaphone, accent: '#ec4899' },
];

function pickIcon(text: string): { icon: LucideIcon; accent: string } {
  for (const h of SUGGESTION_ICON_HINTS) {
    if (h.match.test(text)) return { icon: h.icon, accent: h.accent };
  }
  return { icon: Compass, accent: '#00E5FF' };
}

function withIcons(
  _contextType: CopilotContextType,
  texts: string[],
): PromptSuggestion[] {
  return texts.map((text) => {
    const { icon, accent } = pickIcon(text);
    return { text, icon, accent };
  });
}

const PLACEHOLDER: Record<CopilotContextType, string> = {
  general: 'Pergunte sobre seus leads, deals, performance...',
  deal: 'Pergunte sobre esse deal...',
  contact: 'Pergunte sobre esse contato...',
  conversation: 'Pergunte sobre essa conversa...',
};

const CONTEXT_BADGE_LABEL: Record<Exclude<CopilotContextType, 'general'>, string> = {
  deal: 'Deal',
  contact: 'Contato',
  conversation: 'Conversa',
};

// ──────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────

function ContextBadge({
  type,
  label,
  compact,
}: {
  type: Exclude<CopilotContextType, 'general'>;
  label?: string;
  compact: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 border-b border-border bg-primary/5 text-primary',
        compact ? 'px-3 py-1.5 text-[11px]' : 'px-6 py-2 text-xs',
      )}
    >
      <Sparkles className="h-3 w-3 shrink-0" />
      <span className="font-semibold uppercase tracking-wider">
        {CONTEXT_BADGE_LABEL[type]}
      </span>
      {label && (
        <>
          <span className="text-muted-foreground">·</span>
          <span className="truncate text-foreground">{label}</span>
        </>
      )}
    </div>
  );
}

function EmptyState({
  contextType,
  compact,
}: {
  contextType: CopilotContextType;
  compact: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 text-center',
        compact ? 'py-6' : 'py-16',
      )}
    >
      <div
        className={cn(
          'flex items-center justify-center rounded-2xl bg-primary/10 text-primary',
          compact ? 'h-10 w-10' : 'h-14 w-14',
        )}
      >
        <Bot className={compact ? 'h-5 w-5' : 'h-7 w-7'} />
      </div>
      <div className="flex flex-col gap-1">
        <h2 className={cn('font-semibold', compact ? 'text-sm' : 'text-base')}>
          Como posso ajudar?
        </h2>
        <p className={cn('max-w-md text-muted-foreground', compact ? 'text-[11px]' : 'text-xs')}>
          {EMPTY_STATE_HINT[contextType]}
        </p>
      </div>
    </div>
  );
}

const EMPTY_STATE_HINT: Record<CopilotContextType, string> = {
  general:
    'Pergunte sobre leads, deals, performance, conversas ou peça para criar tarefas e oportunidades direto pelo chat.',
  deal: 'Pergunte sobre esse deal — risco, próximo passo, geração de proposta ou follow-up.',
  contact: 'Pergunte sobre esse contato — resumo, objeções históricas, melhor abordagem.',
  conversation: 'Pergunte sobre essa conversa — resumo, sugestão de resposta, intenção do cliente.',
};

function QuickSuggestions({
  suggestions,
  onSelect,
  disabled,
  compact,
}: {
  suggestions: string[];
  onSelect: (text: string) => void;
  disabled: boolean;
  compact: boolean;
}) {
  return (
    <div className={cn('flex flex-wrap', compact ? 'gap-1' : 'gap-1.5')}>
      {suggestions.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onSelect(s)}
          disabled={disabled}
          className={cn(
            'rounded-full border border-border bg-card text-foreground transition-colors',
            'hover:border-primary/40 hover:bg-primary/5 hover:text-primary',
            disabled && 'pointer-events-none opacity-50',
            compact ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1.5 text-xs',
          )}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

function SkeletonHistory() {
  return (
    <div className="flex flex-col gap-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className={cn('flex gap-3', i % 2 === 0 ? 'flex-row' : 'flex-row-reverse')}>
          <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-muted" />
          <div
            className={cn(
              'h-12 animate-pulse rounded-2xl bg-muted',
              i % 2 === 0 ? 'w-2/3' : 'w-1/2',
            )}
          />
        </div>
      ))}
    </div>
  );
}
