'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  CheckCircle2,
  XCircle,
  Heart,
  MessageCircle,
  Send,
  Bookmark,
  Clock,
  AlertTriangle,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface PublicReviewView {
  stage: {
    id: string;
    reviewer_name: string;
    stage_label: string;
    status: 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';
    expires_at: string;
  };
  content: {
    id: string;
    content_type: string;
    title: string | null;
    caption: string | null;
    hashtags: string[];
    cta: string | null;
    cover_image_url: string | null;
    media: Array<{ url: string }>;
    slides: Array<{ image_url?: string }>;
  };
  brand: {
    name: string;
    logo_url: string | null;
    primary_color: string;
    secondary_color: string;
  };
}

/**
 * Tela pública de revisão (sem auth) — acessada via link com token.
 * O reviewer (cliente externo) vê o conteúdo formatado como mockup IG
 * e aprova/rejeita com notas opcionais.
 */
export default function ApprovePublicPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? null;
  const [view, setView] = useState<PublicReviewView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<'approved' | 'rejected' | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    void (async () => {
      try {
        const res = await fetch(`${API_URL}/public/social/approval/${token}`);
        if (!res.ok) {
          setError('Link inválido ou expirado');
          return;
        }
        const body = (await res.json()) as PublicReviewView;
        setView(body);
      } catch {
        setError('Não foi possível carregar — verifique sua conexão');
      }
    })();
  }, [token]);

  const submit = async () => {
    if (!token || !decision) return;
    setBusy(true);
    try {
      const res = await fetch(
        `${API_URL}/public/social/approval/${token}/decide`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision, notes: notes.trim() || undefined }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(
          (body as { message?: string }).message ?? 'Erro ao enviar decisão',
        );
        return;
      }
      setDone(true);
    } catch {
      setError('Erro ao enviar decisão');
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <ErrorScreen title="Não foi possível carregar" message={error} />
    );
  }

  if (!view) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-900">
        <p className="text-sm text-slate-600 dark:text-slate-300">Carregando…</p>
      </div>
    );
  }

  if (view.stage.status !== 'pending') {
    return (
      <ErrorScreen
        title={`Esta revisão já está ${labelStatus(view.stage.status)}`}
        message="Não é possível alterar a decisão por este link."
      />
    );
  }

  if (done) {
    return (
      <SuccessScreen
        decision={decision}
        brandName={view.brand.name}
      />
    );
  }

  const cover =
    view.content.cover_image_url ?? view.content.media[0]?.url ?? null;
  const captionLines = (view.content.caption ?? '').split('\n');

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
        {/* Header */}
        <header className="mb-6 text-center">
          <div
            className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-md text-base font-bold text-white"
            style={{
              background: `linear-gradient(135deg, ${view.brand.primary_color}, ${view.brand.secondary_color})`,
            }}
          >
            {view.brand.name.slice(0, 2).toUpperCase()}
          </div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {view.brand.name}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {view.stage.reviewer_name}, revise o conteúdo abaixo
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            <Clock className="mr-1 inline h-3 w-3" />
            Expira em{' '}
            {new Date(view.stage.expires_at).toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        </header>

        {/* Mockup IG */}
        <div className="mx-auto max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-700">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white"
              style={{
                background: `linear-gradient(135deg, ${view.brand.primary_color}, ${view.brand.secondary_color})`,
              }}
            >
              {view.brand.name.slice(0, 1)}
            </div>
            <span className="text-xs font-semibold">
              {view.brand.name.toLowerCase().replace(/\s+/g, '_')}
            </span>
          </div>
          <div className="aspect-square w-full bg-slate-100 dark:bg-slate-900">
            {cover ? (
              cover.endsWith('.svg') || cover.includes('image/svg') ? (
                <object
                  data={cover}
                  type="image/svg+xml"
                  className="h-full w-full"
                  aria-label="Preview"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cover} alt="" className="h-full w-full object-cover" />
              )
            ) : (
              <div className="flex h-full items-center justify-center text-slate-400">
                Sem imagem
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 px-3 py-2">
            <Heart className="h-5 w-5" />
            <MessageCircle className="h-5 w-5" />
            <Send className="h-5 w-5" />
            <Bookmark className="ml-auto h-5 w-5" />
          </div>
          <div className="px-3 pb-3 text-sm">
            {captionLines.map((line, i) => (
              <p key={i} className="whitespace-pre-line">
                {i === 0 && (
                  <span className="font-semibold">
                    {view.brand.name.toLowerCase().replace(/\s+/g, '_')}
                  </span>
                )}
                {i === 0 && ' '}
                {line}
              </p>
            ))}
            {view.content.hashtags.length > 0 && (
              <p className="mt-2 text-xs text-blue-600 dark:text-blue-400">
                {view.content.hashtags
                  .map((h) => `#${h.replace(/^#/, '')}`)
                  .join(' ')}
              </p>
            )}
            {view.content.cta && (
              <p className="mt-2 text-xs font-medium">→ {view.content.cta}</p>
            )}
          </div>
        </div>

        {/* Decision form */}
        <div className="mx-auto mt-6 max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <h2 className="mb-3 text-sm font-semibold">Sua decisão</h2>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setDecision('approved')}
              className={`flex flex-col items-center gap-1 rounded-lg border p-4 transition-colors ${
                decision === 'approved'
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30'
                  : 'border-slate-200 dark:border-slate-700 hover:border-emerald-400'
              }`}
            >
              <CheckCircle2 className="h-6 w-6 text-emerald-500" />
              <span className="text-sm font-medium">Aprovar</span>
            </button>
            <button
              type="button"
              onClick={() => setDecision('rejected')}
              className={`flex flex-col items-center gap-1 rounded-lg border p-4 transition-colors ${
                decision === 'rejected'
                  ? 'border-red-500 bg-red-50 dark:bg-red-900/30'
                  : 'border-slate-200 dark:border-slate-700 hover:border-red-400'
              }`}
            >
              <XCircle className="h-6 w-6 text-red-500" />
              <span className="text-sm font-medium">Pedir ajustes</span>
            </button>
          </div>

          {decision === 'rejected' && (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Descreva o que precisa ajustar (opcional)…"
              className="mt-3 w-full rounded-md border border-slate-200 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          )}
          {decision === 'approved' && (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Comentário opcional…"
              className="mt-3 w-full rounded-md border border-slate-200 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          )}

          <button
            type="button"
            onClick={submit}
            disabled={!decision || busy}
            className="mt-3 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          >
            {busy ? 'Enviando…' : 'Enviar decisão'}
          </button>
        </div>

        <p className="mt-6 text-center text-[10px] text-slate-400">
          Powered by Active CRM · {view.stage.stage_label}
        </p>
      </div>
    </div>
  );
}

function ErrorScreen({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-900">
      <div className="max-w-sm rounded-xl border border-amber-500/40 bg-amber-50 p-6 text-center dark:bg-amber-900/20">
        <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-amber-500" />
        <h1 className="text-base font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{message}</p>
      </div>
    </div>
  );
}

function SuccessScreen({
  decision,
  brandName,
}: {
  decision: 'approved' | 'rejected' | null;
  brandName: string;
}) {
  const isApprove = decision === 'approved';
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-900">
      <div className="max-w-sm text-center">
        {isApprove ? (
          <CheckCircle2 className="mx-auto mb-3 h-16 w-16 text-emerald-500" />
        ) : (
          <XCircle className="mx-auto mb-3 h-16 w-16 text-red-500" />
        )}
        <h1 className="text-lg font-semibold">
          {isApprove ? 'Aprovação registrada!' : 'Ajustes solicitados'}
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          {isApprove
            ? `Obrigado! A equipe da ${brandName} foi notificada.`
            : `A equipe da ${brandName} vai receber seus comentários e fazer os ajustes.`}
        </p>
      </div>
    </div>
  );
}

function labelStatus(s: string): string {
  if (s === 'approved') return 'aprovada';
  if (s === 'rejected') return 'rejeitada';
  if (s === 'expired') return 'expirada';
  if (s === 'cancelled') return 'cancelada';
  return s;
}
