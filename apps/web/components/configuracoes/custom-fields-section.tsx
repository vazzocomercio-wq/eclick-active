'use client';

import { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Folder,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  CustomFieldDefinition,
  CustomFieldEntityType,
  CustomFieldGroup,
  CustomFieldOption,
  CustomFieldType,
} from '@eclick-active/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  customFieldsApi,
  type CreateCustomFieldInput,
  type CreateGroupInput,
} from '@/lib/api/custom-fields';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const ENTITIES: { value: CustomFieldEntityType; label: string }[] = [
  { value: 'deal', label: 'Negócios' },
  { value: 'contact', label: 'Contatos' },
  { value: 'company', label: 'Empresas' },
];

const FIELD_TYPE_OPTIONS: { value: CustomFieldType; label: string }[] = [
  { value: 'text', label: 'Texto curto' },
  { value: 'textarea', label: 'Texto longo' },
  { value: 'number', label: 'Número' },
  { value: 'date', label: 'Data' },
  { value: 'select', label: 'Seleção única' },
  { value: 'multi_select', label: 'Múltipla seleção' },
  { value: 'radio', label: 'Radio' },
  { value: 'checkbox', label: 'Checkbox simples' },
  { value: 'toggle', label: 'Switch (ligado/desligado)' },
  { value: 'url', label: 'URL' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Telefone' },
  { value: 'address_short', label: 'Endereço (linha única)' },
  { value: 'address_full', label: 'Endereço completo' },
];

const TYPES_REQUIRING_OPTIONS: CustomFieldType[] = [
  'select',
  'multi_select',
  'radio',
];

export function CustomFieldsAdminSection() {
  const [tab, setTab] = useState<CustomFieldEntityType>('deal');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Campos personalizados</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={(v) => setTab(v as CustomFieldEntityType)}>
          <TabsList>
            {ENTITIES.map((e) => (
              <TabsTrigger key={e.value} value={e.value}>
                {e.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {ENTITIES.map((e) => (
            <TabsContent key={e.value} value={e.value} className="pt-4">
              <EntityAdmin entityType={e.value} />
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────
// Por entidade
// ──────────────────────────────────────────────────────────

function EntityAdmin({ entityType }: { entityType: CustomFieldEntityType }) {
  const [groups, setGroups] = useState<CustomFieldGroup[]>([]);
  const [defs, setDefs] = useState<CustomFieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialogs
  const [groupDialog, setGroupDialog] = useState<{
    open: boolean;
    editing: CustomFieldGroup | null;
  }>({ open: false, editing: null });
  const [fieldDialog, setFieldDialog] = useState<{
    open: boolean;
    groupId: string | null;
    editing: CustomFieldDefinition | null;
  }>({ open: false, groupId: null, editing: null });

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const [g, d] = await Promise.all([
        customFieldsApi.listGroups(entityType),
        customFieldsApi.list(entityType),
      ]);
      setGroups(g);
      setDefs(d);
    } catch (err) {
      setError(extractMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType]);

  // Reorder helpers
  async function moveGroup(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= groups.length) return;
    const next = [...groups];
    const [moved] = next.splice(idx, 1);
    if (moved !== undefined) next.splice(target, 0, moved);
    setGroups(next);
    try {
      await customFieldsApi.reorderGroups(entityType, next.map((g) => g.id));
    } catch (err) {
      toast.error('Falha ao reordenar grupo', { description: extractMessage(err) });
      void reload();
    }
  }

  async function moveField(groupId: string | null, idx: number, dir: -1 | 1) {
    const fieldsInGroup = defs.filter((d) => (d.group_id ?? null) === groupId);
    const target = idx + dir;
    if (target < 0 || target >= fieldsInGroup.length) return;

    const reordered = [...fieldsInGroup];
    const [moved] = reordered.splice(idx, 1);
    if (moved !== undefined) reordered.splice(target, 0, moved);

    // Reconstrói o array global mantendo ordem dos outros grupos
    const others = defs.filter((d) => (d.group_id ?? null) !== groupId);
    const merged = [...others, ...reordered];
    setDefs(merged);

    try {
      // Backend reorder atribui position por índice no array passado.
      // Como temos múltiplos grupos, persistimos o reorder relativo ao
      // grupo: pega todos os fields da entidade na ordem atual + reordered.
      const orderedIds = mergedOrderForReorder(defs, groupId, reordered);
      await customFieldsApi.reorder(entityType, orderedIds);
    } catch (err) {
      toast.error('Falha ao reordenar campo', { description: extractMessage(err) });
      void reload();
    }
  }

  async function deleteGroup(g: CustomFieldGroup) {
    if (!window.confirm(`Excluir grupo "${g.name}"? Os campos voltam pra "Sem grupo".`)) {
      return;
    }
    try {
      await customFieldsApi.removeGroup(g.id);
      toast.success('Grupo excluído');
      void reload();
    } catch (err) {
      toast.error('Falha ao excluir grupo', { description: extractMessage(err) });
    }
  }

  async function deleteField(d: CustomFieldDefinition) {
    if (
      !window.confirm(
        `Excluir campo "${d.name}"? Valores existentes nos registros ficam órfãos no jsonb.`,
      )
    ) {
      return;
    }
    try {
      await customFieldsApi.remove(d.id);
      toast.success('Campo excluído');
      void reload();
    } catch (err) {
      toast.error('Falha ao excluir', { description: extractMessage(err) });
    }
  }

  // Render
  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        {error}
      </div>
    );
  }

  const fieldsByGroup = groupBy(defs, (d) => d.group_id ?? '__none__');

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {groups.length} grupo(s) · {defs.length} campo(s)
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setGroupDialog({ open: true, editing: null })}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Novo grupo
        </Button>
      </div>

      {/* Grupos cadastrados */}
      {groups.map((g, gIdx) => {
        const fields = fieldsByGroup.get(g.id) ?? [];
        return (
          <GroupBlock
            key={g.id}
            group={g}
            fields={fields}
            isFirst={gIdx === 0}
            isLast={gIdx === groups.length - 1}
            onMoveUp={() => void moveGroup(gIdx, -1)}
            onMoveDown={() => void moveGroup(gIdx, 1)}
            onEdit={() => setGroupDialog({ open: true, editing: g })}
            onDelete={() => void deleteGroup(g)}
            onAddField={() =>
              setFieldDialog({ open: true, groupId: g.id, editing: null })
            }
            onMoveField={(idx, dir) => void moveField(g.id, idx, dir)}
            onEditField={(d) =>
              setFieldDialog({ open: true, groupId: g.id, editing: d })
            }
            onDeleteField={(d) => void deleteField(d)}
          />
        );
      })}

      {/* Sem grupo */}
      <GroupBlock
        group={null}
        fields={fieldsByGroup.get('__none__') ?? []}
        isFirst
        isLast
        onAddField={() => setFieldDialog({ open: true, groupId: null, editing: null })}
        onMoveField={(idx, dir) => void moveField(null, idx, dir)}
        onEditField={(d) => setFieldDialog({ open: true, groupId: null, editing: d })}
        onDeleteField={(d) => void deleteField(d)}
      />

      {/* Dialogs */}
      <GroupDialog
        open={groupDialog.open}
        editing={groupDialog.editing}
        entityType={entityType}
        onClose={() => setGroupDialog({ open: false, editing: null })}
        onSaved={() => {
          setGroupDialog({ open: false, editing: null });
          void reload();
        }}
      />
      <FieldDialog
        open={fieldDialog.open}
        editing={fieldDialog.editing}
        groupId={fieldDialog.groupId}
        entityType={entityType}
        onClose={() => setFieldDialog({ open: false, groupId: null, editing: null })}
        onSaved={() => {
          setFieldDialog({ open: false, groupId: null, editing: null });
          void reload();
        }}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Group block — header + lista de fields
// ──────────────────────────────────────────────────────────

interface GroupBlockProps {
  group: CustomFieldGroup | null;
  fields: CustomFieldDefinition[];
  isFirst: boolean;
  isLast: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onAddField: () => void;
  onMoveField: (idx: number, dir: -1 | 1) => void;
  onEditField: (d: CustomFieldDefinition) => void;
  onDeleteField: (d: CustomFieldDefinition) => void;
}

function GroupBlock({
  group,
  fields,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDelete,
  onAddField,
  onMoveField,
  onEditField,
  onDeleteField,
}: GroupBlockProps) {
  return (
    <div className="rounded-md border border-border bg-card/50">
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Folder className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-semibold">
            {group ? group.name : 'Sem grupo'}
          </span>
          <span className="text-[10px] text-muted-foreground">
            ({fields.length})
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          {group && onMoveUp && (
            <IconBtn onClick={onMoveUp} disabled={isFirst} aria="Mover grupo pra cima">
              <ArrowUp className="h-3 w-3" />
            </IconBtn>
          )}
          {group && onMoveDown && (
            <IconBtn onClick={onMoveDown} disabled={isLast} aria="Mover grupo pra baixo">
              <ArrowDown className="h-3 w-3" />
            </IconBtn>
          )}
          {group && onEdit && (
            <IconBtn onClick={onEdit} aria="Editar grupo">
              <Pencil className="h-3 w-3" />
            </IconBtn>
          )}
          {group && onDelete && (
            <IconBtn onClick={onDelete} aria="Excluir grupo" tone="destructive">
              <Trash2 className="h-3 w-3" />
            </IconBtn>
          )}
          <Button size="sm" variant="ghost" onClick={onAddField} className="h-6 px-2 text-[11px]">
            <Plus className="mr-1 h-3 w-3" />
            Campo
          </Button>
        </div>
      </header>

      {fields.length === 0 ? (
        <p className="px-3 py-3 text-[11px] italic text-muted-foreground">
          Sem campos.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {fields.map((d, idx) => (
            <FieldRow
              key={d.id}
              field={d}
              isFirst={idx === 0}
              isLast={idx === fields.length - 1}
              onMoveUp={() => onMoveField(idx, -1)}
              onMoveDown={() => onMoveField(idx, 1)}
              onEdit={() => onEditField(d)}
              onDelete={() => onDeleteField(d)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function FieldRow({
  field,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDelete,
}: {
  field: CustomFieldDefinition;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const typeLabel =
    FIELD_TYPE_OPTIONS.find((t) => t.value === field.field_type)?.label ?? field.field_type;
  return (
    <li className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="truncate font-medium">
          {field.name}
          {field.is_required && <span className="ml-1 text-destructive">*</span>}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {typeLabel}
          {field.is_api_only && ' · API'}
          {field.ai_auto_fill && ' · IA'}
        </span>
      </div>
      <div className="flex items-center gap-0.5">
        <IconBtn onClick={onMoveUp} disabled={isFirst} aria="Subir">
          <ArrowUp className="h-3 w-3" />
        </IconBtn>
        <IconBtn onClick={onMoveDown} disabled={isLast} aria="Descer">
          <ArrowDown className="h-3 w-3" />
        </IconBtn>
        <IconBtn onClick={onEdit} aria="Editar">
          <Pencil className="h-3 w-3" />
        </IconBtn>
        <IconBtn onClick={onDelete} aria="Excluir" tone="destructive">
          <Trash2 className="h-3 w-3" />
        </IconBtn>
      </div>
    </li>
  );
}

function IconBtn({
  children,
  onClick,
  disabled,
  aria,
  tone = 'default',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  aria: string;
  tone?: 'default' | 'destructive';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={aria}
      className={cn(
        'flex h-6 w-6 items-center justify-center rounded-md transition-colors disabled:opacity-30',
        tone === 'destructive'
          ? 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

// ──────────────────────────────────────────────────────────
// Group dialog — criar/editar grupo
// ──────────────────────────────────────────────────────────

function GroupDialog({
  open,
  editing,
  entityType,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: CustomFieldGroup | null;
  entityType: CustomFieldEntityType;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? '');
      setIcon(editing?.icon ?? '');
    }
  }, [open, editing]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await customFieldsApi.updateGroup(editing.id, {
          name: name.trim(),
          icon: icon.trim() || null,
        });
        toast.success('Grupo atualizado');
      } else {
        const input: CreateGroupInput = {
          entity_type: entityType,
          name: name.trim(),
          ...(icon.trim() ? { icon: icon.trim() } : {}),
        };
        await customFieldsApi.createGroup(input);
        toast.success('Grupo criado');
      }
      onSaved();
    } catch (err) {
      toast.error('Falha ao salvar grupo', { description: extractMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar grupo' : 'Novo grupo'}</DialogTitle>
            <DialogDescription>
              Grupos organizam campos personalizados em seções dentro do drawer.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Nome *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Dados financeiros"
                required
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Ícone (opcional)</Label>
              <Input
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="Ex: briefcase, map-pin (lucide-react)"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" type="button" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────
// Field dialog — criar/editar campo
// ──────────────────────────────────────────────────────────

function FieldDialog({
  open,
  editing,
  groupId,
  entityType,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: CustomFieldDefinition | null;
  groupId: string | null;
  entityType: CustomFieldEntityType;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [fieldType, setFieldType] = useState<CustomFieldType>('text');
  const [placeholder, setPlaceholder] = useState('');
  const [isRequired, setIsRequired] = useState(false);
  const [isApiOnly, setIsApiOnly] = useState(false);
  const [aiAutoFill, setAiAutoFill] = useState(true);
  const [options, setOptions] = useState<CustomFieldOption[]>([]);
  const [newOptLabel, setNewOptLabel] = useState('');
  const [newOptValue, setNewOptValue] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset form quando abre
  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? '');
    setFieldType(editing?.field_type ?? 'text');
    setPlaceholder(editing?.placeholder ?? '');
    setIsRequired(editing?.is_required ?? false);
    setIsApiOnly(editing?.is_api_only ?? false);
    setAiAutoFill(editing?.ai_auto_fill ?? true);
    setOptions(editing?.options ?? []);
    setNewOptLabel('');
    setNewOptValue('');
  }, [open, editing]);

  const requiresOptions = TYPES_REQUIRING_OPTIONS.includes(fieldType);

  function addOption() {
    const label = newOptLabel.trim();
    const value = newOptValue.trim() || label.toLowerCase().replace(/\s+/g, '_');
    if (!label) return;
    if (options.some((o) => o.value === value)) {
      toast.error('Opção com esse valor já existe');
      return;
    }
    setOptions((prev) => [...prev, { label, value }]);
    setNewOptLabel('');
    setNewOptValue('');
  }

  function removeOption(value: string) {
    setOptions((prev) => prev.filter((o) => o.value !== value));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (requiresOptions && options.length === 0) {
      toast.error(`Tipo "${fieldType}" exige pelo menos 1 opção`);
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await customFieldsApi.update(editing.id, {
          name: name.trim(),
          field_type: fieldType,
          options: requiresOptions ? options : [],
          is_required: isRequired,
          is_api_only: isApiOnly,
          ai_auto_fill: aiAutoFill,
          placeholder: placeholder.trim() || null,
          group_id: groupId,
        });
        toast.success('Campo atualizado');
      } else {
        const input: CreateCustomFieldInput = {
          entity_type: entityType,
          group_id: groupId,
          name: name.trim(),
          field_type: fieldType,
          options: requiresOptions ? options : [],
          is_required: isRequired,
          is_api_only: isApiOnly,
          ai_auto_fill: aiAutoFill,
          ...(placeholder.trim() ? { placeholder: placeholder.trim() } : {}),
        };
        await customFieldsApi.create(input);
        toast.success('Campo criado');
      }
      onSaved();
    } catch (err) {
      toast.error('Falha ao salvar campo', { description: extractMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar campo' : 'Novo campo'}</DialogTitle>
            <DialogDescription>
              Campos definidos aqui aparecem nos drawers da entidade selecionada.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Nome *</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Tipo de plano"
                  required
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Tipo *</Label>
                <select
                  value={fieldType}
                  onChange={(e) => setFieldType(e.target.value as CustomFieldType)}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {FIELD_TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <Label className="text-xs">Placeholder (opcional)</Label>
              <Input
                value={placeholder}
                onChange={(e) => setPlaceholder(e.target.value)}
                placeholder="Hint mostrado no input vazio"
              />
            </div>

            {/* Options pra select/multi/radio */}
            {requiresOptions && (
              <div className="flex flex-col gap-2 rounded-md border border-border bg-card/50 p-2">
                <Label className="text-xs font-semibold">Opções</Label>
                {options.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {options.map((opt) => (
                      <li
                        key={opt.value}
                        className="flex items-center justify-between gap-2 rounded-md bg-background px-2 py-1 text-xs"
                      >
                        <span>
                          <strong>{opt.label}</strong>{' '}
                          <span className="text-muted-foreground">({opt.value})</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => removeOption(opt.value)}
                          aria-label="Remover opção"
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex items-end gap-1.5">
                  <div className="flex flex-col gap-0.5 flex-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Label
                    </span>
                    <Input
                      value={newOptLabel}
                      onChange={(e) => setNewOptLabel(e.target.value)}
                      placeholder="Mensal"
                      className="h-8 text-xs"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addOption();
                        }
                      }}
                    />
                  </div>
                  <div className="flex flex-col gap-0.5 flex-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Valor
                    </span>
                    <Input
                      value={newOptValue}
                      onChange={(e) => setNewOptValue(e.target.value)}
                      placeholder="mensal"
                      className="h-8 text-xs"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addOption();
                        }
                      }}
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={addOption}
                    disabled={!newOptLabel.trim()}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}

            {/* Toggles */}
            <div className="flex flex-col gap-2">
              <ToggleRow
                label="Obrigatório"
                description="Asterisco vermelho no label do drawer"
                value={isRequired}
                onChange={setIsRequired}
              />
              <ToggleRow
                label="Somente leitura (API only)"
                description="Campo desabilitado na UI; apenas integrações editam"
                value={isApiOnly}
                onChange={setIsApiOnly}
              />
              <ToggleRow
                label="IA pode preencher automaticamente"
                description="Ícone ✨ ao lado do label"
                value={aiAutoFill}
                onChange={setAiAutoFill}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" type="button" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2 text-left transition-colors hover:border-primary/30"
    >
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-xs font-medium">{label}</span>
        <span className="text-[10px] text-muted-foreground">{description}</span>
      </div>
      <span
        className={cn(
          'inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
          value ? 'bg-primary' : 'bg-muted',
        )}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 rounded-full bg-background shadow transition-transform',
            value ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </span>
    </button>
  );
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  }
  // Ordena cada grupo por position
  for (const list of map.values()) {
    list.sort(
      (a, b) =>
        (a as unknown as { position: number }).position -
        (b as unknown as { position: number }).position,
    );
  }
  return map;
}

/**
 * Reorder no backend persiste posições por índice no array passado. Nossa
 * UI é por grupo, então reconstruímos a ordem global: outros grupos
 * mantêm suas posições atuais, o grupo afetado fica na nova ordem.
 */
function mergedOrderForReorder(
  defs: CustomFieldDefinition[],
  movedGroupId: string | null,
  reorderedInGroup: CustomFieldDefinition[],
): string[] {
  const result: string[] = [];
  const reorderedIds = new Set(reorderedInGroup.map((d) => d.id));
  // Mantém ordem original; quando bater num campo do grupo afetado, injeta
  // toda a sequência reordenada na posição do primeiro campo do grupo
  let injected = false;
  for (const d of defs) {
    if (reorderedIds.has(d.id)) {
      if (!injected) {
        for (const r of reorderedInGroup) result.push(r.id);
        injected = true;
      }
      // Pula campos do grupo afetado (já foram injetados)
      continue;
    }
    result.push(d.id);
  }
  if (!injected) {
    // Grupo afetado estava vazio antes — apenas concat no final
    for (const r of reorderedInGroup) result.push(r.id);
  }
  return result;
}

function extractMessage(err: unknown): string {
  if (err instanceof ApiError) return `${err.status}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return 'Erro desconhecido';
}
