'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Calendar as CalIcon,
  Sparkles,
  Plus,
} from 'lucide-react';
import { useBrands, useContents, useCalendars } from '@/hooks/use-social';
import { socialApi, type CalendarObjective } from '@/lib/api/social';
import { ContentCard } from '@/components/social/content-card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function CalendarPage() {
  const { brands } = useBrands();
  const [brandId, setBrandId] = useState<string>('');
  const [genOpen, setGenOpen] = useState(false);

  useEffect(() => {
    if (!brandId && brands.length > 0 && brands[0]) setBrandId(brands[0].id);
  }, [brands, brandId]);

  const { calendars, refresh: refreshCalendars } = useCalendars(brandId || undefined);
  const { data: scheduled, refresh: refreshContents } = useContents({
    brand_id: brandId || undefined,
    status: ['scheduled', 'approved', 'pending_approval', 'draft'],
    page_size: 100,
  });

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/social">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <CalIcon className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Calendário editorial</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {brands.length > 1 && (
            <select
              value={brandId}
              onChange={(e) => setBrandId(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
            >
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
          <Button size="sm" onClick={() => setGenOpen(true)} disabled={!brandId}>
            <Sparkles className="h-3.5 w-3.5" />
            <span className="ml-1">Gerar com IA</span>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href="/social/criar">
              <Plus className="h-3.5 w-3.5" />
              <span className="ml-1">Manual</span>
            </Link>
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {brands.length === 0 && (
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
            Crie uma marca em <Link href="/social/marcas" className="text-primary underline">/social/marcas</Link> antes de gerar calendários.
          </div>
        )}

        {/* Calendários existentes */}
        {calendars.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-3 text-sm font-semibold">Calendários ativos</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {calendars.map((c) => (
                <Link
                  key={c.id}
                  href={`/social/calendario/${c.id}`}
                  className="rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/40"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{c.name}</span>
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5 text-[10px] uppercase',
                        c.status === 'active'
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {c.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {c.start_date} → {c.end_date}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {c.frequency_per_week}/semana · {c.objective}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Conteúdos agendados (timeline) */}
        <section>
          <h2 className="mb-3 text-sm font-semibold">Conteúdos da marca</h2>
          {!scheduled || scheduled.rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
              Nenhum conteúdo ainda — gere um calendário com IA pra começar.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {scheduled.rows.map((c) => (
                <ContentCard key={c.id} content={c} compact />
              ))}
            </div>
          )}
        </section>
      </div>

      {genOpen && (
        <GenerateCalendarDialog
          brandId={brandId}
          onClose={() => setGenOpen(false)}
          onDone={() => {
            setGenOpen(false);
            void refreshCalendars();
            void refreshContents();
          }}
        />
      )}
    </div>
  );
}

interface GenerateProps {
  brandId: string;
  onClose: () => void;
  onDone: () => void;
}

function GenerateCalendarDialog({ brandId, onClose, onDone }: GenerateProps) {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  const [startDate, setStartDate] = useState(tomorrow);
  const [duration, setDuration] = useState<7 | 15 | 30>(15);
  const [channels, setChannels] = useState<string[]>(['instagram']);
  const [objective, setObjective] = useState<CalendarObjective>('engagement');
  const [frequency, setFrequency] = useState(5);
  const [mix, setMix] = useState({
    educational: 40,
    promotional: 20,
    social_proof: 20,
    entertainment: 10,
    institutional: 10,
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalMix = Object.values(mix).reduce((a, b) => a + b, 0);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      await socialApi.calendars.generate({
        brand_id: brandId,
        start_date: startDate,
        duration_days: duration,
        channels,
        objective,
        frequency_per_week: frequency,
        content_mix: mix,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao gerar');
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
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
          <Sparkles className="h-4 w-4 text-primary" />
          Gerar calendário com IA
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          A IA monta um calendário editorial completo respeitando sua marca,
          mix de pilares e objetivo. Geração leva ~15-25s.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <DateField
            label="Data inicial"
            value={startDate}
            onChange={setStartDate}
            min={today}
          />

          <SelectField
            label="Duração"
            value={String(duration)}
            onChange={(v) => setDuration(Number(v) as 7 | 15 | 30)}
            options={[
              ['7', '7 dias'],
              ['15', '15 dias'],
              ['30', '30 dias'],
            ]}
          />

          <div className="col-span-2">
            <span className="block text-xs uppercase tracking-wider text-muted-foreground">
              Canais
            </span>
            <div className="mt-1 flex gap-2">
              {(
                [
                  ['instagram', 'Instagram'],
                  ['tiktok', 'TikTok'],
                ] as Array<[string, string]>
              ).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() =>
                    setChannels((cs) =>
                      cs.includes(k) ? cs.filter((x) => x !== k) : [...cs, k],
                    )
                  }
                  className={cn(
                    'rounded-md border px-3 py-1 text-xs',
                    channels.includes(k)
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background',
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <SelectField
            label="Objetivo"
            value={objective}
            onChange={(v) => setObjective(v as CalendarObjective)}
            options={[
              ['reach', 'Alcance'],
              ['engagement', 'Engajamento'],
              ['leads', 'Leads'],
              ['sales', 'Vendas'],
              ['authority', 'Autoridade'],
              ['launch', 'Lançamento'],
              ['remarketing', 'Remarketing'],
            ]}
          />

          <div>
            <span className="block text-xs uppercase tracking-wider text-muted-foreground">
              Frequência: {frequency}/semana
            </span>
            <input
              type="range"
              min={1}
              max={7}
              value={frequency}
              onChange={(e) => setFrequency(Number(e.target.value))}
              className="mt-2 w-full"
            />
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
            Mix de pilares ({totalMix}%)
          </p>
          <div className="flex flex-col gap-2">
            {(
              [
                ['educational', 'Educacional'],
                ['promotional', 'Promocional'],
                ['social_proof', 'Prova social'],
                ['entertainment', 'Entretenimento'],
                ['institutional', 'Institucional'],
              ] as Array<[keyof typeof mix, string]>
            ).map(([k, l]) => (
              <div key={k} className="flex items-center gap-2 text-xs">
                <span className="w-32 text-muted-foreground">{l}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={mix[k]}
                  onChange={(e) =>
                    setMix((m) => ({ ...m, [k]: Number(e.target.value) }))
                  }
                  className="flex-1"
                />
                <span className="w-10 text-right font-mono">{mix[k]}%</span>
              </div>
            ))}
          </div>
          {totalMix !== 100 && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              ⚠ Soma deve ser 100% (atual: {totalMix}%)
            </p>
          )}
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={generate}
            disabled={busy || channels.length === 0 || totalMix !== 100}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span className="ml-1">{busy ? 'Gerando…' : 'Gerar'}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
  min,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <input
        type="date"
        value={value}
        min={min}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
      >
        {options.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
