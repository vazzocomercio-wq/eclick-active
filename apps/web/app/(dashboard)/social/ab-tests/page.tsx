'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, FlaskConical, Plus, Play, Award, CheckCircle2 } from 'lucide-react';
import { useBrands } from '@/hooks/use-social';
import {
  socialApi,
  type SocialAbTest,
  type ContentPillar,
} from '@/lib/api/social';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  running: 'Rodando',
  completed: 'Concluído',
  cancelled: 'Cancelado',
};

const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
  running: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  completed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  cancelled: 'bg-muted text-muted-foreground',
};

export default function AbTestsPage() {
  const { brands } = useBrands();
  const [tests, setTests] = useState<SocialAbTest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const refresh = async () => {
    try {
      const list = await socialApi.abTests.list();
      setTests(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const start = async (id: string) => {
    await socialApi.abTests.start(id);
    void refresh();
  };

  const evaluate = async (id: string) => {
    if (!confirm('Avaliar agora? Compara métricas atuais e declara vencedor.')) return;
    await socialApi.abTests.evaluate(id);
    void refresh();
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b border-border bg-background px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/social">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <FlaskConical className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold leading-tight">A/B Testing</h1>
            <p className="text-xs text-muted-foreground">
              Compare 2 variantes do mesmo brief e descubra qual funciona
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)} disabled={brands.length === 0}>
          <Plus className="h-3.5 w-3.5" />
          <span className="ml-1">Novo teste</span>
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : tests.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
            <FlaskConical className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nenhum teste rodando ainda. A IA gera 2 variantes do mesmo brief com
              estratégias diferentes (ex: foco no benefício vs foco na dor) e você
              descobre qual converte melhor.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {tests.map((t) => (
              <div
                key={t.id}
                className="rounded-lg border border-border bg-card p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold">{t.name}</h3>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider',
                          STATUS_COLOR[t.status],
                        )}
                      >
                        {STATUS_LABEL[t.status]}
                      </span>
                    </div>
                    {t.hypothesis && (
                      <p className="mt-1 text-xs italic text-muted-foreground">
                        Hipótese: {t.hypothesis}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    {t.status === 'draft' && (
                      <Button size="sm" variant="outline" onClick={() => start(t.id)}>
                        <Play className="h-3.5 w-3.5" />
                        <span className="ml-1">Iniciar</span>
                      </Button>
                    )}
                    {t.status === 'running' && (
                      <Button size="sm" variant="outline" onClick={() => evaluate(t.id)}>
                        <Award className="h-3.5 w-3.5" />
                        <span className="ml-1">Avaliar agora</span>
                      </Button>
                    )}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <VariantCard
                    label="Variante A"
                    contentId={t.variant_a_content_id}
                    er={t.variant_a_engagement_rate}
                    isWinner={t.winner_variant === 'a'}
                  />
                  <VariantCard
                    label="Variante B"
                    contentId={t.variant_b_content_id}
                    er={t.variant_b_engagement_rate}
                    isWinner={t.winner_variant === 'b'}
                  />
                </div>

                {t.decision_rationale && (
                  <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs">
                    <CheckCircle2 className="mr-1 inline h-3 w-3 text-emerald-500" />
                    {t.decision_rationale}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {showForm && (
          <CreateTestDialog
            onClose={() => setShowForm(false)}
            onCreated={() => {
              setShowForm(false);
              void refresh();
            }}
          />
        )}
      </div>
    </div>
  );
}

function VariantCard({
  label,
  contentId,
  er,
  isWinner,
}: {
  label: string;
  contentId: string;
  er: number | null;
  isWinner: boolean;
}) {
  return (
    <Link
      href={`/social/conteudo/${contentId}`}
      className={cn(
        'rounded-md border p-2 transition-colors hover:border-primary/40',
        isWinner ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-border bg-background',
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium">{label}</p>
        {isWinner && <Award className="h-3.5 w-3.5 text-emerald-500" />}
      </div>
      {er !== null ? (
        <p className="mt-1 font-mono text-sm">
          {(er * 100).toFixed(2)}% engagement
        </p>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">Sem dados ainda</p>
      )}
    </Link>
  );
}

function CreateTestDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { brands } = useBrands();
  const [brandId, setBrandId] = useState(brands[0]?.id ?? '');
  const [name, setName] = useState('');
  const [theme, setTheme] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [pillar, setPillar] = useState<ContentPillar>('educational');
  const [contentType, setContentType] = useState<'post' | 'carousel'>('post');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!brandId || !name.trim() || !theme.trim()) return;
    setBusy(true);
    try {
      await socialApi.abTests.create({
        brand_id: brandId,
        name: name.trim(),
        hypothesis: hypothesis.trim() || undefined,
        theme: theme.trim(),
        pillar,
        content_type: contentType,
      });
      onCreated();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-base font-semibold">Novo A/B Test</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          IA gera 2 variantes do mesmo tema. Variante A foca no benefício,
          Variante B foca na dor — descubra qual converte melhor.
        </p>
        <div className="flex flex-col gap-3">
          <Field label="Marca">
            <select
              value={brandId}
              onChange={(e) => setBrandId(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Nome do teste">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Hook benefício vs dor — janeiro"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="Hipótese (opcional)">
            <input
              value={hypothesis}
              onChange={(e) => setHypothesis(e.target.value)}
              placeholder="Ex: Hooks com dor convertem mais"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="Tema">
            <textarea
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              rows={2}
              placeholder="Ex: como escolher iluminação para sala"
              className="w-full rounded-md border border-border bg-background p-2 text-sm"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Pilar">
              <select
                value={pillar}
                onChange={(e) => setPillar(e.target.value as ContentPillar)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              >
                <option value="educational">Educacional</option>
                <option value="promotional">Promocional</option>
                <option value="social_proof">Prova social</option>
                <option value="entertainment">Entretenimento</option>
              </select>
            </Field>
            <Field label="Tipo">
              <select
                value={contentType}
                onChange={(e) => setContentType(e.target.value as 'post' | 'carousel')}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              >
                <option value="post">Post</option>
                <option value="carousel">Carrossel</option>
              </select>
            </Field>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button size="sm" onClick={submit} disabled={busy}>
            {busy ? 'Gerando…' : 'Gerar variantes'}
          </Button>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Geração de 2 variantes (~30-60s). Depois você publica e roda o teste.
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
