'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { contactsApi, type Contact } from '@/lib/api/contacts';
import { ApiError } from '@/lib/api/client';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface WhatsAppVerifiedBadgeProps {
  /** ID do contato — usado quando o user clica em "?" pra verificar agora */
  contactId?: string;
  /** Estado da verificação. null = nunca validado, true = é WhatsApp, false = não é */
  verified: boolean | null;
  /** Tamanho. sm: 12px, md: 14px (default), lg: 16px */
  size?: 'sm' | 'md' | 'lg';
  /**
   * Disparado quando a verificação on-demand termina com sucesso. Pai pode
   * usar pra atualizar a row local com `whatsapp_verified` novo.
   */
  onVerified?: (next: Pick<Contact, 'whatsapp_verified' | 'whatsapp_jid' | 'whatsapp_profile_name' | 'whatsapp_profile_pic_url'>) => void;
  /** Esconde o badge quando verified===null (não foi validado) */
  hideUnknown?: boolean;
  className?: string;
}

const SIZE_PX = { sm: 12, md: 14, lg: 16 } as const;

/**
 * Indicador de "esse número é WhatsApp ativo?". Aparece ao lado de
 * telefones em listas, sheets e cards.
 *
 * 3 estados visuais:
 *   - ✅ verde (ícone WhatsApp): contato.whatsapp_verified === true
 *   - ❓ cinza (ícone WhatsApp opaco): null → clicável, dispara validação
 *   - ❌ vermelho riscado: false → o número não é WhatsApp
 *
 * Quando clica no estado ❓, chama POST /contacts/:id/verify-whatsapp,
 * atualiza estado local e dispara onVerified pro pai sincronizar.
 */
export function WhatsAppVerifiedBadge({
  contactId,
  verified,
  size = 'md',
  onVerified,
  hideUnknown,
  className,
}: WhatsAppVerifiedBadgeProps) {
  const t = useTranslations('contacts.verifyBadge');
  const [loading, setLoading] = useState(false);
  const px = SIZE_PX[size];

  // Hide se não verificado e flag passada (usado em listas densas)
  if (verified === null && hideUnknown) return null;

  async function handleVerify(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!contactId || loading) return;
    setLoading(true);
    try {
      const res = await contactsApi.verifyWhatsapp(contactId);
      if (!res.ok || !res.result) {
        toast.warning(t('unavailableTitle'), {
          description: t('unavailableDescription'),
        });
        return;
      }
      const next = res.result;
      toast.success(
        next.exists ? t('verifiedSuccess') : t('notWhatsappSuccess'),
      );
      onVerified?.({
        whatsapp_verified: next.exists,
        whatsapp_jid: next.jid ?? null,
        whatsapp_profile_name: next.profile_name ?? null,
        whatsapp_profile_pic_url: next.profile_pic_url ?? null,
      });
    } catch (err) {
      toast.error(t('failed'), {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }

  let tooltip = '';
  let icon: React.ReactElement;

  if (loading) {
    tooltip = t('verifying');
    icon = <Loader2 width={px} height={px} className="animate-spin text-muted-foreground" />;
  } else if (verified === true) {
    tooltip = t('verified');
    icon = <WhatsAppGlyph size={px} className="text-emerald-500" />;
  } else if (verified === false) {
    tooltip = t('notWhatsapp');
    icon = <WhatsAppGlyphCrossed size={px} className="text-rose-400" />;
  } else {
    tooltip = contactId ? t('unverifiedInteractive') : t('unverified');
    icon = <WhatsAppGlyph size={px} className="text-muted-foreground/60" />;
  }

  const interactive = verified === null && contactId !== undefined;

  const content = (
    <span
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : -1}
      aria-label={tooltip}
      onClick={interactive ? handleVerify : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                void handleVerify(e as unknown as React.MouseEvent);
              }
            }
          : undefined
      }
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        interactive && 'cursor-pointer rounded-full hover:bg-muted',
        interactive && size === 'lg' ? 'p-0.5' : '',
        className,
      )}
    >
      {icon}
    </span>
  );

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ──────────────────────────────────────────────────────────
// Glifos do WhatsApp (SVG simples, sem dependência de lib)
// ──────────────────────────────────────────────────────────

function WhatsAppGlyph({ size, className }: { size: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.166-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.371-.272.298-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.247-.694.247-1.289.173-1.413-.074-.124-.272-.198-.57-.347zm-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884zm8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function WhatsAppGlyphCrossed({ size, className }: { size: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        opacity="0.5"
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.166-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.371-.272.298-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.247-.694.247-1.289.173-1.413-.074-.124-.272-.198-.57-.347zm-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884zm8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"
      />
      <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
