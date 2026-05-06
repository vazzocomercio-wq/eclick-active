'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Calendar,
  Sparkles,
  Copy,
  Trash2,
  Download,
  RotateCw,
} from 'lucide-react';
import { useContent, useBrand } from '@/hooks/use-social';
import { socialApi } from '@/lib/api/social';
import { InstagramMockup } from '@/components/social/instagram-mockup';
import { StatusBadge, PillarBadge, TypeBadge } from '@/components/social/social-badges';
import { Button } from '@/components/ui/button';

type Tab = 'content' | 'schedule' | 'ai' | 'versions';

export default function ContentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? null;
  const { content, refresh, loading } = useContent(id);
  const { brand } = useBrand(content?.brand_id ?? null);

  const [tab, setTab] = useState<Tab>('content');
  const [busy, setBusy] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [rewriteInstr, setRewriteInstr] = useState('');
  const [suggestions, setSuggestions] = useState<string[] | null>(null);

  if (loading || !content) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Carregando conteúdo…
      </div>
    );
  }

  const approve = async () => {
    if (!id) return;
    setBusy(true);
    try {
      await socialApi.contents.approve(id);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!id) return;
    setBusy(true);
    try {
      await socialApi.contents.reject(id, rejectReason);
      setShowReject(false);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const schedule = async () => {
    if (!id || !scheduleDate || !scheduleTime) return;
    setBusy(true);
    try {
      const iso = new Date(`${scheduleDate}T${scheduleTime}:00`).toISOString();
      await socialApi.contents.schedule(id, { scheduled_for: iso });
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async () => {
    if (!id) return;
    const dup = await socialApi.contents.duplicate(id);
    router.push(`/social/conteudo/${dup.id}`);
  };

  const remove = async () => {
    if (!id) return;
    if (!confirm('Excluir este conteúdo permanentemente?')) return;
    await socialApi.contents.delete(id);
    router.push('/social/biblioteca');
  };

  const exportContent = async () => {
    if (!id) return;
    const pkg = await socialApi.contents.export(id);
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = pkg.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const rewrite = async () => {
    if (!id) return;
    setBusy(true);
    try {
      await socialApi.contents.rewriteCaption(id, rewriteInstr);
      setRewriteInstr('');
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    if (!id) return;
    setBusy(true);
    try {
      const v = await socialApi.contents.regenerate(id, { instruction: rewriteInstr || undefined });
      router.push(`/social/conteudo/${v.id}`);
    } finally {
      setBusy(false);
    }
  };

  const fetchSuggestions = async () => {
    if (!id) return;
    setBusy(true);
    try {
      const r = await socialApi.contents.suggestImprovements(id);
      setSuggestions(r.suggestions);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-background px-4 py-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/social/biblioteca">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex flex-1 items-center gap-2">
          <TypeBadge type={content.content_type} />
          <h1 className="truncate text-sm font-semibold">
            {content.title ?? '(Sem título)'}
          </h1>
          <span className="text-[10px] text-muted-foreground">v{content.version}</span>
        </div>
        <div className="flex items-center gap-1">
          {content.status === 'pending_approval' && (
            <>
              <Button
                size="sm"
                variant="default"
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={approve}
                disabled={busy}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span className="hidden md:inline ml-1">Aprovar</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowReject(true)}
                disabled={busy}
              >
                <XCircle className="h-3.5 w-3.5" />
                <span className="hidden md:inline ml-1">Rejeitar</span>
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" onClick={exportContent}>
            <Download className="h-3.5 w-3.5" />
            <span className="hidden md:inline ml-1">Exportar</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={duplicate} disabled={busy}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={remove} disabled={busy}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        {/* Preview esquerda */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="mx-auto max-w-md">
            <InstagramMockup content={content} brand={brand} />
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <StatusBadge status={content.status} />
              {content.pillar && <PillarBadge pillar={content.pillar} />}
            </div>
            {content.rejection_reason && (
              <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs">
                <p className="font-medium text-red-700 dark:text-red-300">
                  Motivo da rejeição:
                </p>
                <p className="mt-1 text-foreground/80">{content.rejection_reason}</p>
              </div>
            )}
          </div>
        </div>

        {/* Tabs direita */}
        <aside className="flex w-full flex-col border-t border-border bg-card/40 lg:w-[380px] lg:border-l lg:border-t-0">
          <div className="border-b border-border px-3">
            <div className="flex gap-1">
              {([
                ['content', 'Conteúdo'],
                ['schedule', 'Agenda'],
                ['ai', 'IA'],
                ['versions', 'Versões'],
              ] as Array<[Tab, string]>).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTab(k)}
                  className={`-mb-px border-b-2 px-2 py-2 text-xs font-medium transition-colors ${
                    tab === k
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {tab === 'content' && (
              <div className="flex flex-col gap-3 text-xs">
                <div>
                  <span className="block text-[11px] uppercase tracking-wider text-muted-foreground">
                    Caption
                  </span>
                  <p className="mt-1 whitespace-pre-line rounded-md border border-border bg-background p-2 text-sm">
                    {content.caption ?? '(vazio)'}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {(content.caption ?? '').length} chars
                  </p>
                </div>
                <div>
                  <span className="block text-[11px] uppercase tracking-wider text-muted-foreground">
                    Hashtags
                  </span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {content.hashtags.map((h, i) => (
                      <span
                        key={i}
                        className="rounded-md border border-border bg-card px-1.5 py-0.5 text-[11px] text-blue-600 dark:text-blue-400"
                      >
                        #{h.replace(/^#/, '')}
                      </span>
                    ))}
                  </div>
                </div>
                {content.cta && (
                  <div>
                    <span className="block text-[11px] uppercase tracking-wider text-muted-foreground">
                      CTA
                    </span>
                    <p className="mt-1 text-sm font-medium">{content.cta}</p>
                  </div>
                )}
              </div>
            )}

            {tab === 'schedule' && (
              <div className="flex flex-col gap-3 text-xs">
                {content.scheduled_for ? (
                  <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3">
                    <p className="font-medium">
                      Agendado para{' '}
                      {new Date(content.scheduled_for).toLocaleString('pt-BR')}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={async () => {
                        if (!id) return;
                        await socialApi.contents.unschedule(id);
                        refresh();
                      }}
                    >
                      Remover agendamento
                    </Button>
                  </div>
                ) : (
                  <>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        Data
                      </span>
                      <input
                        type="date"
                        value={scheduleDate}
                        onChange={(e) => setScheduleDate(e.target.value)}
                        className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        Hora
                      </span>
                      <input
                        type="time"
                        value={scheduleTime}
                        onChange={(e) => setScheduleTime(e.target.value)}
                        className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                      />
                    </label>
                    <Button
                      size="sm"
                      onClick={schedule}
                      disabled={busy || !scheduleDate || !scheduleTime}
                    >
                      <Calendar className="h-3.5 w-3.5" />
                      <span className="ml-1">Agendar</span>
                    </Button>
                  </>
                )}
              </div>
            )}

            {tab === 'ai' && (
              <div className="flex flex-col gap-3 text-xs">
                {content.ai_model && (
                  <div className="rounded-md border border-border bg-background p-2">
                    <p className="text-[11px] text-muted-foreground">
                      Modelo: <span className="font-mono">{content.ai_model}</span>
                    </p>
                    {content.ai_generation_time_ms && (
                      <p className="text-[11px] text-muted-foreground">
                        Tempo: {Math.round(content.ai_generation_time_ms / 100) / 10}s
                      </p>
                    )}
                  </div>
                )}

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Instrução pra refazer
                  </span>
                  <textarea
                    value={rewriteInstr}
                    onChange={(e) => setRewriteInstr(e.target.value)}
                    placeholder="Ex: 'Mais persuasivo', 'Mais curto', 'Tom mais casual'"
                    rows={3}
                    className="rounded-md border border-border bg-background p-2 text-sm"
                  />
                </label>

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={rewrite} disabled={busy}>
                    <Sparkles className="h-3.5 w-3.5" />
                    <span className="ml-1">Reescrever caption</span>
                  </Button>
                  <Button size="sm" variant="outline" onClick={regenerate} disabled={busy}>
                    <RotateCw className="h-3.5 w-3.5" />
                    <span className="ml-1">Refazer tudo</span>
                  </Button>
                </div>

                <div className="border-t border-border pt-3">
                  <Button size="sm" variant="ghost" onClick={fetchSuggestions} disabled={busy}>
                    <Sparkles className="h-3.5 w-3.5" />
                    <span className="ml-1">Sugerir melhorias</span>
                  </Button>
                  {suggestions && (
                    <ul className="mt-2 flex flex-col gap-2">
                      {suggestions.map((s, i) => (
                        <li
                          key={i}
                          className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2 text-xs"
                        >
                          {s}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {tab === 'versions' && (
              <VersionsPanel contentId={content.id} />
            )}
          </div>
        </aside>
      </div>

      {/* Modal Rejeitar */}
      {showReject && (
        <Modal title="Rejeitar conteúdo" onClose={() => setShowReject(false)}>
          <p className="text-xs text-muted-foreground">Motivo (opcional)</p>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
            className="mt-2 w-full rounded-md border border-border bg-background p-2 text-sm"
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowReject(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={reject} disabled={busy}>
              Confirmar
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function VersionsPanel({ contentId }: { contentId: string }) {
  const [versions, setVersions] = useState<
    Array<{ id: string; version: number; status: string; created_at: string }>
  >([]);
  const [loading, setLoading] = useState(true);

  useState(() => {
    void (async () => {
      try {
        const v = await socialApi.contents.versions(contentId);
        setVersions(v);
      } finally {
        setLoading(false);
      }
    })();
  });

  if (loading) return <p className="text-xs text-muted-foreground">Carregando…</p>;
  if (versions.length === 0)
    return (
      <p className="text-xs text-muted-foreground">
        Nenhuma versão alternativa ainda. Use &quot;Refazer tudo&quot; pra criar novas versões.
      </p>
    );

  return (
    <ul className="flex flex-col gap-2 text-xs">
      {versions.map((v) => (
        <li key={v.id} className="rounded-md border border-border bg-background p-2">
          <Link
            href={`/social/conteudo/${v.id}`}
            className="text-primary hover:underline"
          >
            v{v.version} · {v.status}
          </Link>
          <p className="text-[10px] text-muted-foreground">
            {new Date(v.created_at).toLocaleString('pt-BR')}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-sm font-semibold">{title}</h3>
        {children}
      </div>
    </div>
  );
}
