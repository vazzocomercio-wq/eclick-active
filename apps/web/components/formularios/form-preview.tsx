'use client';

import type { FormField, FormBranding } from '@eclick-active/shared';
import { cn } from '@/lib/utils';

interface Props {
  fields: FormField[];
  branding: FormBranding;
  formName: string;
  description: string | null;
}

/**
 * Preview-only render do form. Não submete nada.
 */
export function FormPreview({ fields, branding, formName, description }: Props) {
  const sorted = [...fields].sort((a, b) => a.position - b.position);
  const primary = branding.primary_color ?? '#00E5FF';

  return (
    <div
      className="min-h-full rounded-lg border border-border p-6"
      style={{
        backgroundColor: branding.background_color ?? 'transparent',
        fontFamily: branding.font_family,
      }}
    >
      {branding.logo_url && (
        <img
          src={branding.logo_url}
          alt="Logo"
          className="mb-4 max-h-16"
        />
      )}
      {branding.header_text && (
        <p className="mb-2 text-xs text-muted-foreground">
          {branding.header_text}
        </p>
      )}
      <h2 className="mb-1 text-xl font-semibold">{formName}</h2>
      {description && (
        <p className="mb-4 text-sm text-muted-foreground">{description}</p>
      )}

      <div className="grid grid-cols-2 gap-3">
        {sorted.map((f) => (
          <FieldPreview key={f.id} field={f} primary={primary} />
        ))}
      </div>

      <button
        type="button"
        disabled
        className="mt-5 w-full rounded-md px-4 py-2.5 text-sm font-semibold text-background"
        style={{ backgroundColor: primary }}
      >
        Enviar
      </button>

      {branding.show_powered_by && (
        <p className="mt-4 text-center text-[10px] text-muted-foreground">
          Powered by e-Click Active
        </p>
      )}
      {branding.footer_text && (
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          {branding.footer_text}
        </p>
      )}
    </div>
  );
}

function FieldPreview({
  field,
  primary,
}: {
  field: FormField;
  primary: string;
}) {
  const colSpan = field.width === 'half' ? 'col-span-1' : 'col-span-2';

  if (field.type === 'heading') {
    return (
      <div className={colSpan}>
        <h3 className="mt-1 text-base font-semibold">{field.label}</h3>
        {field.content && (
          <p className="text-xs text-muted-foreground">{field.content}</p>
        )}
      </div>
    );
  }

  if (field.type === 'paragraph') {
    return (
      <div className={colSpan}>
        <p className="text-xs text-muted-foreground">
          {field.content ?? field.label}
        </p>
      </div>
    );
  }

  if (field.type === 'divider') {
    return (
      <div className={cn(colSpan, 'my-1')}>
        <div className="border-t border-border" />
        {field.label && (
          <p className="mt-1 text-center text-[10px] text-muted-foreground">
            {field.label}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={colSpan}>
      <label className="mb-1 block text-xs font-medium">
        {field.label}
        {field.required && (
          <span className="ml-0.5" style={{ color: primary }}>
            *
          </span>
        )}
      </label>
      {renderInput(field)}
    </div>
  );
}

function renderInput(field: FormField) {
  const cls =
    'h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm';

  switch (field.type) {
    case 'textarea':
      return (
        <textarea
          rows={3}
          placeholder={field.placeholder}
          className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-sm"
          disabled
        />
      );
    case 'select':
      return (
        <select className={cls} disabled>
          <option>Selecione...</option>
          {field.options?.map((o) => (
            <option key={o.value}>{o.label}</option>
          ))}
        </select>
      );
    case 'multi_select':
      return (
        <select multiple className={cls + ' h-20'} disabled>
          {field.options?.map((o) => (
            <option key={o.value}>{o.label}</option>
          ))}
        </select>
      );
    case 'radio':
      return (
        <div className="flex flex-wrap gap-2">
          {field.options?.map((o) => (
            <label key={o.value} className="flex items-center gap-1 text-xs">
              <input type="radio" disabled />
              {o.label}
            </label>
          ))}
        </div>
      );
    case 'checkbox':
      return (
        <div className="flex flex-wrap gap-2">
          {field.options?.map((o) => (
            <label key={o.value} className="flex items-center gap-1 text-xs">
              <input type="checkbox" disabled />
              {o.label}
            </label>
          ))}
        </div>
      );
    case 'address':
      return (
        <div className="space-y-1.5">
          <input
            placeholder="CEP"
            className={cls}
            disabled
          />
          <input
            placeholder="Endereço (preenchido automaticamente)"
            className={cls}
            disabled
          />
        </div>
      );
    case 'file_upload':
      return (
        <input
          type="file"
          disabled
          className="block w-full text-xs"
        />
      );
    default:
      return (
        <input
          type={
            field.type === 'email'
              ? 'email'
              : field.type === 'date'
                ? 'date'
                : field.type === 'number' || field.type === 'currency'
                  ? 'number'
                  : 'text'
          }
          placeholder={field.placeholder}
          className={cls}
          disabled
        />
      );
  }
}
