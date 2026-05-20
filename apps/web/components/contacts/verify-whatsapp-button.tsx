'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { contactsApi } from '@/lib/api/contacts';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface VerifyResult {
  exists: boolean;
  jid?: string;
  profile_name?: string;
  profile_pic_url?: string;
  provider: 'baileys' | 'zapi';
}

interface BaseProps {
  /** Disparado quando verificação termina com sucesso. */
  onResult?: (result: VerifyResult | null) => void;
  /** Estado inicial pra mostrar resultado já conhecido (ex: contato salvo). */
  initialResult?: VerifyResult | null;
  /** Esconde o botão quando o phone ainda não tem dígitos suficientes. */
  hideWhenEmpty?: boolean;
  /** Texto do estado idle. Default: "Verificar WhatsApp". */
  idleLabel?: string;
  className?: string;
}

interface ContactModeProps extends BaseProps {
  mode: 'contact';
  /** ID do contato já criado. Chama POST /contacts/:id/verify-whatsapp. */
  contactId: string;
}

interface PhoneModeProps extends BaseProps {
  mode: 'phone';
  /** Phone solto (input do form). Chama POST /contacts/verify-whatsapp-by-phone. */
  phone: string;
}

type Props = ContactModeProps | PhoneModeProps;

/**
 * Pílula clicável pra verificar se um número é WhatsApp ativo.
 *
 * Dois modos:
 *   - `mode="contact"` → contato já existe, persiste resultado no DB
 *   - `mode="phone"`   → phone solto, preview sem persistir (form cadastro)
 *
 * Estados visuais:
 *   - idle (cyan)     → "Verificar WhatsApp"
 *   - loading (cinza) → "Verificando…"
 *   - exists (verde)  → "É WhatsApp" ou nome do perfil
 *   - !exists (rose)  → "Não é WhatsApp"
 *
 * Sempre clicável quando idle/resultado (permite re-verificar). Disabled
 * apenas em loading ou quando phone tem <10 dígitos no modo `phone`.
 */
export function VerifyWhatsAppButton(props: Props) {
  const t = useTranslations('contacts.verifyButton');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(props.initialResult ?? null);

  const phoneDigits =
    props.mode === 'phone' ? props.phone.replace(/\D/g, '') : '';
  const hasInput = props.mode === 'contact' || phoneDigits.length >= 10;

  if (props.hideWhenEmpty && !hasInput) return null;

  async function handleClick() {
    if (!hasInput || loading) return;
    setLoading(true);
    try {
      const res =
        props.mode === 'contact'
          ? await contactsApi.verifyWhatsapp(props.contactId)
          : await contactsApi.verifyWhatsappByPhone(props.phone);
      if (!res.ok || !res.result) {
        toast.warning(t('unavailableTitle'), {
          description: t('unavailableDescription'),
        });
        return;
      }
      setResult(res.result);
      props.onResult?.(res.result);
      toast.success(
        res.result.exists ? t('verifiedSuccess') : t('notWhatsappSuccess'),
      );
    } catch (err) {
      toast.error(t('failed'), {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }

  let label: string;
  let stateClass: string;
  let icon: React.ReactNode;

  if (loading) {
    label = t('verifying');
    stateClass = 'border-border bg-background/60 text-muted-foreground';
    icon = <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  } else if (result?.exists) {
    label = result.profile_name
      ? `${result.profile_name} · ${t('profileSuffix')}`
      : t('isWhatsapp');
    stateClass =
      'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20';
    icon = <WhatsAppGlyph className="h-3.5 w-3.5" />;
  } else if (result && !result.exists) {
    label = t('notWhatsapp');
    stateClass =
      'border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20';
    icon = <WhatsAppGlyphCrossed className="h-3.5 w-3.5" />;
  } else {
    label = props.idleLabel ?? t('defaultIdle');
    stateClass =
      'border-cyan-500/30 bg-cyan-500/5 text-cyan-300 hover:border-cyan-400 hover:bg-cyan-500/15';
    icon = <WhatsAppGlyph className="h-3.5 w-3.5" />;
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!hasInput || loading}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
        stateClass,
        !hasInput && 'cursor-not-allowed opacity-50',
        props.className,
      )}
      aria-label={label}
      title={
        !hasInput
          ? t('titleNoInput')
          : result
            ? t('titleRecheck')
            : t('titleCheck')
      }
    >
      {icon}
      <span className="truncate max-w-[16ch]">{label}</span>
      {result && !loading && <RotateCw className="h-3 w-3 opacity-60" />}
    </button>
  );
}

// ──────────────────────────────────────────────────────────
// Glifos do WhatsApp (SVG inline — sem dep extra)
// ──────────────────────────────────────────────────────────

function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.166-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.371-.272.298-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.247-.694.247-1.289.173-1.413-.074-.124-.272-.198-.57-.347zm-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884zm8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function WhatsAppGlyphCrossed({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        opacity="0.5"
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.166-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.371-.272.298-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.247-.694.247-1.289.173-1.413-.074-.124-.272-.198-.57-.347zm-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884zm8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"
      />
      <line
        x1="3"
        y1="3"
        x2="21"
        y2="21"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
