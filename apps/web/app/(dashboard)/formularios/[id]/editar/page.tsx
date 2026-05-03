'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  ArrowLeft,
  Eye,
  Loader2,
  Palette,
  Plus,
  Save,
  Settings,
  Share2,
  SlidersHorizontal,
} from 'lucide-react';
import type {
  Form,
  FormBranding,
  FormField,
  FormFieldType,
  FormSettings,
} from '@eclick-active/shared';
import { formsApi } from '@/lib/api/forms';
import { ApiError } from '@/lib/api/client';
import { teamApi, type MemberView } from '@/lib/api/team';
import { pipelinesApi, type PipelineWithStages } from '@/lib/api/pipelines';
import { channelsApi, type ChannelView } from '@/lib/api/channels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FieldEditor } from '@/components/formularios/field-editor';
import { FormPreview } from '@/components/formularios/form-preview';
import { PublishDialog } from '@/components/formularios/publish-dialog';
import { cn } from '@/lib/utils';

type Tab = 'fields' | 'settings' | 'branding';

const NEW_FIELD_TYPES: { type: FormFieldType; label: string }[] = [
  { type: 'text', label: 'Texto curto' },
  { type: 'textarea', label: 'Texto longo' },
  { type: 'email', label: 'Email' },
  { type: 'phone', label: 'Telefone' },
  { type: 'select', label: 'Dropdown' },
  { type: 'radio', label: 'Radio' },
  { type: 'checkbox', label: 'Checkbox' },
  { type: 'date', label: 'Data' },
  { type: 'number', label: 'Número' },
  { type: 'currency', label: 'Valor (R$)' },
  { type: 'cpf_cnpj', label: 'CPF/CNPJ' },
  { type: 'address', label: 'Endereço' },
  { type: 'url', label: 'URL' },
  { type: 'file_upload', label: 'Upload' },
  { type: 'heading', label: 'Título' },
  { type: 'paragraph', label: 'Parágrafo' },
  { type: 'divider', label: 'Divisor' },
];

export default function EditFormPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [form, setForm] = useState<Form | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>('fields');
  const [publishOpen, setPublishOpen] = useState(false);

  const [pipelines, setPipelines] = useState<PipelineWithStages[]>([]);
  const [members, setMembers] = useState<MemberView[]>([]);
  const [channels, setChannels] = useState<ChannelView[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [f, pls, mems, chs] = await Promise.all([
        formsApi.get(id),
        pipelinesApi.list().catch(() => []),
        teamApi.list().catch(() => []),
        channelsApi.list().catch(() => []),
      ]);
      setForm(f);
      setPipelines(pls);
      setMembers(mems);
      setChannels(chs);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao carregar',
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const sortedFields = useMemo(
    () =>
      form ? [...form.fields].sort((a, b) => a.position - b.position) : [],
    [form],
  );

  function update(patch: Partial<Form>) {
    setForm((curr) => (curr ? { ...curr, ...patch } : curr));
  }

  function updateField(idx: number, field: FormField) {
    if (!form) return;
    const next = [...form.fields];
    const realIdx = form.fields.findIndex((x) => x.id === field.id);
    next[realIdx >= 0 ? realIdx : idx] = field;
    update({ fields: next });
  }

  function addField(type: FormFieldType) {
    if (!form) return;
    const newField: FormField = {
      id:
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `field_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      type,
      label: defaultLabel(type),
      required: type === 'phone' || type === 'email',
      position: form.fields.length,
      width: 'full',
      ...(type === 'select' || type === 'radio' || type === 'checkbox'
        ? { options: [{ value: 'opcao_1', label: 'Opção 1' }] }
        : {}),
    };
    update({ fields: [...form.fields, newField] });
  }

  function removeField(fieldId: string) {
    if (!form) return;
    const filtered = form.fields
      .filter((f) => f.id !== fieldId)
      .map((f, i) => ({ ...f, position: i }));
    update({ fields: filtered });
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!form || !over || active.id === over.id) return;

    const sorted = [...form.fields].sort((a, b) => a.position - b.position);
    const oldIdx = sorted.findIndex((f) => f.id === active.id);
    const newIdx = sorted.findIndex((f) => f.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const reordered = arrayMove(sorted, oldIdx, newIdx).map((f, i) => ({
      ...f,
      position: i,
    }));
    update({ fields: reordered });
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await formsApi.update(form.id, {
        name: form.name,
        slug: form.slug,
        description: form.description ?? undefined,
        fields: form.fields,
        settings: form.settings,
        branding: form.branding,
      });
      setForm(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }

  async function togglePublish() {
    if (!form) return;
    try {
      const updated =
        form.status === 'active'
          ? await formsApi.pause(form.id)
          : await formsApi.publish(form.id);
      setForm(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar status');
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!form) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Formulário não encontrado.
      </div>
    );
  }

  const stagesOfPipeline =
    pipelines.find((p) => p.id === form.settings.pipeline_id)?.stages ?? [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/formularios')}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Voltar
          </Button>
          <Input
            value={form.name}
            onChange={(e) => update({ name: e.target.value })}
            className="h-8 w-72 font-semibold"
            placeholder="Nome do formulário"
          />
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
              form.status === 'active'
                ? 'bg-green-500/15 text-green-500'
                : form.status === 'paused'
                  ? 'bg-yellow-500/15 text-yellow-500'
                  : 'bg-muted text-muted-foreground',
            )}
          >
            {form.status}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={togglePublish}>
            <Eye className="h-3.5 w-3.5" />
            {form.status === 'active' ? 'Pausar' : 'Publicar'}
          </Button>
          {form.status === 'active' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPublishOpen(true)}
            >
              <Share2 className="h-3.5 w-3.5" />
              Compartilhar
            </Button>
          )}
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Salvar
          </Button>
        </div>
      </header>

      {error && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-6 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-2">
        {/* Left: Editor */}
        <div className="flex flex-col overflow-hidden border-r border-border">
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as Tab)}
            className="flex flex-1 flex-col overflow-hidden"
          >
            <TabsList className="px-4">
              <TabsTrigger value="fields">
                <SlidersHorizontal className="h-3 w-3" />
                Campos
              </TabsTrigger>
              <TabsTrigger value="settings">
                <Settings className="h-3 w-3" />
                Configurações
              </TabsTrigger>
              <TabsTrigger value="branding">
                <Palette className="h-3 w-3" />
                Aparência
              </TabsTrigger>
            </TabsList>

            <TabsContent value="fields" className="overflow-y-auto p-4">
              <div className="mb-3">
                <Label className="text-[10px] uppercase text-muted-foreground">
                  Slug (URL pública)
                </Label>
                <div className="flex items-center gap-1 text-sm">
                  <span className="text-muted-foreground">/f/</span>
                  <Input
                    value={form.slug}
                    onChange={(e) =>
                      update({
                        slug: e.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9-]/g, '-')
                          .replace(/-+/g, '-'),
                      })
                    }
                    className="h-8 max-w-xs"
                    placeholder="meu-formulario"
                  />
                </div>
              </div>

              <div className="mb-3">
                <Label className="text-[10px] uppercase text-muted-foreground">
                  Descrição
                </Label>
                <Input
                  value={form.description ?? ''}
                  onChange={(e) => update({ description: e.target.value })}
                  className="h-8"
                  placeholder="Mostrada no topo da página pública"
                />
              </div>

              <div className="mb-3 flex flex-wrap gap-1">
                {NEW_FIELD_TYPES.map((t) => (
                  <Button
                    key={t.type}
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => addField(t.type)}
                  >
                    <Plus className="h-3 w-3" />
                    {t.label}
                  </Button>
                ))}
              </div>

              {sortedFields.length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  Nenhum campo ainda. Clique nos botões acima para adicionar.
                </div>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={onDragEnd}
                >
                  <SortableContext
                    items={sortedFields.map((f) => f.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-2">
                      {sortedFields.map((f, idx) => (
                        <FieldEditor
                          key={f.id}
                          field={f}
                          onChange={(next) => updateField(idx, next)}
                          onRemove={() => removeField(f.id)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </TabsContent>

            <TabsContent value="settings" className="overflow-y-auto p-4">
              <SettingsPanel
                settings={form.settings}
                pipelines={pipelines}
                members={members}
                channels={channels}
                stages={stagesOfPipeline}
                onChange={(next) => update({ settings: next })}
              />
            </TabsContent>

            <TabsContent value="branding" className="overflow-y-auto p-4">
              <BrandingPanel
                branding={form.branding}
                onChange={(next) => update({ branding: next })}
              />
            </TabsContent>
          </Tabs>
        </div>

        {/* Right: Preview */}
        <div className="overflow-y-auto bg-muted/30 p-6">
          <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
            Preview
          </p>
          <FormPreview
            fields={form.fields}
            branding={form.branding}
            formName={form.name}
            description={form.description}
          />
        </div>
      </div>

      {publishOpen && (
        <PublishDialog
          form={form}
          open={publishOpen}
          onOpenChange={setPublishOpen}
        />
      )}

      {/* Hint pra mobile */}
      <div className="lg:hidden border-t border-border bg-muted/30 px-4 py-2 text-center text-xs text-muted-foreground">
        Preview disponível em telas maiores. Editar e salvar funciona normalmente.
      </div>

      {/* Hidden preview link for mobile */}
      <div className="lg:hidden" />

      {/* Bottom action bar links */}
      <div className="hidden">
        <Link href="/formularios">Voltar</Link>
      </div>
    </div>
  );
}

function defaultLabel(type: FormFieldType): string {
  const map: Record<FormFieldType, string> = {
    text: 'Texto',
    textarea: 'Mensagem',
    email: 'Email',
    phone: 'WhatsApp',
    number: 'Número',
    currency: 'Valor',
    date: 'Data',
    select: 'Selecione uma opção',
    multi_select: 'Selecione (múltiplas)',
    radio: 'Escolha uma opção',
    checkbox: 'Marque o que se aplica',
    url: 'Site',
    cpf_cnpj: 'CPF / CNPJ',
    address: 'Endereço',
    file_upload: 'Anexo',
    heading: 'Título da seção',
    divider: '',
    paragraph: 'Texto explicativo',
  };
  return map[type] ?? 'Campo';
}

// ────────────────────────────────────────────────────────────
// Settings panel
// ────────────────────────────────────────────────────────────

function SettingsPanel({
  settings,
  pipelines,
  members,
  channels,
  stages,
  onChange,
}: {
  settings: FormSettings;
  pipelines: PipelineWithStages[];
  members: MemberView[];
  channels: ChannelView[];
  stages: { id: string; name: string }[];
  onChange: (next: FormSettings) => void;
}) {
  function patch(p: Partial<FormSettings>) {
    onChange({ ...settings, ...p });
  }

  return (
    <div className="space-y-5 max-w-xl">
      <section>
        <h3 className="mb-2 text-sm font-semibold">Pipeline & Deal</h3>
        <div className="space-y-2">
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">
              Pipeline
            </Label>
            <select
              value={settings.pipeline_id ?? ''}
              onChange={(e) =>
                patch({
                  pipeline_id: e.target.value || undefined,
                  stage_id: undefined,
                })
              }
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="">— Padrão da org —</option>
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          {settings.pipeline_id && (
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">
                Stage inicial
              </Label>
              <select
                value={settings.stage_id ?? ''}
                onChange={(e) =>
                  patch({ stage_id: e.target.value || undefined })
                }
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="">— Primeiro stage —</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">
              Título do deal (template)
            </Label>
            <Input
              value={settings.deal_title_template ?? ''}
              onChange={(e) =>
                patch({ deal_title_template: e.target.value })
              }
              placeholder="Ex: Lead {name} — {company}"
              className="h-9"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Placeholders: <code>{'{name}'}</code>, <code>{'{company}'}</code>.
              Default: &quot;Lead via formulário — &lt;nome&gt;&quot;.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.auto_create_deal !== false}
              onChange={(e) =>
                patch({ auto_create_deal: e.target.checked })
              }
            />
            Criar deal automaticamente em cada submissão
          </label>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Atribuição</h3>
        <div className="space-y-2">
          <select
            value={settings.assignment_rule ?? 'round_robin'}
            onChange={(e) =>
              patch({
                assignment_rule: e.target.value as
                  | 'round_robin'
                  | 'specific'
                  | 'none',
              })
            }
            className="h-9 w-full max-w-xs rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="round_robin">Round-robin (rotativo)</option>
            <option value="specific">Membro específico</option>
            <option value="none">Sem atribuir</option>
          </select>
          {settings.assignment_rule === 'specific' && (
            <select
              value={settings.assigned_to ?? ''}
              onChange={(e) =>
                patch({ assigned_to: e.target.value || undefined })
              }
              className="h-9 w-full max-w-xs rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="">— Selecione —</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name ?? m.email ?? m.id.slice(0, 8)}
                </option>
              ))}
            </select>
          )}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Mensagem de boas-vindas</h3>
        <div className="space-y-2">
          <select
            value={settings.welcome_channel_id ?? ''}
            onChange={(e) =>
              patch({ welcome_channel_id: e.target.value || undefined })
            }
            className="h-9 w-full max-w-xs rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="">— Não enviar —</option>
            {channels
              .filter((c) => c.status === 'active')
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          <textarea
            value={settings.welcome_message ?? ''}
            onChange={(e) => patch({ welcome_message: e.target.value })}
            rows={3}
            placeholder="Olá {name}, recebemos seu cadastro! Em breve um especialista vai falar com você."
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <p className="text-[10px] text-muted-foreground">
            Use <code>{'{name}'}</code> e <code>{'{company}'}</code>.
          </p>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Tags automáticas</h3>
        <Input
          value={(settings.auto_tags ?? []).join(', ')}
          onChange={(e) =>
            patch({
              auto_tags: e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          placeholder="lead-quente, formulario, web"
          className="h-9"
        />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Após envio</h3>
        <div className="space-y-2">
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">
              Mensagem de sucesso
            </Label>
            <Input
              value={settings.success_message ?? ''}
              onChange={(e) => patch({ success_message: e.target.value })}
              placeholder="Recebemos seus dados! Em breve entraremos em contato."
              className="h-9"
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">
              Redirecionar para URL (opcional)
            </Label>
            <Input
              value={settings.redirect_url ?? ''}
              onChange={(e) => patch({ redirect_url: e.target.value })}
              placeholder="https://meusite.com/obrigado"
              className="h-9"
            />
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Notificações</h3>
        <div className="space-y-2">
          <Input
            value={settings.notifications?.email ?? ''}
            onChange={(e) =>
              patch({
                notifications: {
                  ...(settings.notifications ?? {}),
                  email: e.target.value || undefined,
                },
              })
            }
            placeholder="Email pra avisar (opcional)"
            className="h-9"
            type="email"
          />
          <Input
            value={settings.notifications?.webhook_url ?? ''}
            onChange={(e) =>
              patch({
                notifications: {
                  ...(settings.notifications ?? {}),
                  webhook_url: e.target.value || undefined,
                },
              })
            }
            placeholder="Webhook URL (opcional)"
            className="h-9"
          />
        </div>
      </section>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Branding panel
// ────────────────────────────────────────────────────────────

function BrandingPanel({
  branding,
  onChange,
}: {
  branding: FormBranding;
  onChange: (next: FormBranding) => void;
}) {
  function patch(p: Partial<FormBranding>) {
    onChange({ ...branding, ...p });
  }

  return (
    <div className="space-y-4 max-w-xl">
      <div>
        <Label className="text-[10px] uppercase text-muted-foreground">
          URL do logo
        </Label>
        <Input
          value={branding.logo_url ?? ''}
          onChange={(e) => patch({ logo_url: e.target.value })}
          placeholder="https://..."
          className="h-9"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-[10px] uppercase text-muted-foreground">
            Cor primária
          </Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={branding.primary_color ?? '#00E5FF'}
              onChange={(e) => patch({ primary_color: e.target.value })}
              className="h-9 w-12 cursor-pointer rounded-md border border-border bg-background"
            />
            <Input
              value={branding.primary_color ?? '#00E5FF'}
              onChange={(e) => patch({ primary_color: e.target.value })}
              className="h-9 flex-1 font-mono text-xs"
            />
          </div>
        </div>
        <div>
          <Label className="text-[10px] uppercase text-muted-foreground">
            Cor de fundo
          </Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={branding.background_color ?? '#000000'}
              onChange={(e) => patch({ background_color: e.target.value })}
              className="h-9 w-12 cursor-pointer rounded-md border border-border bg-background"
            />
            <Input
              value={branding.background_color ?? ''}
              onChange={(e) => patch({ background_color: e.target.value })}
              placeholder="auto"
              className="h-9 flex-1 font-mono text-xs"
            />
          </div>
        </div>
      </div>

      <div>
        <Label className="text-[10px] uppercase text-muted-foreground">
          Família tipográfica (CSS font-family)
        </Label>
        <Input
          value={branding.font_family ?? ''}
          onChange={(e) => patch({ font_family: e.target.value })}
          placeholder="Inter, system-ui, sans-serif"
          className="h-9"
        />
      </div>

      <div>
        <Label className="text-[10px] uppercase text-muted-foreground">
          Texto de cabeçalho (opcional)
        </Label>
        <Input
          value={branding.header_text ?? ''}
          onChange={(e) => patch({ header_text: e.target.value })}
          className="h-9"
        />
      </div>

      <div>
        <Label className="text-[10px] uppercase text-muted-foreground">
          Texto de rodapé (opcional)
        </Label>
        <Input
          value={branding.footer_text ?? ''}
          onChange={(e) => patch({ footer_text: e.target.value })}
          className="h-9"
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={branding.show_powered_by !== false}
          onChange={(e) => patch({ show_powered_by: e.target.checked })}
        />
        Mostrar &ldquo;Powered by e-Click Active&rdquo;
      </label>
    </div>
  );
}
