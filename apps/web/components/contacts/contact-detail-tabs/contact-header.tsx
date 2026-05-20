'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, MoreVertical, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Contact } from '@eclick-active/shared';
import { Button } from '@/components/ui/button';
import { InitialsAvatar } from '@/components/contacts/initials-avatar';
import { TemperatureBadge } from '@/components/contacts/temperature-badge';
import { ScoreBar } from '@/components/contacts/score-bar';
import { contactsApi } from '@/lib/api/contacts';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface ContactHeaderProps {
  contact: Contact;
  onChanged: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  deleting: boolean;
}

/**
 * Header fixo do Contact Detail Sheet.
 *
 *  - Avatar grande (h-14)
 *  - Nome inline-edit (click → input, Enter/blur salva, Esc cancela)
 *  - Badges: temperatura, score (com barra)
 *  - Menu ⋯ (excluir)
 */
export function ContactHeader({
  contact,
  onChanged,
  onDelete,
  deleting,
}: ContactHeaderProps) {
  const t = useTranslations('contacts.header');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  return (
    // pr-12 reserva espaço pro botão "X" de fechar do Sheet (absolute right-4
    // top-4) — sem isso, o menu MoreVertical fica sobrepondo o X.
    <div className="flex flex-col gap-3 border-b border-border bg-card/30 px-5 py-4 pr-12">
      <div className="flex items-start gap-3">
        <InitialsAvatar
          name={contact.name}
          src={contact.avatar_url}
          className="h-14 w-14 shrink-0 text-base"
        />

        <div className="flex flex-1 flex-col gap-1 min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('kicker', { id: contact.id.slice(-4).toUpperCase() })}
          </span>

          <InlineNameField
            value={contact.name ?? ''}
            placeholder={t('namePlaceholder')}
            ariaLabel={t('nameAria')}
            ariaClickLabel={t('nameClickToEdit')}
            onSave={async (next) => {
              try {
                // DTO trata `undefined` como "não mexer" — pra "limpar" o
                // nome, passamos string vazia (DB aceita name nullable na
                // schema mas o DTO atual não expõe `null`).
                await contactsApi.update(contact.id, { name: next });
                await onChanged();
                toast.success(t('nameSaved'));
              } catch (err) {
                toast.error(t('saveFailed'), {
                  description: extractMessage(err),
                });
                throw err;
              }
            }}
          />

          <div className="flex flex-wrap items-center gap-2">
            {contact.temperature && <TemperatureBadge temperature={contact.temperature} />}
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              {t('scoreLabel')}{' '}
              <span className="font-semibold tabular-nums text-foreground">
                {contact.score}
              </span>
            </span>
            <ScoreBar score={contact.score} showValue={false} className="w-24" />
          </div>
        </div>

        <div ref={menuRef} className="relative">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={t('moreOptions')}
            className="h-7 w-7"
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </Button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-30 mt-1 w-40 overflow-hidden rounded-md border border-border bg-popover shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  void onDelete();
                }}
                disabled={deleting}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                {deleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                {t('delete')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// InlineNameField
// ──────────────────────────────────────────────────────────

function InlineNameField({
  value,
  placeholder,
  ariaLabel,
  ariaClickLabel,
  onSave,
}: {
  value: string;
  placeholder: string;
  ariaLabel: string;
  ariaClickLabel: string;
  onSave: (next: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  async function commit() {
    const trimmed = draft.trim();
    if (trimmed === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(trimmed);
      setEditing(false);
    } catch {
      setDraft(value);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void commit();
          } else if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
        disabled={saving}
        aria-label={ariaLabel}
        className="rounded-md border border-input bg-background px-2 py-1 text-base font-semibold leading-tight outline-none focus:ring-2 focus:ring-ring"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label={ariaClickLabel}
      className={cn(
        'rounded-md px-2 py-1 text-left text-base font-semibold leading-tight transition-colors hover:bg-muted/60',
        !value && 'italic text-muted-foreground',
      )}
    >
      {value || placeholder}
    </button>
  );
}

function extractMessage(err: unknown): string {
  if (err instanceof ApiError) return `${err.status}: ${err.message}`;
  if (err instanceof Error) return err.message;
  // Mensagem final neutra — Header não tem hook scope aqui pra i18n.
  // O toast pai já traduz o título; isto é apenas a description fallback.
  return 'Error';
}
