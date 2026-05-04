'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  tagsApi,
  type TagDefinition,
  type TagEntityType,
} from '@/lib/api/tags';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const PALETTE: Array<{ name: string; bg: string; border: string; text: string; hex: string }> = [
  { name: 'amber', bg: 'bg-amber-500/15', border: 'border-amber-500/40', text: 'text-amber-300', hex: '#F59E0B' },
  { name: 'emerald', bg: 'bg-emerald-500/15', border: 'border-emerald-500/40', text: 'text-emerald-300', hex: '#10B981' },
  { name: 'sky', bg: 'bg-sky-500/15', border: 'border-sky-500/40', text: 'text-sky-300', hex: '#0EA5E9' },
  { name: 'violet', bg: 'bg-violet-500/15', border: 'border-violet-500/40', text: 'text-violet-300', hex: '#8B5CF6' },
  { name: 'rose', bg: 'bg-rose-500/15', border: 'border-rose-500/40', text: 'text-rose-300', hex: '#F43F5E' },
  { name: 'cyan', bg: 'bg-cyan-500/15', border: 'border-cyan-500/40', text: 'text-cyan-300', hex: '#06B6D4' },
  { name: 'fuchsia', bg: 'bg-fuchsia-500/15', border: 'border-fuchsia-500/40', text: 'text-fuchsia-300', hex: '#D946EF' },
  { name: 'orange', bg: 'bg-orange-500/15', border: 'border-orange-500/40', text: 'text-orange-300', hex: '#F97316' },
];

export function TagsSection() {
  const [entity, setEntity] = useState<TagEntityType>('deal');
  const [tags, setTags] = useState<TagDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<TagDefinition | 'new' | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await tagsApi.list({ entity_type: entity });
      setTags(list);
    } catch (err) {
      toast.error('Falha ao carregar tags', {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [entity]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    if (!search.trim()) return tags;
    const q = search.toLowerCase().trim();
    return tags.filter(
      (t) =>
        t.label.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q) ||
        (t.category ?? '').toLowerCase().includes(q),
    );
  }, [tags, search]);

  async function handleDelete(tag: TagDefinition) {
    if (!confirm(`Excluir a tag "${tag.label}"? Tags já aplicadas em contatos/deals NÃO são removidas automaticamente.`)) {
      return;
    }
    try {
      await tagsApi.remove(tag.id);
      toast.success('Tag excluída');
      void reload();
    } catch (err) {
      toast.error('Falha ao excluir', {
        description: err instanceof ApiError ? err.message : undefined,
      });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Catálogo de Tags</h2>
        <p className="text-xs text-muted-foreground">
          Crie e organize tags personalizadas pra usar em contatos e deals. Tags do contato falam sobre o perfil. Tags do card falam sobre qualificações e necessidades.
        </p>
      </div>

      {/* Tabs Contato / Deal */}
      <div className="flex gap-1 rounded-md border border-border bg-card/40 p-1">
        {(['deal', 'contact'] as const).map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => setEntity(e)}
            className={cn(
              'flex-1 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors',
              entity === e
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:bg-muted/50',
            )}
          >
            {e === 'deal' ? 'Tags do Card (Deal)' : 'Tags do Contato'}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, slug ou categoria"
            className="pl-9"
          />
        </div>
        <Button onClick={() => setEditing('new')} className="shrink-0">
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Nova tag
        </Button>
      </div>

      {/* Lista */}
      <div className="flex flex-col gap-1.5">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
            {search.trim()
              ? `Nenhuma tag bate com "${search}"`
              : 'Nenhuma tag ainda. Crie uma pra começar — ou aguarde a IA sugerir.'}
          </div>
        ) : (
          filtered.map((t) => (
            <TagRow
              key={t.id}
              tag={t}
              onEdit={() => setEditing(t)}
              onDelete={() => handleDelete(t)}
            />
          ))
        )}
      </div>

      {/* Dialog criar/editar */}
      <TagDialog
        open={editing !== null}
        editing={editing}
        entityType={entity}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void reload();
        }}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// TagRow
// ──────────────────────────────────────────────────────────

function TagRow({
  tag,
  onEdit,
  onDelete,
}: {
  tag: TagDefinition;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const colorStyle = resolveColorStyle(tag.color);
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-card/40 px-3 py-2">
      <span
        className={cn(
          'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium shrink-0',
          colorStyle.cls,
        )}
        style={colorStyle.inline}
      >
        {tag.label}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[11px] font-mono text-muted-foreground">{tag.slug}</span>
        {tag.description && (
          <span className="truncate text-[11px] text-muted-foreground">{tag.description}</span>
        )}
      </div>
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        {tag.category && (
          <span className="rounded-md bg-muted/50 px-1.5 py-0.5">{tag.category}</span>
        )}
        <span>uso: {tag.usage_count}</span>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// TagDialog (criar + editar)
// ──────────────────────────────────────────────────────────

function TagDialog({
  open,
  editing,
  entityType,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: TagDefinition | 'new' | null;
  entityType: TagEntityType;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = editing === 'new';
  const tag = !isNew && editing !== null ? editing : null;

  const [label, setLabel] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (tag) {
      setLabel(tag.label);
      setColor(tag.color);
      setDescription(tag.description ?? '');
      setCategory(tag.category ?? '');
    } else {
      setLabel('');
      setColor(null);
      setDescription('');
      setCategory('');
    }
    setSubmitting(false);
  }, [open, tag]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setSubmitting(true);
    try {
      if (tag) {
        await tagsApi.update(tag.id, {
          label: label.trim(),
          color,
          description: description.trim() || null,
          category: category.trim() || null,
        });
        toast.success('Tag atualizada');
      } else {
        await tagsApi.create({
          entity_type: entityType,
          label: label.trim(),
          color,
          description: description.trim() || null,
          category: category.trim() || null,
        });
        toast.success('Tag criada');
      }
      onSaved();
    } catch (err) {
      toast.error(tag ? 'Falha ao atualizar' : 'Falha ao criar', {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !submitting && onClose()}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              {tag ? 'Editar tag' : `Nova tag de ${entityType === 'deal' ? 'card' : 'contato'}`}
            </DialogTitle>
            <DialogDescription>
              O slug é gerado automaticamente do nome (ex: "Convênio Gama" → CONVENIO_GAMA).
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tag-label">Nome</Label>
              <Input
                id="tag-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Ex: Convênio Gama"
                maxLength={60}
                autoFocus
              />
              {label.trim() && (
                <span className="text-[10px] font-mono text-muted-foreground">
                  slug: {slugify(label)}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Cor</Label>
              <ColorPicker value={color} onChange={setColor} label={label || 'Tag'} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tag-cat">Categoria (opcional)</Label>
              <Input
                id="tag-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Ex: Convênio, Tipo de Atendimento"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tag-desc">Descrição (opcional)</Label>
              <Textarea
                id="tag-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Quando usar essa tag — também ajuda a IA a escolher melhor."
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!label.trim() || submitting}>
              {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {tag ? 'Salvar' : 'Criar tag'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────
// ColorPicker (paleta 8 + hex livre + auto)
// ──────────────────────────────────────────────────────────

function ColorPicker({
  value,
  onChange,
  label,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  label: string;
}) {
  const [hex, setHex] = useState(value && value.startsWith('#') ? value : '');

  useEffect(() => {
    if (value && value.startsWith('#')) setHex(value);
  }, [value]);

  return (
    <div className="flex flex-col gap-2">
      {/* Paleta curada */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-medium transition-colors',
            value === null
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border text-muted-foreground hover:border-primary/40',
          )}
          title="Cor automática (hash da string)"
        >
          <X className="h-3 w-3" />
          Auto
        </button>
        {PALETTE.map((p) => (
          <button
            key={p.name}
            type="button"
            onClick={() => onChange(p.name)}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-medium transition-colors',
              p.bg,
              p.border,
              p.text,
              value === p.name && 'ring-2 ring-offset-2 ring-offset-background ring-primary',
            )}
            title={p.name}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: p.hex }} />
            {p.name}
          </button>
        ))}
      </div>

      {/* Hex livre */}
      <div className="flex items-center gap-2">
        <Label htmlFor="hex-input" className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Cor custom (hex)
        </Label>
        <Input
          id="hex-input"
          type="text"
          value={hex}
          onChange={(e) => {
            const v = e.target.value;
            setHex(v);
            if (/^#[0-9A-Fa-f]{6}$/.test(v)) onChange(v);
            else if (v === '' && value && value.startsWith('#')) onChange(null);
          }}
          placeholder="#7C3AED"
          maxLength={7}
          className="h-8 w-28 font-mono text-xs"
        />
        <span className="text-[10px] text-muted-foreground">
          Preview:{' '}
          <span
            className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
            style={resolveColorStyle(value).inline}
          >
            {label.slice(0, 16) || 'Tag'}
          </span>
        </span>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Color helpers
// ──────────────────────────────────────────────────────────

function resolveColorStyle(color: string | null): {
  cls: string;
  inline?: React.CSSProperties;
} {
  if (!color) {
    return { cls: 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300' };
  }
  const palette = PALETTE.find((p) => p.name === color);
  if (palette) {
    return { cls: cn(palette.bg, palette.border, palette.text) };
  }
  if (color.startsWith('#')) {
    return {
      cls: 'border',
      inline: {
        background: `${color}26`, // 15% alpha
        borderColor: `${color}66`, // 40% alpha
        color,
      },
    };
  }
  return { cls: 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300' };
}

function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
