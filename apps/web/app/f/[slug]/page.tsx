'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { FormPublic, FormField } from '@eclick-active/shared';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function PublicFormPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const searchParams = useSearchParams();
  const [form, setForm] = useState<FormPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string>('');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Carrega form
  useEffect(() => {
    let aborted = false;
    setLoading(true);
    fetch(`${API_URL}/public/forms/${encodeURIComponent(slug)}`)
      .then(async (r) => {
        if (!r.ok) {
          const text = await r.text().catch(() => '');
          throw new Error(
            r.status === 404
              ? 'Formulário não encontrado ou indisponível.'
              : text || `Erro ${r.status}`,
          );
        }
        return (await r.json()) as FormPublic;
      })
      .then((f) => {
        if (!aborted) setForm(f);
      })
      .catch((err: unknown) => {
        if (!aborted) {
          setError(err instanceof Error ? err.message : 'Erro ao carregar');
        }
      })
      .finally(() => {
        if (!aborted) setLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, [slug]);

  const utm = useMemo(
    () => ({
      utm_source: searchParams.get('utm_source') ?? undefined,
      utm_medium: searchParams.get('utm_medium') ?? undefined,
      utm_campaign: searchParams.get('utm_campaign') ?? undefined,
      utm_content: searchParams.get('utm_content') ?? undefined,
      utm_term: searchParams.get('utm_term') ?? undefined,
    }),
    [searchParams],
  );

  function setVal(id: string, v: unknown) {
    setValues((curr) => ({ ...curr, [id]: v }));
    setFieldErrors((curr) => {
      const { [id]: _ignored, ...rest } = curr;
      void _ignored;
      return rest;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;

    // Validação client-side
    const errs: Record<string, string> = {};
    for (const f of form.fields) {
      if (
        f.required &&
        f.type !== 'heading' &&
        f.type !== 'divider' &&
        f.type !== 'paragraph'
      ) {
        const v = values[f.id];
        const empty =
          v === undefined ||
          v === null ||
          v === '' ||
          (Array.isArray(v) && v.length === 0);
        if (empty) errs[f.id] = 'Campo obrigatório';
      }
      if (f.type === 'email') {
        const v = values[f.id];
        if (typeof v === 'string' && v && !/^\S+@\S+\.\S+$/.test(v)) {
          errs[f.id] = 'Email inválido';
        }
      }
    }
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(
        `${API_URL}/public/forms/${encodeURIComponent(slug)}/submit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data: values,
            source: 'link',
            ...utm,
          }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `Erro ${res.status}`);
      }
      const body = (await res.json()) as {
        success: true;
        submission_id: string;
        redirect_url?: string;
        success_message?: string;
      };
      if (body.redirect_url) {
        window.location.href = body.redirect_url;
        return;
      }
      setSuccessMsg(
        body.success_message ??
          form.success_message ??
          'Recebemos seu cadastro! Em breve um especialista vai entrar em contato.',
      );
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100 dark:bg-zinc-950">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (error && !form) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100 px-4 dark:bg-zinc-950">
        <div className="rounded-lg border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">{error}</p>
        </div>
      </div>
    );
  }

  if (!form) return null;

  const primary = form.branding.primary_color ?? '#00E5FF';

  if (success) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center px-4"
        style={{
          backgroundColor: form.branding.background_color ?? undefined,
          fontFamily: form.branding.font_family,
        }}
      >
        <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <CheckCircle2
            className="mx-auto mb-3 h-12 w-12"
            style={{ color: primary }}
          />
          <h2 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Tudo certo!
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {successMsg}
          </p>
        </div>
        {form.branding.show_powered_by && (
          <p className="mt-4 text-xs text-zinc-500">
            Powered by e-Click Active
          </p>
        )}
      </div>
    );
  }

  const sortedFields = [...form.fields].sort(
    (a, b) => a.position - b.position,
  );

  return (
    <div
      className="min-h-screen px-4 py-8"
      style={{
        backgroundColor: form.branding.background_color ?? undefined,
        fontFamily: form.branding.font_family,
      }}
    >
      <form
        onSubmit={submit}
        className="mx-auto max-w-xl rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        {form.branding.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={form.branding.logo_url}
            alt="Logo"
            className="mx-auto mb-4 max-h-16"
          />
        )}
        {form.branding.header_text && (
          <p className="mb-2 text-center text-xs text-zinc-500">
            {form.branding.header_text}
          </p>
        )}
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          {form.name}
        </h1>
        {form.description && (
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {form.description}
          </p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3">
          {sortedFields.map((f) => (
            <PublicField
              key={f.id}
              field={f}
              value={values[f.id]}
              onChange={(v) => setVal(f.id, v)}
              error={fieldErrors[f.id]}
              primary={primary}
            />
          ))}
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-5 w-full rounded-md px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          style={{ backgroundColor: primary }}
        >
          {submitting ? 'Enviando...' : 'Enviar'}
        </button>

        {form.branding.footer_text && (
          <p className="mt-3 text-center text-xs text-zinc-500">
            {form.branding.footer_text}
          </p>
        )}
        {form.branding.show_powered_by && (
          <p className="mt-2 text-center text-[10px] text-zinc-400">
            Powered by e-Click Active
          </p>
        )}
      </form>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Field renderer (com máscaras BR + ViaCEP)
// ────────────────────────────────────────────────────────────

interface FieldProps {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: string;
  primary: string;
}

function PublicField({ field, value, onChange, error, primary }: FieldProps) {
  const colSpan = field.width === 'half' ? 'col-span-2 sm:col-span-1' : 'col-span-2';

  if (field.type === 'heading') {
    return (
      <div className={colSpan}>
        <h3 className="mt-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {field.label}
        </h3>
        {field.content && (
          <p className="text-xs text-zinc-500">{field.content}</p>
        )}
      </div>
    );
  }

  if (field.type === 'paragraph') {
    return (
      <div className={colSpan}>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          {field.content ?? field.label}
        </p>
      </div>
    );
  }

  if (field.type === 'divider') {
    return (
      <div className={cn(colSpan, 'my-1')}>
        <div className="border-t border-zinc-200 dark:border-zinc-800" />
        {field.label && (
          <p className="mt-1 text-center text-[10px] text-zinc-400">
            {field.label}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={colSpan}>
      <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
        {field.label}
        {field.required && (
          <span className="ml-0.5" style={{ color: primary }}>
            *
          </span>
        )}
      </label>
      <FieldInput field={field} value={value} onChange={onChange} />
      {error && (
        <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const inputCls =
    'h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none transition-colors focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-500';

  switch (field.type) {
    case 'textarea':
      return (
        <textarea
          rows={4}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        />
      );
    case 'phone':
      return (
        <input
          type="tel"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(maskPhone(e.target.value))}
          placeholder={field.placeholder ?? '(11) 99999-9999'}
          className={inputCls}
          inputMode="tel"
        />
      );
    case 'cpf_cnpj':
      return (
        <input
          type="text"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(maskCpfCnpj(e.target.value))}
          placeholder={field.placeholder ?? '000.000.000-00'}
          className={inputCls}
          inputMode="numeric"
        />
      );
    case 'currency':
      return (
        <input
          type="text"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(maskCurrency(e.target.value))}
          placeholder={field.placeholder ?? 'R$ 0,00'}
          className={inputCls}
          inputMode="decimal"
        />
      );
    case 'email':
      return (
        <input
          type="email"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className={inputCls}
          autoComplete="email"
        />
      );
    case 'url':
      return (
        <input
          type="url"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className={inputCls}
        />
      );
    case 'number':
      return (
        <input
          type="number"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className={inputCls}
          inputMode="numeric"
        />
      );
    case 'date':
      return (
        <input
          type="date"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        />
      );
    case 'select':
      return (
        <select
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        >
          <option value="">Selecione...</option>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case 'multi_select':
    case 'checkbox': {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-2">
          {field.options?.map((o) => {
            const checked = arr.includes(o.value);
            return (
              <label
                key={o.value}
                className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...arr, o.value]
                      : arr.filter((v) => v !== o.value);
                    onChange(next);
                  }}
                />
                {o.label}
              </label>
            );
          })}
        </div>
      );
    }
    case 'radio':
      return (
        <div className="flex flex-wrap gap-3">
          {field.options?.map((o) => (
            <label
              key={o.value}
              className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300"
            >
              <input
                type="radio"
                name={field.id}
                value={o.value}
                checked={(value as string) === o.value}
                onChange={(e) => onChange(e.target.value)}
              />
              {o.label}
            </label>
          ))}
        </div>
      );
    case 'address':
      return <AddressField value={value} onChange={onChange} />;
    case 'file_upload':
      return (
        <input
          type="file"
          onChange={(e) => {
            // Por enquanto só nome do arquivo (storage real fica pra próximo bloco)
            const file = e.target.files?.[0];
            onChange(file ? file.name : '');
          }}
          className="block w-full text-sm text-zinc-700 dark:text-zinc-300"
        />
      );
    default:
      return (
        <input
          type="text"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className={inputCls}
        />
      );
  }
}

// ────────────────────────────────────────────────────────────
// Address with ViaCEP
// ────────────────────────────────────────────────────────────

interface AddressValue {
  cep?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
}

function AddressField({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const v = (value as AddressValue) ?? {};
  const [loading, setLoading] = useState(false);

  function patch(p: Partial<AddressValue>) {
    onChange({ ...v, ...p });
  }

  async function lookupCep(cep: string) {
    const onlyDigits = cep.replace(/\D/g, '');
    if (onlyDigits.length !== 8) return;
    setLoading(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${onlyDigits}/json/`);
      if (!r.ok) return;
      const data = (await r.json()) as {
        logradouro?: string;
        bairro?: string;
        localidade?: string;
        uf?: string;
        erro?: boolean;
      };
      if (!data.erro) {
        patch({
          cep: maskCep(onlyDigits),
          street: data.logradouro,
          neighborhood: data.bairro,
          city: data.localidade,
          state: data.uf,
        });
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  const inputCls =
    'h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100';

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="col-span-2 flex gap-2">
        <input
          type="text"
          value={v.cep ?? ''}
          onChange={(e) => patch({ cep: maskCep(e.target.value) })}
          onBlur={(e) => lookupCep(e.target.value)}
          placeholder="CEP"
          inputMode="numeric"
          className={cn(inputCls, 'max-w-[140px]')}
        />
        {loading && (
          <Loader2 className="m-auto h-4 w-4 animate-spin text-zinc-400" />
        )}
      </div>
      <input
        type="text"
        value={v.street ?? ''}
        onChange={(e) => patch({ street: e.target.value })}
        placeholder="Endereço"
        className={cn(inputCls, 'col-span-2')}
      />
      <input
        type="text"
        value={v.number ?? ''}
        onChange={(e) => patch({ number: e.target.value })}
        placeholder="Nº"
        className={inputCls}
      />
      <input
        type="text"
        value={v.complement ?? ''}
        onChange={(e) => patch({ complement: e.target.value })}
        placeholder="Complemento"
        className={inputCls}
      />
      <input
        type="text"
        value={v.neighborhood ?? ''}
        onChange={(e) => patch({ neighborhood: e.target.value })}
        placeholder="Bairro"
        className={inputCls}
      />
      <input
        type="text"
        value={v.city ?? ''}
        onChange={(e) => patch({ city: e.target.value })}
        placeholder="Cidade"
        className={inputCls}
      />
      <input
        type="text"
        value={v.state ?? ''}
        onChange={(e) => patch({ state: e.target.value.toUpperCase() })}
        placeholder="UF"
        maxLength={2}
        className={cn(inputCls, 'col-span-2 max-w-[80px]')}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Masks
// ────────────────────────────────────────────────────────────

function maskPhone(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length === 0 ? '' : `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  }
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function maskCpfCnpj(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11) {
    // CPF: 000.000.000-00
    return d
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  // CNPJ: 00.000.000/0000-00
  return d
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

function maskCurrency(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (!d) return '';
  const num = Number(d) / 100;
  return num.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function maskCep(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}
