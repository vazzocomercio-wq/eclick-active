'use client';

import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { aiApi } from '@/lib/api/ai';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface AiFillButtonProps {
  entityType: 'deal' | 'contact' | 'company' | 'task';
  entityId: string;
  fieldName: string;
  currentValue?: string;
  /** Hint opcional pra IA (ex: "tom informal", "passos numerados"). */
  hint?: string;
  /** Disparado quando a IA retorna o texto. Pai aplica via setState/onChange. */
  onFill: (value: string) => void;
  /** Tamanho do ícone. Default: 'sm' (14px). */
  size?: 'xs' | 'sm';
  className?: string;
  disabled?: boolean;
}

/**
 * Botão "✨" pequeno que dispara `POST /ai/fill-field` e chama `onFill`
 * com o texto gerado. UX:
 *   - Click → loading spinner no lugar do ícone
 *   - Sucesso → onFill com o texto + toast info "Preenchido com IA"
 *   - Erro → toast erro
 *   - Botão fica disabled durante a request
 *
 * Sem `entityId` ou `fieldName` o botão é um no-op (não renderiza).
 */
export function AiFillButton({
  entityType,
  entityId,
  fieldName,
  currentValue,
  hint,
  onFill,
  size = 'sm',
  className,
  disabled,
}: AiFillButtonProps) {
  const [loading, setLoading] = useState(false);

  if (!entityId || !fieldName) return null;

  async function handleClick() {
    setLoading(true);
    try {
      const result = await aiApi.fillField({
        entity_type: entityType,
        entity_id: entityId,
        field_name: fieldName,
        ...(currentValue !== undefined ? { current_value: currentValue } : {}),
        ...(hint ? { hint } : {}),
      });
      onFill(result.value);
      toast.success('Preenchido com IA', {
        description: result.value.slice(0, 80),
      });
    } catch (err) {
      toast.error('Falha ao gerar com IA', {
        description:
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'Erro desconhecido',
      });
    } finally {
      setLoading(false);
    }
  }

  const dim = size === 'xs' ? 'h-3 w-3' : 'h-3.5 w-3.5';
  const btnDim = size === 'xs' ? 'h-6 w-6' : 'h-7 w-7';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || loading}
      aria-label="Preencher com IA"
      title="Preencher com IA"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md text-primary transition-colors',
        'hover:bg-primary/10 disabled:opacity-50 disabled:cursor-not-allowed',
        btnDim,
        className,
      )}
    >
      {loading ? (
        <Loader2 className={cn(dim, 'animate-spin')} />
      ) : (
        <Sparkles className={dim} />
      )}
    </button>
  );
}
