'use client';

import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type {
  AppointmentCustomField,
  AppointmentCustomFieldType,
} from '@eclick-active/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface CustomFieldsSchemaEditorProps {
  schema: AppointmentCustomField[];
  onChange: (next: AppointmentCustomField[]) => void;
}

const FIELD_TYPES: { value: AppointmentCustomFieldType; label: string }[] = [
  { value: 'text', label: 'Texto curto' },
  { value: 'textarea', label: 'Texto longo' },
  { value: 'number', label: 'Número' },
  { value: 'select', label: 'Seleção (lista)' },
  { value: 'date', label: 'Data' },
  { value: 'boolean', label: 'Sim/Não' },
];

/**
 * Editor visual do `appointment_type.custom_fields_schema`. Permite:
 *   - Adicionar / remover fields
 *   - Reordenar via setas ↑ ↓
 *   - Editar key (snake_case auto), label, type, required
 *   - Pra type='select', editar lista de opções
 *   - Pra type='number', editar min/max
 *   - Pra type='text'/'textarea', editar max_length
 *   - Editar placeholder + help_text
 *
 * Genérico por nicho — mesma UI serve clínica, salão, oficina, B2B.
 */
export function CustomFieldsSchemaEditor({
  schema,
  onChange,
}: CustomFieldsSchemaEditorProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  function addField() {
    const idx = schema.length + 1;
    const baseKey = `campo_${idx}`;
    let key = baseKey;
    let n = idx;
    while (schema.some((f) => f.key === key)) {
      n++;
      key = `campo_${n}`;
    }
    const novo: AppointmentCustomField = {
      key,
      label: `Campo ${idx}`,
      type: 'text',
      required: false,
    };
    onChange([...schema, novo]);
    setExpandedKey(key);
  }

  function updateField(i: number, patch: Partial<AppointmentCustomField>) {
    const next = schema.slice();
    const cur = next[i];
    if (!cur) return;
    next[i] = { ...cur, ...patch };
    onChange(next);
  }

  function removeField(i: number) {
    const next = schema.slice();
    next.splice(i, 1);
    onChange(next);
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= schema.length) return;
    const next = schema.slice();
    const a = next[i];
    const b = next[j];
    if (!a || !b) return;
    next[i] = b;
    next[j] = a;
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2">
      {schema.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
          Nenhum campo personalizado configurado. Clique em "Adicionar campo" pra
          coletar info extra ao agendar (peso, marca/modelo do veículo, convênio, etc.).
        </div>
      ) : (
        schema.map((field, i) => (
          <FieldRow
            key={field.key}
            field={field}
            index={i}
            total={schema.length}
            expanded={expandedKey === field.key}
            onToggle={() =>
              setExpandedKey(expandedKey === field.key ? null : field.key)
            }
            onChange={(patch) => updateField(i, patch)}
            onRemove={() => removeField(i)}
            onMoveUp={() => move(i, -1)}
            onMoveDown={() => move(i, 1)}
          />
        ))
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addField}
        className="self-start"
      >
        <Plus className="mr-1 h-3.5 w-3.5" />
        Adicionar campo
      </Button>
    </div>
  );
}

function FieldRow({
  field,
  index,
  total,
  expanded,
  onToggle,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  field: AppointmentCustomField;
  index: number;
  total: number;
  expanded: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<AppointmentCustomField>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <div className="rounded-md border border-border bg-card">
      {/* Linha colapsada */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex flex-col">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-5 w-5 p-0"
            onClick={onMoveUp}
            disabled={index === 0}
          >
            <ArrowUp className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-5 w-5 p-0"
            onClick={onMoveDown}
            disabled={index === total - 1}
          >
            <ArrowDown className="h-3 w-3" />
          </Button>
        </div>

        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 flex-col items-start gap-0.5 text-left"
        >
          <span className="text-sm font-medium">
            {field.label || '(sem label)'}
            {field.required && <span className="ml-1 text-destructive">*</span>}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {FIELD_TYPES.find((t) => t.value === field.type)?.label ?? field.type} ·{' '}
            <code className="font-mono">{field.key}</code>
          </span>
        </button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onRemove}
          aria-label="Remover campo"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Linha expandida (config detalhada) */}
      {expanded && (
        <div className="flex flex-col gap-2.5 border-t border-border/60 p-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label className="text-[11px]">Label (rótulo) *</Label>
              <Input
                value={field.label}
                onChange={(e) => onChange({ label: e.target.value })}
                placeholder="Ex: Peso (kg)"
                maxLength={80}
                className="h-8"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[11px]">Key (chave estável) *</Label>
              <Input
                value={field.key}
                onChange={(e) =>
                  onChange({
                    key: e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9_]+/g, '_')
                      .replace(/^_+|_+$/g, '')
                      .slice(0, 64),
                  })
                }
                placeholder="ex: peso_kg"
                className="h-8 font-mono text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label className="text-[11px]">Tipo *</Label>
              <select
                value={field.type}
                onChange={(e) =>
                  onChange({ type: e.target.value as AppointmentCustomFieldType })
                }
                className={cn(
                  'h-8 w-full rounded-md border border-input bg-background px-2 text-xs',
                  'focus:outline-none focus:ring-2 focus:ring-ring',
                )}
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-1.5 pb-1">
              <input
                type="checkbox"
                id={`required-${field.key}`}
                checked={field.required}
                onChange={(e) => onChange({ required: e.target.checked })}
                className="h-4 w-4 rounded border-input"
              />
              <Label
                htmlFor={`required-${field.key}`}
                className="text-[11px] cursor-pointer"
              >
                Obrigatório
              </Label>
            </div>
          </div>

          {/* Type-specific options */}
          {field.type === 'select' && (
            <div className="flex flex-col gap-1">
              <Label className="text-[11px]">Opções (uma por linha)</Label>
              <textarea
                value={(field.options ?? []).join('\n')}
                onChange={(e) =>
                  onChange({
                    options: e.target.value
                      .split('\n')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="Particular&#10;Unimed&#10;Bradesco&#10;Outros"
                rows={4}
                className="rounded-md border border-input bg-background p-2 text-xs"
              />
              <span className="text-[10px] text-muted-foreground">
                {(field.options ?? []).length} opção(ões)
              </span>
            </div>
          )}

          {field.type === 'number' && (
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <Label className="text-[11px]">Mín.</Label>
                <Input
                  type="number"
                  value={field.min ?? ''}
                  onChange={(e) =>
                    onChange({
                      min: e.target.value === '' ? undefined : Number(e.target.value),
                    })
                  }
                  className="h-8"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[11px]">Máx.</Label>
                <Input
                  type="number"
                  value={field.max ?? ''}
                  onChange={(e) =>
                    onChange({
                      max: e.target.value === '' ? undefined : Number(e.target.value),
                    })
                  }
                  className="h-8"
                />
              </div>
            </div>
          )}

          {(field.type === 'text' || field.type === 'textarea') && (
            <div className="flex flex-col gap-1">
              <Label className="text-[11px]">Tamanho máx (chars)</Label>
              <Input
                type="number"
                value={field.max_length ?? ''}
                onChange={(e) =>
                  onChange({
                    max_length:
                      e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
                placeholder={field.type === 'textarea' ? '2000' : '500'}
                min={1}
                max={10000}
                className="h-8"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label className="text-[11px]">Placeholder</Label>
              <Input
                value={field.placeholder ?? ''}
                onChange={(e) =>
                  onChange({ placeholder: e.target.value || undefined })
                }
                maxLength={200}
                className="h-8"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[11px]">Texto de ajuda</Label>
              <Input
                value={field.help_text ?? ''}
                onChange={(e) => onChange({ help_text: e.target.value || undefined })}
                maxLength={500}
                className="h-8"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
