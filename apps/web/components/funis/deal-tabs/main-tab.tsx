'use client';

import { useEffect, useState } from 'react';
import { Building2, Mail, Phone, Tag as TagIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { Deal } from '@eclick-active/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { InitialsAvatar } from '@/components/contacts/initials-avatar';
import { TemperatureBadge } from '@/components/contacts/temperature-badge';
import { AIGapsCard } from '@/components/ai/ai-gaps-card';
import { CustomFieldsSection } from '@/components/custom-fields/custom-fields-section';
import { useTeamMembers } from '@/hooks/use-team-members';
import { dealsApi, type UpdateDealInput } from '@/lib/api/deals';
import { ApiError } from '@/lib/api/client';
import { formatPhone, parseTagsInput } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Shape mínima do contato que o MainTab precisa. Todos os campos são
 * opcionais — assim o componente aceita qualquer subset (matching o que
 * `useDealDetail` retorna hoje, sem exigir reload de schema).
 */
interface MainTabContact {
  id?: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  temperature?: 'cold' | 'warm' | 'hot' | 'very_hot' | null;
  company_id?: string | null;
  tags?: string[] | null;
}

interface DealMainTabProps {
  deal: Deal & {
    contact?: MainTabContact | null;
    company?: { id: string; name: string; domain: string | null } | null;
  };
  conversationId?: string | null;
  /** Recebe sugestão de mensagem do AIGapsCard pra preencher o chat. */
  onAskClient?: (text: string) => void;
  onChanged: () => void | Promise<void>;
}

/**
 * Aba "Principal" do Deal Detail Sheet — agrupa contato, metadados do deal,
 * custom fields (fallback jsonb) e o AIGapsCard com call-to-action.
 *
 * Estratégia pra custom fields: como ainda não existe a tabela
 * `custom_field_definitions` no schema, o componente usa fallback puro:
 * renderiza `deal.custom_fields` jsonb como pares chave/valor editáveis.
 * Quando a tabela for adicionada (TODO backend), troca o componente
 * `<CustomFieldsFallback>` por um `<CustomFieldsDefinitions>` que renderiza
 * inputs corretos por field_type.
 */
export function DealMainTab({
  deal,
  conversationId,
  onAskClient,
  onChanged,
}: DealMainTabProps) {
  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Contato */}
      {deal.contact ? (
        <ContactCard contact={deal.contact} companyName={deal.company?.name ?? null} />
      ) : (
        <Card>
          <CardContent className="py-3 text-xs text-muted-foreground">
            Deal sem contato vinculado.
          </CardContent>
        </Card>
      )}

      {/* Dados do deal: data esperada, atribuído, tags */}
      <DealDataCard deal={deal} onChanged={onChanged} />

      {/* Custom fields dinâmicos (definitions cadastradas em /configuracoes).
          Se a org não tem campos cadastrados, o componente não renderiza. */}
      <CustomFieldsSection
        entityType="deal"
        entityId={deal.id}
        values={deal.custom_fields ?? {}}
        onSave={async (next) => {
          await dealsApi.update(deal.id, { custom_fields: next });
          await onChanged();
        }}
      />

      {/* Gaps & pendências */}
      <AIGapsCard
        contact={deal.contact ?? null}
        deal={deal}
        conversationId={conversationId ?? null}
        onAskClient={onAskClient}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// ContactCard
// ──────────────────────────────────────────────────────────

function ContactCard({
  contact,
  companyName,
}: {
  contact: NonNullable<DealMainTabProps['deal']['contact']>;
  companyName: string | null;
}) {
  const phoneHref = contact.phone ? `tel:${contact.phone.replace(/\D/g, '')}` : null;
  const emailHref = contact.email ? `mailto:${contact.email}` : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs">Contato</CardTitle>
      </CardHeader>
      <CardContent className="flex items-start gap-3 pt-0">
        <InitialsAvatar
          name={contact.name ?? null}
          src={contact.avatar_url ?? null}
          className="h-10 w-10 text-xs"
        />
        <div className="flex flex-1 flex-col gap-1.5 min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">
              {contact.name ?? 'Sem nome'}
            </span>
            {contact.temperature && <TemperatureBadge temperature={contact.temperature} />}
          </div>
          {phoneHref && (
            <a
              href={phoneHref}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-primary"
            >
              <Phone className="h-3 w-3" />
              {formatPhone(contact.phone!)}
            </a>
          )}
          {emailHref && (
            <a
              href={emailHref}
              className="inline-flex items-center gap-1.5 truncate text-xs text-muted-foreground transition-colors hover:text-primary"
            >
              <Mail className="h-3 w-3 shrink-0" />
              <span className="truncate">{contact.email}</span>
            </a>
          )}
          {companyName && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Building2 className="h-3 w-3" />
              {companyName}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────
// DealDataCard — close date, assigned, tags
// ──────────────────────────────────────────────────────────

function DealDataCard({
  deal,
  onChanged,
}: {
  deal: DealMainTabProps['deal'];
  onChanged: () => void | Promise<void>;
}) {
  const { members } = useTeamMembers();
  const [closeDate, setCloseDate] = useState(deal.expected_close_date ?? '');
  const [tags, setTags] = useState((deal.tags ?? []).join(', '));
  const [savingField, setSavingField] = useState<string | null>(null);

  // Sync state quando o deal muda (após reload)
  useEffect(() => {
    setCloseDate(deal.expected_close_date ?? '');
    setTags((deal.tags ?? []).join(', '));
  }, [deal.expected_close_date, deal.tags]);

  async function commitField(patch: UpdateDealInput, key: string, label: string) {
    setSavingField(key);
    try {
      await dealsApi.update(deal.id, patch);
      await onChanged();
      toast.success(label);
    } catch (err) {
      toast.error('Falha ao salvar', {
        description: extractMessage(err),
      });
    } finally {
      setSavingField(null);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs">Dados do deal</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <Field label="Data esperada de fechamento">
          <Input
            type="date"
            value={closeDate}
            onChange={(e) => setCloseDate(e.target.value)}
            onBlur={() => {
              const next = closeDate || null;
              if (next === deal.expected_close_date) return;
              void commitField(
                { expected_close_date: next },
                'expected_close_date',
                'Data salva',
              );
            }}
            disabled={savingField === 'expected_close_date'}
          />
        </Field>

        <Field label="Atribuído a">
          <select
            value={deal.assigned_to ?? ''}
            onChange={(e) => {
              const next = e.target.value || null;
              void commitField({ assigned_to: next }, 'assigned_to', 'Atribuição salva');
            }}
            disabled={savingField === 'assigned_to'}
            className={cn(
              'h-10 w-full rounded-md border border-input bg-background px-3 text-sm',
              'focus:outline-none focus:ring-2 focus:ring-ring',
            )}
          >
            <option value="">— Sem atribuição —</option>
            {members.map((m) => (
              <option key={m.id} value={m.user_id}>
                {m.display_name ?? m.email ?? m.user_id}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Tags" hint="Vírgula entre">
          <Input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            onBlur={() => {
              const parsed = parseTagsInput(tags);
              const current = deal.tags ?? [];
              if (
                parsed.length === current.length &&
                parsed.every((t, i) => t === current[i])
              ) {
                return;
              }
              void commitField({ tags: parsed }, 'tags', 'Tags salvas');
            }}
            placeholder="lead-quente, b2b"
            disabled={savingField === 'tags'}
            inputMode="text"
          />
          {(deal.tags ?? []).length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {(deal.tags ?? []).map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px]"
                >
                  <TagIcon className="h-2.5 w-2.5" />
                  {t}
                </span>
              ))}
            </div>
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
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
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

