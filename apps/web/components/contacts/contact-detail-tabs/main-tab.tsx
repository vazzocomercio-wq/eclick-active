'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Mail, Phone } from 'lucide-react';
import { toast } from 'sonner';
import type { Contact, ContactSource } from '@eclick-active/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TagPicker } from '@/components/tags/tag-picker';
import { WhatsAppVerifiedBadge } from '@/components/contacts/whatsapp-verified-badge';
import { AIGapsCard } from '@/components/ai/ai-gaps-card';
import { CustomFieldsSection } from '@/components/custom-fields/custom-fields-section';
import { contactsApi, type UpdateContactDto } from '@/lib/api/contacts';
import { ApiError } from '@/lib/api/client';
import { formatPhone } from '@/lib/format';
import { cn } from '@/lib/utils';

interface ContactMainTabProps {
  contact: Contact;
  onChanged: () => void | Promise<void>;
}

const SOURCE_VALUES: ContactSource[] = [
  'whatsapp',
  'instagram',
  'website',
  'import',
  'manual',
  'referral',
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
  const t = useTranslations('contacts.mainTab');
  const [phone, setPhone] = useState(contact.phone ?? '');
  const [email, setEmail] = useState(contact.email ?? '');
  const [source, setSource] = useState<ContactSource | ''>(contact.source ?? '');
  const [tags, setTags] = useState<string[]>(contact.tags ?? []);
  const [savingField, setSavingField] = useState<string | null>(null);

  // Sync quando o contato é recarregado. Usamos id+updated_at como sentinel
  // pra evitar reset durante a digitação (que mudaria phone/email/source/tags).
  useEffect(() => {
    setPhone(contact.phone ?? '');
    setEmail(contact.email ?? '');
    setSource(contact.source ?? '');
    setTags(contact.tags ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.id, contact.updated_at]);

  async function commit(patch: UpdateContactDto, key: string, label: string) {
    setSavingField(key);
    try {
      await contactsApi.update(contact.id, patch);
      await onChanged();
      toast.success(label);
    } catch (err) {
      toast.error(t('saveFailed'), { description: extractMessage(err, t('unknownError')) });
    } finally {
      setSavingField(null);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs">{t('infoTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <Field label={t('phoneLabel')} icon={Phone}>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={() => {
              const next = phone.trim() || null;
              if (next === contact.phone) return;
              void commit({ phone: next ?? undefined }, 'phone', t('savedPhone'));
            }}
            disabled={savingField === 'phone'}
            placeholder={t('phonePlaceholder')}
            inputMode="tel"
          />
          {contact.phone && (
            <div className="mt-1 inline-flex items-center gap-1.5">
              <a
                href={`tel:${contact.phone.replace(/\D/g, '')}`}
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                {formatPhone(contact.phone)}
              </a>
              <WhatsAppVerifiedBadge
                contactId={contact.id}
                verified={contact.whatsapp_verified}
                size="sm"
              />
            </div>
          )}
        </Field>

        <Field label={t('emailLabel')} icon={Mail}>
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => {
              const next = email.trim() || null;
              if (next === contact.email) return;
              void commit({ email: next ?? undefined }, 'email', t('savedEmail'));
            }}
            disabled={savingField === 'email'}
            placeholder={t('emailPlaceholder')}
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

        <Field label={t('sourceLabel')}>
          <select
            value={source}
            onChange={(e) => {
              const next = (e.target.value || null) as ContactSource | null;
              setSource(next ?? '');
              void commit({ source: next ?? undefined }, 'source', t('savedSource'));
            }}
            disabled={savingField === 'source'}
            className={cn(
              'h-10 w-full rounded-md border border-input bg-background px-3 text-sm',
              'focus:outline-none focus:ring-2 focus:ring-ring',
            )}
          >
            <option value="">{t('sourceEmpty')}</option>
            {SOURCE_VALUES.map((s) => (
              <option key={s} value={s}>
                {t(`sources.${s}`)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('tagsLabel')} hint={t('tagsHint')}>
          <TagPicker
            entityType="contact"
            value={tags}
            onChange={(next) => {
              setTags(next);
              const current = contact.tags ?? [];
              if (
                next.length === current.length &&
                next.every((tag, i) => tag === current[i])
              ) {
                return;
              }
              void commit({ tags: next }, 'tags', t('savedTags'));
            }}
            placeholder={t('tagsPlaceholder')}
          />
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

function extractMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return `${err.status}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return fallback;
}
