'use client';

import { useEffect, useState } from 'react';
import { Building2, Clock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { settingsApi, type OrgSettings } from '@/lib/api/settings';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const PLAN_LABEL: Record<OrgSettings['plan'], { label: string; bg: string; text: string }> = {
  starter: { label: 'Starter', bg: 'bg-slate-500/15', text: 'text-slate-400' },
  professional: { label: 'Professional', bg: 'bg-primary/15', text: 'text-primary' },
  enterprise: { label: 'Enterprise', bg: 'bg-accent/15', text: 'text-accent' },
};

/** Timezones populares pra org. Cobertura BR + alguns globais. */
const TIMEZONES: { value: string; label: string }[] = [
  { value: 'America/Sao_Paulo', label: 'Brasília — São Paulo (UTC−3)' },
  { value: 'America/Manaus', label: 'Amazonas — Manaus (UTC−4)' },
  { value: 'America/Cuiaba', label: 'Mato Grosso — Cuiabá (UTC−4)' },
  { value: 'America/Boa_Vista', label: 'Roraima — Boa Vista (UTC−4)' },
  { value: 'America/Porto_Velho', label: 'Rondônia — Porto Velho (UTC−4)' },
  { value: 'America/Rio_Branco', label: 'Acre — Rio Branco (UTC−5)' },
  { value: 'America/Belem', label: 'Pará — Belém (UTC−3)' },
  { value: 'America/Fortaleza', label: 'Ceará — Fortaleza (UTC−3)' },
  { value: 'America/Recife', label: 'Pernambuco — Recife (UTC−3)' },
  { value: 'America/Bahia', label: 'Bahia — Salvador (UTC−3)' },
  { value: 'America/Maceio', label: 'Alagoas — Maceió (UTC−3)' },
  { value: 'America/Noronha', label: 'Fernando de Noronha (UTC−2)' },
  { value: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires (UTC−3)' },
  { value: 'America/Santiago', label: 'Santiago, Chile (UTC−3/−4)' },
  { value: 'America/Lima', label: 'Lima, Peru (UTC−5)' },
  { value: 'America/Bogota', label: 'Bogotá, Colômbia (UTC−5)' },
  { value: 'America/Mexico_City', label: 'Cidade do México (UTC−6)' },
  { value: 'America/New_York', label: 'New York — Eastern (UTC−5/−4)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles — Pacific (UTC−8/−7)' },
  { value: 'Europe/Lisbon', label: 'Lisboa, Portugal (UTC+0/+1)' },
  { value: 'Europe/London', label: 'Londres (UTC+0/+1)' },
  { value: 'Europe/Madrid', label: 'Madrid (UTC+1/+2)' },
  { value: 'Europe/Paris', label: 'Paris (UTC+1/+2)' },
  { value: 'UTC', label: 'UTC' },
];

const DEFAULT_TZ = 'America/Sao_Paulo';

export function OrgSection({
  org,
  loading,
  onSaved,
}: {
  org: OrgSettings | null;
  loading: boolean;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [timezone, setTimezone] = useState<string>(DEFAULT_TZ);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (org) {
      setName(org.name);
      setSlug(org.slug);
      const tzFromSettings =
        typeof org.settings?.timezone === 'string' ? org.settings.timezone : DEFAULT_TZ;
      setTimezone(tzFromSettings);
      setError(null);
    }
  }, [org]);

  if (loading || !org) {
    return <div className="h-48 animate-pulse rounded-xl bg-muted" />;
  }

  const orgTz =
    typeof org.settings?.timezone === 'string' ? org.settings.timezone : DEFAULT_TZ;
  const dirty =
    name.trim() !== org.name || slug.trim() !== org.slug || timezone !== orgTz;
  const planStyle = PLAN_LABEL[org.plan];

  async function handleSave() {
    if (!org || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      await settingsApi.updateOrg({
        ...(name.trim() !== org.name ? { name: name.trim() } : {}),
        ...(slug.trim() !== org.slug ? { slug: slug.trim() } : {}),
        ...(timezone !== orgTz ? { settings: { timezone } } : {}),
      });
      onSaved();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao salvar',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Organização</h2>
        </div>
        <span
          className={cn(
            'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider',
            planStyle.bg,
            planStyle.text,
          )}
        >
          {planStyle.label}
        </span>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Nome">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field label="Slug" hint="Letras minúsculas, números e hífens">
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            className="font-mono"
          />
        </Field>

        <Field
          label={
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Fuso horário
            </span>
          }
          hint="Usado em horários da agenda, lembretes e propostas da IA Concierge"
        >
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className={cn(
              'h-9 w-full rounded-md border border-input bg-background px-3 text-sm',
              'focus:outline-none focus:ring-2 focus:ring-ring',
            )}
          >
            {/* Se org tem TZ não-padrão e fora da lista, ainda mostra como opção */}
            {!TIMEZONES.some((tz) => tz.value === timezone) && (
              <option value={timezone}>{timezone} (custom)</option>
            )}
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* Stats compactas */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Usuários" value={`${org.member_count}/${org.max_users}`} />
        <Stat label="Canais" value={`${org.channel_count}/${org.max_channels}`} />
        <Stat label="Pipelines máx" value={String(org.max_pipelines)} />
        <Stat label="Automações máx" value={String(org.max_automations)} />
      </div>

      <div className="flex justify-end pt-1">
        <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
          {saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          Salvar
        </Button>
      </div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-background/50 px-3 py-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}
