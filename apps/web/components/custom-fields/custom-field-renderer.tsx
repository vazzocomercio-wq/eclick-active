'use client';

import { useEffect, useState } from 'react';
import {
  Copy,
  ExternalLink,
  Loader2,
  MapPin,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  AddressFullValue,
  CustomFieldDefinition,
  CustomFieldOption,
} from '@eclick-active/shared';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { AiFillButton } from '@/components/ai/ai-fill-button';
import { cn } from '@/lib/utils';

export interface CustomFieldRendererProps {
  field: CustomFieldDefinition;
  value: unknown;
  onChange: (next: unknown) => void;
  /**
   * Habilita botão ✨ "Preencher com IA" em campos text/textarea/email/url.
   * Sem esses props o botão não aparece.
   */
  aiContext?: {
    entityType: 'deal' | 'contact' | 'company' | 'task';
    entityId: string;
  };
  className?: string;
}

/**
 * Renderer dinâmico de campo personalizado. Recebe a `definition` (vinda
 * de GET /custom-fields) + valor atual + onChange, e renderiza o input
 * correto pelo `field_type`.
 *
 * Notas:
 *   - `is_api_only=true` → input desabilitado com badge "API"
 *   - `is_required=true` → asterisco vermelho no label
 *   - `ai_auto_fill=true` → ícone ✨ discreto ao lado (informativo)
 *   - O componente NÃO faz save — só dispara `onChange`. Quem persiste
 *     é o `<CustomFieldsSection>` (debounced).
 */
export function CustomFieldRenderer({
  field,
  value,
  onChange,
  aiContext,
  className,
}: CustomFieldRendererProps) {
  // Tipos elegíveis pra "Preencher com IA" — onde geração textual faz sentido
  const aiEligibleTypes = ['text', 'textarea', 'email', 'url'];
  const aiEnabled =
    aiContext &&
    field.ai_auto_fill &&
    !field.is_api_only &&
    aiEligibleTypes.includes(field.field_type);

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel field={field} />
        {aiEnabled && aiContext && (
          <AiFillButton
            entityType={aiContext.entityType}
            entityId={aiContext.entityId}
            fieldName={field.name}
            currentValue={typeof value === 'string' ? value : undefined}
            onFill={(v) => onChange(v)}
            size="xs"
          />
        )}
      </div>
      <FieldInput field={field} value={value} onChange={onChange} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Label
// ──────────────────────────────────────────────────────────

function FieldLabel({ field }: { field: CustomFieldDefinition }) {
  return (
    <Label className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
      <span>
        {field.name}
        {field.is_required && <span className="ml-0.5 text-destructive">*</span>}
      </span>
      {field.ai_auto_fill && (
        <span title="IA pode preencher automaticamente">
          <Sparkles className="h-3 w-3 text-primary/60" />
        </span>
      )}
      {field.is_api_only && (
        <span
          className="inline-flex items-center rounded-sm bg-muted px-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground"
          title="Somente leitura — atualizado via API"
        >
          API
        </span>
      )}
    </Label>
  );
}

// ──────────────────────────────────────────────────────────
// Dispatch por field_type
// ──────────────────────────────────────────────────────────

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: CustomFieldDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const disabled = field.is_api_only;

  switch (field.field_type) {
    case 'text':
    case 'phone':
      return (
        <Input
          value={asString(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? ''}
          disabled={disabled}
          inputMode={field.field_type === 'phone' ? 'tel' : 'text'}
        />
      );

    case 'email':
      return (
        <Input
          type="email"
          value={asString(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? ''}
          disabled={disabled}
        />
      );

    case 'textarea':
      return (
        <Textarea
          value={asString(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? ''}
          disabled={disabled}
          rows={3}
          className="min-h-[72px] resize-none text-sm"
        />
      );

    case 'number':
      return (
        <Input
          type="number"
          value={asString(value)}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === '' ? null : Number(v));
          }}
          placeholder={field.placeholder ?? ''}
          disabled={disabled}
          inputMode="decimal"
        />
      );

    case 'date':
      return (
        <Input
          type="date"
          value={asString(value)}
          onChange={(e) => onChange(e.target.value || null)}
          disabled={disabled}
        />
      );

    case 'toggle':
      return (
        <ToggleField value={!!value} onChange={onChange} disabled={disabled} />
      );

    case 'select':
      return (
        <SelectField
          value={asString(value)}
          options={field.options}
          placeholder={field.placeholder ?? '— Selecione —'}
          disabled={disabled}
          onChange={onChange}
        />
      );

    case 'radio':
      return (
        <RadioField
          value={asString(value)}
          options={field.options}
          disabled={disabled}
          onChange={onChange}
        />
      );

    case 'multi_select':
      return (
        <MultiSelectField
          value={asStringArray(value)}
          options={field.options}
          disabled={disabled}
          onChange={onChange}
        />
      );

    case 'checkbox':
      return (
        <CheckboxField
          value={!!value}
          label={field.placeholder ?? field.name}
          disabled={disabled}
          onChange={onChange}
        />
      );

    case 'url':
      return (
        <UrlField
          value={asString(value)}
          placeholder={field.placeholder ?? 'https://exemplo.com'}
          disabled={disabled}
          onChange={onChange}
        />
      );

    case 'address_short':
      return (
        <AddressShortField
          value={asString(value)}
          placeholder={field.placeholder ?? 'Rua, número, bairro, cidade'}
          disabled={disabled}
          onChange={onChange}
        />
      );

    case 'address_full':
      return (
        <AddressFullField
          value={asAddressFull(value)}
          disabled={disabled}
          onChange={onChange}
        />
      );

    default: {
      const _exhaustive: never = field.field_type;
      void _exhaustive;
      return (
        <p className="text-xs italic text-destructive">
          Tipo de campo desconhecido: {String(field.field_type)}
        </p>
      );
    }
  }
}

// ──────────────────────────────────────────────────────────
// Sub-components por tipo
// ──────────────────────────────────────────────────────────

function ToggleField({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={cn(
        'inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
        value ? 'bg-primary' : 'bg-muted',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 rounded-full bg-background shadow transition-transform',
          value ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

function SelectField({
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: {
  value: string;
  options: CustomFieldOption[];
  placeholder: string;
  disabled: boolean;
  onChange: (v: string | null) => void;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
      className={cn(
        'h-10 w-full rounded-md border border-input bg-background px-3 text-sm',
        'focus:outline-none focus:ring-2 focus:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      <option value="">{placeholder}</option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function RadioField({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string;
  options: CustomFieldOption[];
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {options.map((opt) => (
        <label
          key={opt.value}
          className={cn(
            'inline-flex items-center gap-2 text-sm',
            disabled && 'opacity-50',
          )}
        >
          <input
            type="radio"
            checked={value === opt.value}
            disabled={disabled}
            onChange={() => onChange(opt.value)}
            className="h-4 w-4 accent-primary"
          />
          <span>{opt.label}</span>
        </label>
      ))}
    </div>
  );
}

function MultiSelectField({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string[];
  options: CustomFieldOption[];
  disabled: boolean;
  onChange: (v: string[]) => void;
}) {
  function toggle(v: string) {
    if (value.includes(v)) {
      onChange(value.filter((x) => x !== v));
    } else {
      onChange([...value, v]);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {options.map((opt) => {
        const checked = value.includes(opt.value);
        return (
          <label
            key={opt.value}
            className={cn(
              'inline-flex items-center gap-2 text-sm',
              disabled && 'opacity-50',
            )}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={() => toggle(opt.value)}
              className="h-4 w-4 accent-primary"
            />
            <span>{opt.label}</span>
          </label>
        );
      })}
    </div>
  );
}

function CheckboxField({
  value,
  label,
  disabled,
  onChange,
}: {
  value: boolean;
  label: string;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={cn(
        'inline-flex items-center gap-2 text-sm',
        disabled && 'opacity-50',
      )}
    >
      <input
        type="checkbox"
        checked={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-primary"
      />
      <span>{label}</span>
    </label>
  );
}

function UrlField({
  value,
  placeholder,
  disabled,
  onChange,
}: {
  value: string;
  placeholder: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const valid = isValidUrl(value);

  async function handleCopy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success('URL copiada');
    } catch {
      toast.error('Falha ao copiar');
    }
  }

  return (
    <div className="flex items-stretch gap-1.5">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        type="url"
        inputMode="url"
        className="flex-1"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!valid}
        onClick={() => valid && window.open(value, '_blank', 'noopener,noreferrer')}
        title="Visitar"
        aria-label="Visitar URL"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!value}
        onClick={() => void handleCopy()}
        title="Copiar"
        aria-label="Copiar URL"
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function AddressShortField({
  value,
  placeholder,
  disabled,
  onChange,
}: {
  value: string;
  placeholder: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  function openMaps() {
    if (!value) return;
    const q = encodeURIComponent(value);
    window.open(
      `https://www.google.com/maps/search/?api=1&query=${q}`,
      '_blank',
      'noopener,noreferrer',
    );
  }

  return (
    <div className="flex items-stretch gap-1.5">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="flex-1"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!value.trim()}
        onClick={openMaps}
        title="Ver no mapa"
        aria-label="Ver no Google Maps"
      >
        <MapPin className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// AddressFullField — 6 inputs + auto-fill ViaCEP
// ──────────────────────────────────────────────────────────

interface ViaCepResponse {
  cep?: string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
}

function AddressFullField({
  value,
  disabled,
  onChange,
}: {
  value: AddressFullValue;
  disabled: boolean;
  onChange: (v: AddressFullValue) => void;
}) {
  const [cepLoading, setCepLoading] = useState(false);
  const [cepDraft, setCepDraft] = useState(value.zip ?? '');

  // Sync se value mudar externamente
  useEffect(() => {
    setCepDraft(value.zip ?? '');
  }, [value.zip]);

  function patch(p: Partial<AddressFullValue>) {
    onChange({ ...value, ...p });
  }

  async function fetchViaCep(rawCep: string) {
    const cep = rawCep.replace(/\D/g, '');
    if (cep.length !== 8) return;
    setCepLoading(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      if (!r.ok) {
        toast.error('CEP não encontrado');
        return;
      }
      const data = (await r.json()) as ViaCepResponse;
      if (data.erro) {
        toast.error('CEP inválido');
        return;
      }
      onChange({
        ...value,
        zip: cep,
        line1: data.logradouro ? data.logradouro : value.line1,
        line2: data.bairro ?? value.line2,
        city: data.localidade ?? value.city,
        state: data.uf ?? value.state,
        country: value.country ?? 'Brasil',
      });
      toast.success('Endereço auto-preenchido');
    } catch {
      toast.error('Falha ao consultar CEP');
    } finally {
      setCepLoading(false);
    }
  }

  function buildMapsQuery(): string {
    const parts = [value.line1, value.line2, value.city, value.state, value.zip, value.country]
      .filter(Boolean)
      .join(', ');
    return encodeURIComponent(parts);
  }

  function openMaps() {
    const q = buildMapsQuery();
    if (!q) return;
    window.open(
      `https://www.google.com/maps/search/?api=1&query=${q}`,
      '_blank',
      'noopener,noreferrer',
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-background/50 p-2">
      <div className="grid grid-cols-2 gap-2">
        <SubField label="CEP">
          <div className="flex items-stretch gap-1.5">
            <Input
              value={cepDraft}
              onChange={(e) => setCepDraft(e.target.value)}
              onBlur={() => {
                if (cepDraft !== (value.zip ?? '')) {
                  patch({ zip: cepDraft });
                  void fetchViaCep(cepDraft);
                }
              }}
              placeholder="00000-000"
              disabled={disabled}
              inputMode="numeric"
              className="h-9 flex-1 text-xs"
            />
            {cepLoading && <Loader2 className="h-4 w-4 shrink-0 animate-spin self-center text-muted-foreground" />}
          </div>
        </SubField>
        <SubField label="País">
          <Input
            value={value.country ?? ''}
            onChange={(e) => patch({ country: e.target.value })}
            placeholder="Brasil"
            disabled={disabled}
            className="h-9 text-xs"
          />
        </SubField>
      </div>

      <SubField label="Logradouro / Rua">
        <Input
          value={value.line1 ?? ''}
          onChange={(e) => patch({ line1: e.target.value })}
          placeholder="Rua das Flores, 123"
          disabled={disabled}
          className="h-9 text-xs"
        />
      </SubField>

      <SubField label="Complemento / Bairro">
        <Input
          value={value.line2 ?? ''}
          onChange={(e) => patch({ line2: e.target.value })}
          placeholder="Apto 101, Centro"
          disabled={disabled}
          className="h-9 text-xs"
        />
      </SubField>

      <div className="grid grid-cols-2 gap-2">
        <SubField label="Cidade">
          <Input
            value={value.city ?? ''}
            onChange={(e) => patch({ city: e.target.value })}
            disabled={disabled}
            className="h-9 text-xs"
          />
        </SubField>
        <SubField label="Estado">
          <Input
            value={value.state ?? ''}
            onChange={(e) => patch({ state: e.target.value })}
            placeholder="SP"
            disabled={disabled}
            className="h-9 text-xs"
          />
        </SubField>
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!buildMapsQuery()}
        onClick={openMaps}
        className="self-start"
      >
        <MapPin className="mr-1.5 h-3.5 w-3.5" />
        Ver no mapa
      </Button>
    </div>
  );
}

function SubField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

function asString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function asAddressFull(v: unknown): AddressFullValue {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  return v as AddressFullValue;
}

function isValidUrl(s: string): boolean {
  if (!s) return false;
  try {
    new URL(s.startsWith('http') ? s : `https://${s}`);
    return true;
  } catch {
    return false;
  }
}

