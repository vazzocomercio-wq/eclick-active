'use client';

import { GripVertical, Trash2 } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type {
  FormField,
  FormFieldOption,
  FormFieldMapping,
  FormFieldType,
} from '@eclick-active/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  text: 'Texto curto',
  textarea: 'Texto longo',
  email: 'Email',
  phone: 'Telefone/WhatsApp',
  number: 'Número',
  currency: 'Valor (R$)',
  date: 'Data',
  select: 'Seleção (dropdown)',
  multi_select: 'Seleção múltipla',
  radio: 'Radio (escolha única)',
  checkbox: 'Checkbox',
  url: 'URL',
  cpf_cnpj: 'CPF/CNPJ',
  address: 'Endereço (com CEP)',
  file_upload: 'Upload de arquivo',
  heading: 'Título (visual)',
  divider: 'Divisor (visual)',
  paragraph: 'Parágrafo (visual)',
};

const HAS_OPTIONS: FormFieldType[] = [
  'select',
  'multi_select',
  'radio',
  'checkbox',
];

const VISUAL_ONLY: FormFieldType[] = ['heading', 'divider', 'paragraph'];

const MAPPING_LABELS: Record<FormFieldMapping, string> = {
  name: 'Nome do contato',
  email: 'Email',
  phone: 'Telefone',
  company: 'Empresa',
  value: 'Valor do deal',
  notes: 'Observações',
  custom: 'Custom (não mapear)',
};

interface Props {
  field: FormField;
  onChange: (field: FormField) => void;
  onRemove: () => void;
}

export function FieldEditor({ field, onChange, onRemove }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: field.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isVisual = VISUAL_ONLY.includes(field.type);
  const hasOptions = HAS_OPTIONS.includes(field.type);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex gap-2 rounded-md border border-border bg-card p-3',
        isDragging && 'shadow-lg',
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="flex h-6 cursor-grab items-center text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label="Arrastar"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div className="flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <select
            value={field.type}
            onChange={(e) =>
              onChange({
                ...field,
                type: e.target.value as FormFieldType,
                // Reset opções se o novo type não usar
                options: HAS_OPTIONS.includes(e.target.value as FormFieldType)
                  ? field.options ?? [{ value: 'opcao_1', label: 'Opção 1' }]
                  : undefined,
              })
            }
            className="rounded-md border border-border bg-background px-2 py-1 text-xs"
          >
            {Object.entries(FIELD_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>

          <select
            value={field.width}
            onChange={(e) =>
              onChange({ ...field, width: e.target.value as 'full' | 'half' })
            }
            className="rounded-md border border-border bg-background px-2 py-1 text-xs"
          >
            <option value="full">Largura total</option>
            <option value="half">Meia largura</option>
          </select>

          {!isVisual && (
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={field.required}
                onChange={(e) =>
                  onChange({ ...field, required: e.target.checked })
                }
                className="h-3 w-3"
              />
              Obrigatório
            </label>
          )}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-6 w-6 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onRemove}
            title="Remover campo"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">
              {field.type === 'heading'
                ? 'Título'
                : field.type === 'paragraph'
                  ? 'Texto do parágrafo'
                  : field.type === 'divider'
                    ? 'Rótulo (opcional)'
                    : 'Label'}
            </Label>
            <Input
              value={field.label}
              onChange={(e) => onChange({ ...field, label: e.target.value })}
              className="h-8"
            />
          </div>
          {!isVisual && (
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">
                Placeholder
              </Label>
              <Input
                value={field.placeholder ?? ''}
                onChange={(e) =>
                  onChange({ ...field, placeholder: e.target.value })
                }
                className="h-8"
              />
            </div>
          )}
        </div>

        {(field.type === 'heading' || field.type === 'paragraph') && (
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">
              Conteúdo (descrição)
            </Label>
            <textarea
              value={field.content ?? ''}
              onChange={(e) => onChange({ ...field, content: e.target.value })}
              rows={2}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
          </div>
        )}

        {!isVisual && (
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">
              Mapear pra contato/deal
            </Label>
            <select
              value={field.mapping ?? 'custom'}
              onChange={(e) =>
                onChange({
                  ...field,
                  mapping:
                    e.target.value === 'custom'
                      ? undefined
                      : (e.target.value as FormFieldMapping),
                })
              }
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
            >
              {Object.entries(MAPPING_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        )}

        {hasOptions && (
          <OptionsEditor
            options={field.options ?? []}
            onChange={(options) => onChange({ ...field, options })}
          />
        )}
      </div>
    </div>
  );
}

function OptionsEditor({
  options,
  onChange,
}: {
  options: FormFieldOption[];
  onChange: (opts: FormFieldOption[]) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] uppercase text-muted-foreground">
        Opções
      </Label>
      {options.map((opt, idx) => (
        <div key={idx} className="flex items-center gap-1">
          <Input
            value={opt.label}
            onChange={(e) => {
              const next = [...options];
              next[idx] = {
                ...next[idx],
                label: e.target.value,
                value: slugify(e.target.value),
              };
              onChange(next);
            }}
            placeholder="Rótulo"
            className="h-7 flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-destructive"
            onClick={() => onChange(options.filter((_, i) => i !== idx))}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={() =>
          onChange([
            ...options,
            { value: `opcao_${options.length + 1}`, label: `Opção ${options.length + 1}` },
          ])
        }
      >
        + Adicionar opção
      </Button>
    </div>
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/(^_|_$)/g, '')
    .slice(0, 60);
}
