'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  HelpCircle,
  Mail,
  MessageCircle,
  Phone,
  Send,
  Tag as TagIcon,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Deal } from '@eclick-active/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { aiApi, type UnansweredItem } from '@/lib/api/ai';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface AIGapsCardProps {
  /**
   * Contato em foco. Todos os campos são opcionais — gaps são detectados
   * só quando o respectivo campo está null/empty NA shape passada. O
   * caller pode passar uma shape parcial sem precisar declarar tudo.
   */
  contact?: {
    email?: string | null;
    phone?: string | null;
    tags?: string[] | null;
    company_id?: string | null;
  } | null;

  /** Deal em foco — gaps de value, expected_close_date, etc. */
  deal?: Pick<Deal, 'value' | 'expected_close_date' | 'assigned_to' | 'ai_score' | 'tags'> | null;

  /**
   * Quando passado, busca perguntas inbound sem resposta via
   * GET /ai/unanswered/:conversationId e exibe na seção "Perguntas pendentes".
   */
  conversationId?: string | null;

  /**
   * Callback do botão "Pedir ao cliente" — recebe o texto sugerido e
   * tipicamente preenche o input do chat. Se ausente, o componente copia
   * pra clipboard e mostra toast.
   */
  onAskClient?: (suggestedMessage: string) => void;

  /** Classes extras no container raiz. */
  className?: string;
}

interface Gap {
  id: string;
  icon: LucideIcon;
  label: string;
  /** Mensagem que o agente envia ao cliente quando clica em "Pedir ao cliente". */
  suggestedMessage: string;
}

/**
 * Card que destaca gaps de informação no contato/deal e perguntas pendentes
 * na conversa. Lógica de gaps é puramente client-side (verifica null/empty);
 * perguntas pendentes vêm do backend via heurística sem custo de IA.
 *
 * Cada item tem um botão "Pedir ao cliente" que, ao ser clicado, chama o
 * callback `onAskClient` com uma sugestão de mensagem pronta — o caller
 * tipicamente preenche o input do chat. Sem callback, copia pra clipboard.
 */
export function AIGapsCard({
  contact,
  deal,
  conversationId,
  onAskClient,
  className,
}: AIGapsCardProps) {
  const [unanswered, setUnanswered] = useState<UnansweredItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Carrega perguntas pendentes
  useEffect(() => {
    if (!conversationId) {
      setUnanswered([]);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    aiApi
      .getUnansweredInConversation(conversationId, ctrl.signal)
      .then(setUnanswered)
      .catch((err) => {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setError(
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'Erro ao buscar pendências',
        );
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [conversationId]);

  const gaps = computeGaps({ contact: contact ?? null, deal: deal ?? null });

  function handleAsk(suggestion: string) {
    if (onAskClient) {
      onAskClient(suggestion);
      return;
    }
    // Fallback: copia pra clipboard
    try {
      void navigator.clipboard.writeText(suggestion);
      toast.success('Sugestão copiada', { description: suggestion.slice(0, 80) });
    } catch {
      toast.info('Sugestão pronta', { description: suggestion });
    }
  }

  const hasContent = gaps.length > 0 || unanswered.length > 0 || loading;
  if (!hasContent && !error) return null;

  return (
    <Card className={cn('border-yellow-500/20', className)}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
          Gaps & pendências
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 pt-0">
        {/* Gaps de dados (contact + deal) */}
        {gaps.map((g) => (
          <GapRow
            key={g.id}
            icon={g.icon}
            tone="warning"
            label={g.label}
            actionLabel="Pedir ao cliente"
            onAction={() => handleAsk(g.suggestedMessage)}
          />
        ))}

        {/* Perguntas pendentes (do backend) */}
        {loading && (
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        )}

        {!loading &&
          unanswered.map((q) => (
            <GapRow
              key={q.message_id}
              icon={q.is_question ? HelpCircle : MessageCircle}
              tone={q.is_question ? 'question' : 'warning'}
              label={q.text || '(mensagem sem texto)'}
              actionLabel="Responder agora"
              onAction={() => {
                // Sugestão genérica — vendor pode editar
                const suggestion = q.is_question
                  ? `Boa pergunta! Sobre isso: `
                  : `Sobre o que você comentou: `;
                handleAsk(suggestion);
              }}
            />
          ))}

        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
            {error}
          </p>
        )}

        {!loading && gaps.length === 0 && unanswered.length === 0 && !error && (
          <p className="text-[11px] italic text-muted-foreground">
            Nenhum gap detectado. Boa cobertura de dados.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────
// GapRow — uma linha do card
// ──────────────────────────────────────────────────────────

interface GapRowProps {
  icon: LucideIcon;
  tone: 'warning' | 'question';
  label: string;
  actionLabel: string;
  onAction: () => void;
}

function GapRow({ icon: Icon, tone, label, actionLabel, onAction }: GapRowProps) {
  const toneClass =
    tone === 'question'
      ? 'bg-primary/10 text-primary'
      : 'bg-yellow-500/15 text-yellow-500';

  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-background/40 px-2 py-1.5">
      <span
        className={cn(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
          toneClass,
        )}
      >
        <Icon className="h-3 w-3" />
      </span>
      <p className="line-clamp-2 flex-1 text-[12px] leading-snug">{label}</p>
      <button
        type="button"
        onClick={onAction}
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-transparent px-1.5 py-0.5 text-[10px] font-medium text-primary transition-colors hover:border-primary/30 hover:bg-primary/10"
      >
        <Send className="h-2.5 w-2.5" />
        {actionLabel}
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Cálculo de gaps (puro, sem fetch)
// ──────────────────────────────────────────────────────────

function computeGaps({
  contact,
  deal,
}: {
  contact: AIGapsCardProps['contact'];
  deal: AIGapsCardProps['deal'];
}): Gap[] {
  const out: Gap[] = [];

  if (contact) {
    if (!contact.email) {
      out.push({
        id: 'contact:email',
        icon: Mail,
        label: 'Falta email do contato',
        suggestedMessage:
          'Posso te pedir um e-mail pra eu te enviar a proposta por escrito? Ajuda a manter tudo organizado.',
      });
    }
    if (!contact.phone) {
      out.push({
        id: 'contact:phone',
        icon: Phone,
        label: 'Telefone não confirmado',
        suggestedMessage:
          'Pra eu te ligar quando tudo estiver pronto, posso confirmar o melhor número de WhatsApp/celular?',
      });
    }
    if (!contact.company_id) {
      out.push({
        id: 'contact:company',
        icon: Building2,
        label: 'Sem empresa vinculada',
        suggestedMessage:
          'Você está olhando isso pra qual empresa? Quero garantir que eu entenda o cenário direito.',
      });
    }
    if (!contact.tags || contact.tags.length === 0) {
      out.push({
        id: 'contact:segment',
        icon: TagIcon,
        label: 'Cliente sem segmento/tag',
        suggestedMessage:
          'Pra eu te sugerir o caminho certo, qual o setor ou tipo de operação que você atua?',
      });
    }
  }

  if (deal) {
    if (!deal.value || deal.value <= 0) {
      out.push({
        id: 'deal:value',
        icon: TrendingUp,
        label: 'Valor do deal não definido',
        suggestedMessage:
          'Pra eu te dar a melhor recomendação, qual o orçamento aproximado que você tem em mente?',
      });
    }
    if (!deal.expected_close_date) {
      out.push({
        id: 'deal:close-date',
        icon: TrendingUp,
        label: 'Sem previsão de fechamento',
        suggestedMessage:
          'Você tem alguma data ou prazo em mente pra fechar isso? Me ajuda a priorizar do meu lado.',
      });
    }
  }

  return out;
}
