'use client';

/**
 * Copiloto Flutuante v1 do e-Click Active.
 *
 * Botão fixo no canto inferior direito → abre painel lateral com chat de
 * ajuda. Usa /copilot/route-context pra carregar entries da KB que casam
 * com a tela atual; envia perguntas pra /copilot/help (Haiku via
 * LlmService) com KB filtrada como contexto.
 *
 * Atalhos:
 *   - Cmd/Ctrl + K: toggle abrir/fechar
 *   - Esc: fecha
 *
 * Estado:
 *   - enabled (localStorage `eclick.copilot.enabled`) — usuário pode
 *     desativar o botão flutuante.
 *   - turns[]: rolagem de Q&A
 *   - routeCtx: entries que casam com pathname atual
 *   - allKb: dump completo da KB (lazy load no fallback "ver tudo")
 *
 * Espelho do SaaS: feature equivalente em eclick-frontend (commits b9dcbda,
 * ed2cd69, 5376c6e). Diferenças: KB do Active foca em WhatsApp/automações;
 * telemetria em `active.ai_interactions` (no backend).
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import {
  AlertCircle,
  ArrowDown,
  BookOpen,
  Brain,
  Check,
  ChevronRight,
  Copy,
  HelpCircle,
  Lightbulb,
  Loader2,
  Map,
  MessageCircle,
  Power,
  Rocket,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import {
  AnimatedPromptSuggestions,
  type PromptSuggestion,
} from '@/components/ui/animated-prompt-suggestions';
import { cn } from '@/lib/utils';
import {
  copilotApi,
  type ChatTurn,
  type KbEntry,
  type RouteContext,
} from './copilotApi';

// ──────────────────────────────────────────────────────────
// Tipos locais
// ──────────────────────────────────────────────────────────

interface UiTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pending?: boolean;
  rating?: 'up' | 'down';
  questionForFeedback?: string; // pra reenviar feedback junto da pergunta
}

const STORAGE_ENABLED = 'eclick.copilot.enabled';

// ──────────────────────────────────────────────────────────
// Componente
// ──────────────────────────────────────────────────────────

export default function FloatingCopilot() {
  const t = useTranslations('copilot.floating');
  const pathname = usePathname() ?? '/';
  const [enabled, setEnabled] = useState(true);
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<UiTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [routeCtx, setRouteCtx] = useState<RouteContext | null>(null);
  const [allKb, setAllKb] = useState<Record<string, KbEntry[]> | null>(null);
  const [showAllKb, setShowAllKb] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // ── carrega flag enabled do localStorage ──
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_ENABLED);
      if (stored === 'false') setEnabled(false);
    } catch {
      /* localStorage indisponível — segue habilitado */
    }
  }, []);

  // ── persiste enabled ──
  const setEnabledPersist = useCallback((next: boolean) => {
    setEnabled(next);
    try {
      localStorage.setItem(STORAGE_ENABLED, next ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  }, []);

  // ── carrega route context a cada mudança de pathname ──
  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    void copilotApi
      .getRouteContext(pathname, ctrl.signal)
      .then((ctx) => setRouteCtx(ctx))
      .catch(() => {
        /* falha silenciosa — UI degrada graciosamente */
      });
    return () => ctrl.abort();
  }, [pathname, enabled]);

  // ── atalhos: Cmd/Ctrl+K toggle, Esc close ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
      const modifier = isMac ? e.metaKey : e.ctrlKey;
      if (modifier && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (enabled) setOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, open]);

  // ── auto-scroll pro final quando turns muda ──
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, busy]);

  // ── focus no textarea quando abre ──
  useEffect(() => {
    if (open) {
      const id = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [open]);

  // ── ação: perguntar ──
  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || busy) return;

      const userTurn: UiTurn = {
        id: `u-${Date.now()}`,
        role: 'user',
        content: q,
      };
      const pendingTurn: UiTurn = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: '',
        pending: true,
      };

      // History antes de adicionar a nova pergunta
      const history: ChatTurn[] = turns
        .filter((t) => !t.pending)
        .map((t) => ({ role: t.role, content: t.content }));

      setTurns((prev) => [...prev, userTurn, pendingTurn]);
      setInput('');
      setBusy(true);

      try {
        const res = await copilotApi.ask({
          pathname,
          question: q,
          history,
        });
        setTurns((prev) =>
          prev.map((t) =>
            t.id === pendingTurn.id
              ? {
                  ...t,
                  content: res.answer,
                  pending: false,
                  questionForFeedback: q,
                }
              : t,
          ),
        );
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : t('errorTalking');
        setTurns((prev) =>
          prev.map((t) =>
            t.id === pendingTurn.id
              ? {
                  ...t,
                  content: `❌ ${msg}`,
                  pending: false,
                }
              : t,
          ),
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, pathname, turns],
  );

  // ── feedback (otimista) ──
  const sendFeedback = useCallback(
    async (turn: UiTurn, rating: 'up' | 'down') => {
      if (!turn.questionForFeedback) return;
      // optimistic
      setTurns((prev) =>
        prev.map((t) => (t.id === turn.id ? { ...t, rating } : t)),
      );
      try {
        await copilotApi.feedback({
          pathname,
          question: turn.questionForFeedback,
          answer: turn.content,
          rating,
        });
      } catch {
        // Rollback se falhar
        setTurns((prev) =>
          prev.map((t) =>
            t.id === turn.id ? { ...t, rating: undefined } : t,
          ),
        );
      }
    },
    [pathname],
  );

  // ── lazy load KB inteira ──
  const loadAllKb = useCallback(async () => {
    if (allKb) {
      setShowAllKb(true);
      return;
    }
    try {
      const data = await copilotApi.listKb();
      setAllKb(data);
      setShowAllKb(true);
    } catch {
      /* ignore */
    }
  }, [allKb]);

  const clearChat = useCallback(() => {
    setTurns([]);
    setShowAllKb(false);
  }, []);

  // ── chips contextuais ──
  const baseSuggestions = useBaseSuggestions();
  const suggestions = useMemo<PromptSuggestion[]>(() => {
    const routeChips: PromptSuggestion[] = (routeCtx?.entries ?? [])
      .slice(0, 6)
      .map((e) => ({
        text: t('explain', { title: e.title }),
        label: e.title.length > 22 ? e.title.slice(0, 20) + '…' : e.title,
        icon: Map,
        accent: '#00E5FF',
      }));

    return [...routeChips, ...baseSuggestions];
  }, [routeCtx, t, baseSuggestions]);

  if (!enabled) {
    return null;
  }

  return (
    <>
      {/* Botão flutuante */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group fixed bottom-5 right-5 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/30 transition-all hover:scale-105 hover:shadow-cyan-500/50"
          aria-label={t('openAria')}
        >
          {/* Pulse dot */}
          <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-background" />
          </span>
          {/* Soft glow */}
          <span className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-cyan-500/40 blur-xl group-hover:bg-cyan-400/60" />
          <Brain className="h-5 w-5 text-white" />
        </button>
      )}

      {/* Painel */}
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end pointer-events-none">
          {/* backdrop blur leve só na área do painel — não bloqueia o resto da UI */}
          <div className="pointer-events-auto flex h-full w-full max-w-md flex-col border-l border-border bg-background/95 backdrop-blur-md shadow-2xl">
            {/* Header */}
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-cyan-500 to-blue-600">
                  <Brain className="h-4 w-4 text-white" />
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold">{t('title')}</span>
                  <span className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0 text-[9px] uppercase tracking-wider text-cyan-300">
                    v1
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {turns.length > 0 && (
                  <button
                    type="button"
                    onClick={clearChat}
                    title={t('clearChat')}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setEnabledPersist(false)}
                  title={t('disable')}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Power className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  title={t('close')}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            {/* Body */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto px-4 py-3"
            >
              {turns.length === 0 ? (
                <EmptyState
                  routeCtx={routeCtx}
                  suggestions={suggestions}
                  onAsk={ask}
                  onShowAll={loadAllKb}
                  showAllKb={showAllKb}
                  allKb={allKb}
                />
              ) : (
                <div className="flex flex-col gap-3">
                  {turns.map((t) => (
                    <ChatTurnView
                      key={t.id}
                      turn={t}
                      onFeedback={sendFeedback}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Input */}
            <footer className="border-t border-border bg-background/80 px-3 py-2.5">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void ask(input);
                    }
                  }}
                  rows={1}
                  placeholder={t('inputPlaceholder')}
                  className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30"
                  disabled={busy}
                />
                <button
                  type="button"
                  onClick={() => void ask(input)}
                  disabled={busy || !input.trim()}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-cyan-500 text-white transition-colors hover:bg-cyan-400 disabled:opacity-40"
                  aria-label={t('send')}
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>
                  {t.rich('atPath', {
                    pathname,
                    code: (chunks) => (
                      <code className="rounded bg-accent/40 px-1">{chunks}</code>
                    ),
                  })}
                </span>
                <span>
                  <kbd className="rounded border border-border bg-accent/40 px-1">
                    Cmd/Ctrl
                  </kbd>{' '}
                  +{' '}
                  <kbd className="rounded border border-border bg-accent/40 px-1">
                    K
                  </kbd>
                </span>
              </div>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────
// Empty state (carrossel + fallback noMatch)
// ──────────────────────────────────────────────────────────

const BASE_SUGGESTION_VISUALS: Array<{
  key: string;
  icon: PromptSuggestion['icon'];
  accent: string;
}> = [
  { key: 'whatIDoHere', icon: HelpCircle, accent: '#00E5FF' },
  { key: 'whatsappSetup', icon: MessageCircle, accent: '#22c55e' },
  { key: 'commonErrors', icon: AlertCircle, accent: '#ef4444' },
  { key: 'bestPractices', icon: Lightbulb, accent: '#f59e0b' },
  { key: 'stepByStep', icon: BookOpen, accent: '#a855f7' },
  { key: 'shortcuts', icon: Zap, accent: '#00E5FF' },
  { key: 'quickStart', icon: Rocket, accent: '#22c55e' },
  { key: 'importantConfigs', icon: Wrench, accent: '#f59e0b' },
  { key: 'screenSummary', icon: Sparkles, accent: '#00E5FF' },
];

function useBaseSuggestions(): PromptSuggestion[] {
  const t = useTranslations('copilot.baseSuggestions');
  return useMemo(
    () =>
      BASE_SUGGESTION_VISUALS.map((v) => ({
        text: t(`${v.key}.text` as `${string}.text`),
        label: t(`${v.key}.label` as `${string}.label`),
        icon: v.icon,
        accent: v.accent,
      })),
    [t],
  );
}

function EmptyState({
  routeCtx,
  suggestions,
  onAsk,
  onShowAll,
  showAllKb,
  allKb,
}: {
  routeCtx: RouteContext | null;
  suggestions: PromptSuggestion[];
  onAsk: (q: string) => void;
  onShowAll: () => void;
  showAllKb: boolean;
  allKb: Record<string, KbEntry[]> | null;
}) {
  const t = useTranslations('copilot.floating');
  const hasMatch = (routeCtx?.entries.length ?? 0) > 0;

  if (showAllKb && allKb) {
    return (
      <div className="space-y-3">
        <p className="text-[11px] text-muted-foreground">
          {t('allKbTopics', { count: Object.values(allKb).flat().length })}
        </p>
        {Object.entries(allKb).map(([category, entries]) => (
          <div key={category}>
            <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-400">
              {category}
            </h4>
            <ul className="space-y-1">
              {entries.map((e) => (
                <li key={e.title}>
                  <button
                    type="button"
                    onClick={() => onAsk(t('explain', { title: e.title }))}
                    className="group flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-cyan-400" />
                    <span className="truncate">{e.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-center">
        <h3 className="text-sm font-semibold">{t('greeting')}</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {hasMatch
            ? t('topicsForScreen', { count: routeCtx!.entries.length })
            : t('noTopicsForScreen')}
        </p>
      </div>

      <AnimatedPromptSuggestions
        suggestions={suggestions}
        onSuggestionClick={onAsk}
        rows={2}
        compact
        speed={45}
      >
        <div className="flex items-center justify-center gap-1.5 pt-1 text-[10px] text-zinc-500">
          <ArrowDown className="h-2.5 w-2.5 text-cyan-400/60" />
          <span>{t('orAskBelow')}</span>
        </div>
      </AnimatedPromptSuggestions>

      {!hasMatch && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5">
          <p className="mb-1.5 text-xs text-amber-200">{t('noEntriesYet')}</p>
          <button
            type="button"
            onClick={onShowAll}
            className="flex items-center gap-1 text-[11px] font-medium text-amber-300 hover:text-amber-100"
          >
            {t('seeAllTopics')}
            <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Turn (bubble + actions)
// ──────────────────────────────────────────────────────────

function ChatTurnView({
  turn,
  onFeedback,
}: {
  turn: UiTurn;
  onFeedback: (turn: UiTurn, rating: 'up' | 'down') => void;
}) {
  const t = useTranslations('copilot.floating');
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(turn.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }, [turn.content]);

  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-lg rounded-tr-sm bg-cyan-500/15 border border-cyan-500/20 px-3 py-2 text-sm">
          {turn.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="max-w-[90%] rounded-lg rounded-tl-sm border border-border bg-card/50 px-3 py-2">
        {turn.pending ? (
          <TypingDots />
        ) : (
          <RenderMd text={turn.content} />
        )}
      </div>
      {!turn.pending && turn.questionForFeedback && (
        <div className="flex items-center gap-1 pl-1 text-[10px] text-muted-foreground">
          <button
            type="button"
            onClick={onCopy}
            className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent hover:text-foreground"
            title={t('copy')}
          >
            {copied ? (
              <Check className="h-3 w-3 text-emerald-400" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
          <button
            type="button"
            onClick={() => onFeedback(turn, 'up')}
            className={cn(
              'flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent hover:text-foreground',
              turn.rating === 'up' && 'text-emerald-400',
            )}
            title={t('helpful')}
          >
            <ThumbsUp className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => onFeedback(turn, 'down')}
            className={cn(
              'flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent hover:text-foreground',
              turn.rating === 'down' && 'text-rose-400',
            )}
            title={t('notHelpful')}
          >
            <ThumbsDown className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400 [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400 [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400" />
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Markdown renderer (light) — bold, italic, code inline + code blocks
// ──────────────────────────────────────────────────────────

function RenderMd({ text }: { text: string }) {
  // Split por code fences ```
  const blocks = parseBlocks(text);
  return (
    <div className="flex flex-col gap-2 text-sm leading-relaxed">
      {blocks.map((b, i) =>
        b.type === 'code' ? (
          <pre
            key={i}
            className="overflow-x-auto rounded-md bg-zinc-900/80 border border-border px-2.5 py-1.5 text-[11px]"
          >
            <code>{b.content}</code>
          </pre>
        ) : (
          <div key={i}>{renderTextBlock(b.content)}</div>
        ),
      )}
    </div>
  );
}

interface ParsedBlock {
  type: 'text' | 'code';
  content: string;
}

function parseBlocks(text: string): ParsedBlock[] {
  const out: ParsedBlock[] = [];
  const re = /```(?:[a-z]*\n)?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) {
      out.push({ type: 'text', content: text.slice(last, m.index) });
    }
    out.push({ type: 'code', content: m[1]!.trim() });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    out.push({ type: 'text', content: text.slice(last) });
  }
  if (out.length === 0) {
    out.push({ type: 'text', content: text });
  }
  return out;
}

function renderTextBlock(block: string): React.ReactNode {
  // Quebra em parágrafos por linha em branco
  const paragraphs = block.split(/\n{2,}/);
  return (
    <>
      {paragraphs.map((p, i) => {
        // Detecta lista (- ou *)
        const lines = p.split('\n');
        const isList = lines.every(
          (l) => /^[-*]\s+/.test(l) || l.trim() === '',
        );
        if (isList && lines.some((l) => /^[-*]\s+/.test(l))) {
          return (
            <ul key={i} className="ml-4 list-disc space-y-0.5">
              {lines
                .filter((l) => /^[-*]\s+/.test(l))
                .map((l, j) => (
                  <li key={j}>{renderInline(l.replace(/^[-*]\s+/, ''))}</li>
                ))}
            </ul>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap break-words">
            {renderInline(p)}
          </p>
        );
      })}
    </>
  );
}

function renderInline(text: string): React.ReactNode {
  // Code inline `...`
  const codeSplit = text.split(/(`[^`]+`)/g);
  return codeSplit.map((seg, i) => {
    if (/^`[^`]+`$/.test(seg)) {
      return (
        <code
          key={i}
          className="rounded bg-zinc-800/70 px-1 py-0.5 text-[11px] text-cyan-300"
        >
          {seg.slice(1, -1)}
        </code>
      );
    }
    // Bold/italic
    const boldSplit = seg.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
    return (
      <span key={i}>
        {boldSplit.map((s, j) => {
          if (/^\*\*[^*]+\*\*$/.test(s)) {
            return <strong key={j}>{s.slice(2, -2)}</strong>;
          }
          if (/^\*[^*]+\*$/.test(s)) {
            return <em key={j}>{s.slice(1, -1)}</em>;
          }
          return <span key={j}>{s}</span>;
        })}
      </span>
    );
  });
}
