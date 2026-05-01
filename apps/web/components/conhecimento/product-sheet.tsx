'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, X } from 'lucide-react';
import type { ProductCatalogItem } from '@eclick-active/shared';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  knowledgeApi,
  type CreateProductInput,
  type UpdateProductInput,
} from '@/lib/api/knowledge';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface ProductSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Se passado, modo edição. Se null/undefined, modo criação. */
  product: ProductCatalogItem | null;
  onChanged: () => void;
}

interface FormState {
  name: string;
  sku: string;
  description: string;
  price: string;
  category: string;
  is_active: boolean;
  attributes: Array<{ key: string; value: string }>;
}

const EMPTY_FORM: FormState = {
  name: '',
  sku: '',
  description: '',
  price: '',
  category: '',
  is_active: true,
  attributes: [],
};

export function ProductSheet({
  open,
  onOpenChange,
  product,
  onChanged,
}: ProductSheetProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isEdit = product !== null;

  useEffect(() => {
    if (!open) return;
    if (product) {
      setForm({
        name: product.name,
        sku: product.sku ?? '',
        description: product.description ?? '',
        price: product.price?.toString() ?? '',
        category: product.category ?? '',
        is_active: product.is_active,
        attributes: Object.entries(product.attributes ?? {}).map(([key, value]) => ({
          key,
          value: typeof value === 'string' ? value : JSON.stringify(value),
        })),
      });
    } else {
      setForm(EMPTY_FORM);
    }
    setError(null);
    setConfirmDelete(false);
  }, [open, product]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    setError(null);

    const attrs: Record<string, unknown> = {};
    for (const a of form.attributes) {
      if (a.key.trim()) attrs[a.key.trim()] = a.value;
    }

    const dto: CreateProductInput | UpdateProductInput = {
      name: form.name.trim(),
      ...(form.sku.trim() ? { sku: form.sku.trim() } : {}),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      ...(form.price.trim() ? { price: Number(form.price.replace(',', '.')) } : {}),
      ...(form.category.trim() ? { category: form.category.trim() } : {}),
      attributes: attrs,
      is_active: form.is_active,
    };

    try {
      if (product) {
        await knowledgeApi.updateProduct(product.id, dto);
      } else {
        await knowledgeApi.createProduct(dto as CreateProductInput);
      }
      onChanged();
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao salvar',
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!product) return;
    setDeleting(true);
    setError(null);
    try {
      await knowledgeApi.removeProduct(product.id);
      onChanged();
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Erro ao excluir',
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !saving && !deleting && onOpenChange(o)}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-xl" side="right">
        <SheetHeader className="border-b border-border pb-4">
          <SheetTitle>{isEdit ? 'Editar produto' : 'Novo produto'}</SheetTitle>
          <SheetDescription>
            {isEdit ? 'Altere e salve. A IA usa esses dados em respostas.' : 'Cadastre produtos do seu catálogo.'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-4">
          {error && (
            <div className="mb-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Nome" required className="sm:col-span-2">
              <Input
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder="Ex: Plano Premium"
                autoFocus
              />
            </Field>

            <Field label="SKU">
              <Input
                value={form.sku}
                onChange={(e) => setField('sku', e.target.value)}
                placeholder="PLAN-PREM-01"
              />
            </Field>

            <Field label="Categoria">
              <Input
                value={form.category}
                onChange={(e) => setField('category', e.target.value)}
                placeholder="Ex: assinatura"
              />
            </Field>

            <Field label="Preço (R$)" className="sm:col-span-2">
              <Input
                value={form.price}
                onChange={(e) => setField('price', e.target.value)}
                inputMode="decimal"
                placeholder="0,00"
              />
            </Field>

            <Field label="Descrição" className="sm:col-span-2">
              <Textarea
                value={form.description}
                onChange={(e) => setField('description', e.target.value)}
                rows={3}
                placeholder="Detalhes do produto, diferenciais..."
              />
            </Field>

            <div className="flex flex-col gap-2 sm:col-span-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Atributos personalizados</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 text-xs"
                  onClick={() =>
                    setField('attributes', [...form.attributes, { key: '', value: '' }])
                  }
                >
                  <Plus className="h-3 w-3" />
                  Adicionar
                </Button>
              </div>

              {form.attributes.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  Ex: cor, tamanho, peso, garantia. Útil pra IA responder dúvidas específicas.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {form.attributes.map((attr, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <Input
                        value={attr.key}
                        onChange={(e) => {
                          const next = [...form.attributes];
                          next[i] = { ...next[i]!, key: e.target.value };
                          setField('attributes', next);
                        }}
                        placeholder="chave"
                        className="h-8 text-xs"
                      />
                      <Input
                        value={attr.value}
                        onChange={(e) => {
                          const next = [...form.attributes];
                          next[i] = { ...next[i]!, value: e.target.value };
                          setField('attributes', next);
                        }}
                        placeholder="valor"
                        className="h-8 text-xs"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          setField(
                            'attributes',
                            form.attributes.filter((_, j) => j !== i),
                          )
                        }
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-2 flex items-center gap-2 sm:col-span-2">
              <input
                id="prod-active"
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setField('is_active', e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="prod-active" className="cursor-pointer text-xs">
                Ativo
              </Label>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
          {isEdit && product ? (
            confirmDelete ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-destructive">Excluir?</span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  Sim
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Não
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                Excluir
              </Button>
            )
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {saving ? 'Salvando...' : isEdit ? 'Salvar' : 'Criar produto'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label className="text-xs">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
    </div>
  );
}
