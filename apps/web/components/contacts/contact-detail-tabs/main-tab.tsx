'use client';

import { useEffect, useState } from 'react';
import { Mail, Phone } from 'lucide-react';
import { toast } from 'sonner';
import type { Contact, ContactSource } from '@eclick-active/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TagPills } from '@/components/contacts/tag-pills';
import { AIGapsCard } from '@/components/ai/ai-gaps-card';
import { CustomFieldsSection } from '@/components/custom-fields/custom-fields-section';
import { contactsApi, type UpdateContactDto } from '@/lib/api/contacts';
import { ApiError } from '@/lib/api/client';
import { formatPhone, parseTagsInput } from '@/lib/format';
import { cn } from '@/lib/utils';

interface ContactMainTabProps {
  contact: Contact;
  onChanged: () => void | Promise<void>;
}

const SOURCES: { value: ContactSource; label: string }[] = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'website', label: 'Website' },
  { value: 'import', label: 'Importado' },
  { value: 'manual', label: 'Manual' },
  { value: 'referral', label: 'Indicação' },
];

/**
 * Aba 1 — Principal do Contact Detail Sheet. Inputs com debounce em blur:
 *   - Telefone, email, source, tags
 *   - Custom fields dinâmicos (definitions cadastradas em /configuracoes)
 *   - AIGapsCard com call-to-action
 */
export function ContactMainTab({ contact, onChanged }: ContactMainTabProps) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <ContactInfoCard contact={contact} onChanged={onChanged} />
      <CustomFieldsSection
        entityType="contact"
        entityId={contact.id}
        values={contact.custom_fields ?? {}}
        onSave={async (next) => {
          await contactsApi.update(contact.id, { custom_fields: next });
          await onChanged();
        }}
      />
      <AIGapsCard contact={contact} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// ContactInfoCard
// ──────────────────────────────────────────────────────────

function ContactInfoCard({
  contact,
  onChanged,
}: {
  contact: Contact;
  onChanged: () => void | Promise<void>;
}) {
  const [phone, setPhone] = useState(contact.phone ?? '');
  const [email, setEmail] = useState(contact.email ?? '');
  const [source, setSource] = useState<ContactSource | ''>(contact.source ?? '');
  const [tags, setTags] = useState((contact.tags ?? []).join(', '));
  const [savingField, setSavingField] = useState<string | null>(null);

  // Sync quando o contato é recarregado. Usamos id+updated_at como sentinel
  // pra evitar reset durante a digitação (que mudaria phone/email/source/tags).
  useEffect(() => {
    setPhone(contact.phone ?? '');
    setEmail(contact.email ?? '');
    setSource(contact.source ?? '');
    setTags((contact.tags ?? []).join(', '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.id, contact.updated_at]);

  async function commit(patch: UpdateContactDto, key: string, label: string) {
    setSavingField(key);
    try {
      await contactsApi.update(contact.id, patch);
      await onChanged();
      toast.success(label);
    } catch (err) {
      toast.error('Falha ao salvar', { description: extractMessage(err) });
    } finally {
      setSavingField(null);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs">Informações</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <Field label="Telefone" icon={Phone}>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={() => {
              const next = phone.trim() || null;
              if (next === contact.phone) return;
              void commit({ phone: next ?? undefined }, 'phone', 'Telefone salvo');
            }}
            disabled={savingField === 'phone'}
            placeholder="+55 11 99999-9999"
            inputMode="tel"
          />
          {contact.phone && (
            <a
              href={`tel:${contact.phone.replace(/\D/g, '')}`}
              className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              {formatPhone(contact.phone)}
            </a>
          )}
        </Field>

        <Field label="Email" icon={Mail}>
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => {
              const next = email.trim() || null;
              if (next === contact.email) return;
              void commit({ email: next ?? undefined }, 'email', 'Email salvo');
            }}
            disabled={savingField === 'email'}
            placeholder="contato@exemplo.com"
            inputMode="email"
            type="email"
          />
          {contact.email && (
            <a
              href={`mailto:${contact.email}`}
              className="mt-1 inline-flex items-center gap-1 truncate text-[11px] text-primary hover:underline"
            >
              {contact.email}
            </a>
          )}
        </Field>

        <Field label="Origem (source)">
          <select
            value={source}
            onChange={(e) => {
              const next = (e.target.value || null) as ContactSource | null;
              setSource(next ?? '');
              void commit({ source: next ?? undefined }, 'source', 'Origem salva');
            }}
            disabled={savingField === 'source'}
            className={cn(
              'h-10 w-full rounded-md border border-input bg-background px-3 text-sm',
              'focus:outline-none focus:ring-2 focus:ring-ring',
            )}
          >
            <option value="">— Sem origem —</option>
            {SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Tags" hint="Separe com vírgula">
          <Input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            onBlur={() => {
              const parsed = parseTagsInput(tags);
              const current = contact.tags ?? [];
              if (
                parsed.length === current.length &&
                parsed.every((t, i) => t === current[i])
              ) {
                return;
              }
              void commit({ tags: parsed }, 'tags', 'Tags salvas');
            }}
            placeholder="lead-quente, b2b"
            disabled={savingField === 'tags'}
          />
          {(contact.tags ?? []).length > 0 && (
            <TagPills tags={contact.tags} max={10} className="mt-1" />
          )}
        </Field>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  icon: Icon,
  children,
}: {
  label: string;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </Label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function extractMessage(err: unknown): string {
  if (err instanceof ApiError) return `${err.status}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return 'Erro desconhecido';
}
