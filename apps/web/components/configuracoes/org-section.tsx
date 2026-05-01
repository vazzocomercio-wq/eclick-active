'use client';

import { useEffect, useState } from 'react';
import { Building2, Loader2 } from 'lucide-react';
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (org) {
      setName(org.name);
      setSlug(org.slug);
      setError(null);
    }
  }, [org]);

  if (loading || !org) {
    return <div className="h-48 animate-pulse rounded-xl bg-muted" />;
  }

  const dirty = name.trim() !== org.name || slug.trim() !== org.slug;
  const planStyle = PLAN_LABEL[org.plan];

  async function handleSave() {
    if (!org || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      await settingsApi.updateOrg({
        ...(name.trim() !== org.name ? { name: name.trim() } : {}),
        ...(slug.trim() !== org.slug ? { slug: slug.trim() } : {}),
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
  label: string;
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
