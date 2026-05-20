'use client';

import { useTranslations } from 'next-intl';
import type { AppointmentCustomField } from '@eclick-active/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface CustomFieldsFormProps {
  schema: AppointmentCustomField[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  /** Quando true, mostra os campos mas desabilita edição. */
  readOnly?: boolean;
}

/**
 * Renderiza o formulário dinâmico baseado em
 * AppointmentType.custom_fields_schema. Cada field vira um Input/Select/etc.
 * Genérico — usado pelo NewAppointmentDialog (criação) e pode ser reusado
 * em telas de edição/visualização.
 */
export function CustomFieldsForm({
  schema,
  values,
  onChange,
  readOnly = false,
}: CustomFieldsFormProps) {
  const t = useTranslations('agenda');
  if (!schema || schema.length === 0) return null;

  function setValue(key: string, v: unknown) {
    onChange({ ...values, [key]: v });
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border/60 bg-muted/20 p-3">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t('customFields.title')}
      </span>
      {schema.map((field) => {
        const value = values[field.key];
        const labelEl = (
          <Label className="text-[11px]">
            {field.label}
            {field.required && <span className="ml-0.5 text-destructive">*</span>}
          </Label>
        );

        switch (field.type) {
          case 'text':
            return (
              <div key={field.key} className="flex flex-col gap-1">
                {labelEl}
                <Input
                  value={(value as string) ?? ''}
                  onChange={(e) => setValue(field.key, e.target.value)}
                  placeholder={field.placeholder ?? ''}
                  maxLength={field.max_length ?? 500}
                  disabled={readOnly}
                  className="h-9"
                />
                {field.help_text && (
                  <span className="text-[10px] text-muted-foreground">{field.help_text}</span>
                )}
              </div>
            );
          case 'textarea':
            return (
              <div key={field.key} className="flex flex-col gap-1">
                {labelEl}
                <Textarea
                  value={(value as string) ?? ''}
                  onChange={(e) => setValue(field.key, e.target.value)}
                  placeholder={field.placeholder ?? ''}
                  maxLength={field.max_length ?? 2000}
                  disabled={readOnly}
                  rows={3}
                />
                {field.help_text && (
                  <span className="text-[10px] text-muted-foreground">{field.help_text}</span>
                )}
              </div>
            );
          case 'number':
            return (
              <div key={field.key} className="flex flex-col gap-1">
                {labelEl}
                <Input
                  type="number"
                  value={(value as number | string) ?? ''}
                  onChange={(e) => {
                    const n = e.target.value;
                    setValue(field.key, n === '' ? '' : Number(n));
                  }}
                  placeholder={field.placeholder ?? ''}
                  min={field.min}
                  max={field.max}
                  disabled={readOnly}
                  className="h-9"
                />
                {field.help_text && (
                  <span className="text-[10px] text-muted-foreground">{field.help_text}</span>
                )}
              </div>
            );
          case 'select':
            return (
              <div key={field.key} className="flex flex-col gap-1">
                {labelEl}
                <select
                  value={(value as string) ?? ''}
                  onChange={(e) => setValue(field.key, e.target.value)}
                  disabled={readOnly}
                  className={cn(
                    'h-9 w-full rounded-md border border-input bg-background px-3 text-sm',
                    'focus:outline-none focus:ring-2 focus:ring-ring',
                    readOnly && 'opacity-60',
                  )}
                >
                  <option value="">{t('customFields.selectPlaceholder')}</option>
                  {(field.options ?? []).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
                {field.help_text && (
                  <span className="text-[10px] text-muted-foreground">{field.help_text}</span>
                )}
              </div>
            );
          case 'date':
            return (
              <div key={field.key} className="flex flex-col gap-1">
                {labelEl}
                <Input
                  type="date"
                  value={(value as string) ?? ''}
                  onChange={(e) => setValue(field.key, e.target.value)}
                  disabled={readOnly}
                  className="h-9"
                />
                {field.help_text && (
                  <span className="text-[10px] text-muted-foreground">{field.help_text}</span>
                )}
              </div>
            );
          case 'boolean':
            return (
              <div key={field.key} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  id={`cf-${field.key}`}
                  checked={Boolean(value)}
                  onChange={(e) => setValue(field.key, e.target.checked)}
                  disabled={readOnly}
                  className="mt-0.5 h-4 w-4 rounded border-input"
                />
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor={`cf-${field.key}`} className="text-[11px] cursor-pointer">
                    {field.label}
                    {field.required && <span className="ml-0.5 text-destructive">*</span>}
                  </Label>
                  {field.help_text && (
                    <span className="text-[10px] text-muted-foreground">{field.help_text}</span>
                  )}
                </div>
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
