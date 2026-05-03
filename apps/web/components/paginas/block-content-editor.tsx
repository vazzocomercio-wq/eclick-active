'use client';

import { Trash2 } from 'lucide-react';
import type { PageBlock } from '@eclick-active/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

/**
 * Editor de conteúdo por tipo de bloco. Cada tipo tem campos específicos.
 * O conteúdo é genérico Record<string, unknown> — aqui mapeamos pra UI.
 */

interface Props {
  block: PageBlock;
  onChange: (content: Record<string, unknown>) => void;
}

export function BlockContentEditor({ block, onChange }: Props) {
  const c = block.content;

  function set(key: string, value: unknown) {
    onChange({ ...c, [key]: value });
  }

  switch (block.type) {
    case 'hero':
      return (
        <div className="space-y-3">
          <FieldString label="Headline" value={c.headline} onChange={(v) => set('headline', v)} />
          <FieldText label="Subheadline" value={c.subheadline} onChange={(v) => set('subheadline', v)} />
          <FieldString label="Texto do CTA" value={c.cta_text} onChange={(v) => set('cta_text', v)} />
          <FieldString label="Link do CTA" value={c.cta_href} onChange={(v) => set('cta_href', v)} placeholder="#contato ou https://..." />
          <FieldString label="CTA secundário (opcional)" value={c.cta_secondary_text} onChange={(v) => set('cta_secondary_text', v)} />
          <FieldString label="Link CTA secundário" value={c.cta_secondary_href} onChange={(v) => set('cta_secondary_href', v)} />
          <FieldString label="Imagem (URL)" value={c.image} onChange={(v) => set('image', v)} placeholder="https://..." />
          <FieldSelect
            label="Layout"
            value={(c.layout as string) ?? 'centered'}
            onChange={(v) => set('layout', v)}
            options={[
              { value: 'centered', label: 'Centralizado' },
              { value: 'split', label: 'Dividido (texto + imagem)' },
            ]}
          />
        </div>
      );

    case 'hero_video':
      return (
        <div className="space-y-3">
          <FieldString label="Headline" value={c.headline} onChange={(v) => set('headline', v)} />
          <FieldText label="Subheadline" value={c.subheadline} onChange={(v) => set('subheadline', v)} />
          <FieldString label="URL do vídeo (YouTube)" value={c.video_url} onChange={(v) => set('video_url', v)} />
          <FieldString label="Texto do CTA" value={c.cta_text} onChange={(v) => set('cta_text', v)} />
          <FieldString label="Link do CTA" value={c.cta_href} onChange={(v) => set('cta_href', v)} />
        </div>
      );

    case 'navbar':
      return (
        <div className="space-y-3">
          <FieldString label="Texto do logo" value={c.logo_text} onChange={(v) => set('logo_text', v)} />
          <FieldString label="Logo URL (opcional)" value={c.logo_image} onChange={(v) => set('logo_image', v)} />
          <FieldArray
            label="Links"
            value={(c.links as { label: string; href: string }[]) ?? []}
            onChange={(v) => set('links', v)}
            empty={{ label: 'Link', href: '#' }}
            renderItem={(item, update) => (
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Label"
                  value={item.label}
                  onChange={(e) => update({ ...item, label: e.target.value })}
                  className="h-8"
                />
                <Input
                  placeholder="URL"
                  value={item.href}
                  onChange={(e) => update({ ...item, href: e.target.value })}
                  className="h-8"
                />
              </div>
            )}
          />
          <FieldString label="Texto do CTA" value={c.cta_text} onChange={(v) => set('cta_text', v)} />
          <FieldString label="Link do CTA" value={c.cta_href} onChange={(v) => set('cta_href', v)} />
        </div>
      );

    case 'heading':
      return (
        <div className="space-y-3">
          <FieldString label="Título" value={c.title} onChange={(v) => set('title', v)} />
          <FieldText label="Subtítulo" value={c.subtitle} onChange={(v) => set('subtitle', v)} />
        </div>
      );

    case 'text':
      return (
        <div className="space-y-3">
          <FieldText label="Texto" value={c.text} onChange={(v) => set('text', v)} rows={6} />
          <FieldSelect
            label="Alinhamento"
            value={(c.align as string) ?? 'left'}
            onChange={(v) => set('align', v)}
            options={[
              { value: 'left', label: 'Esquerda' },
              { value: 'center', label: 'Centro' },
              { value: 'right', label: 'Direita' },
            ]}
          />
        </div>
      );

    case 'image':
      return (
        <div className="space-y-3">
          <FieldString label="URL da imagem" value={c.url} onChange={(v) => set('url', v)} />
          <FieldString label="Alt text" value={c.alt} onChange={(v) => set('alt', v)} />
          <FieldString label="Caption" value={c.caption} onChange={(v) => set('caption', v)} />
        </div>
      );

    case 'video':
      return (
        <FieldString label="URL do vídeo (YouTube/Vimeo)" value={c.url} onChange={(v) => set('url', v)} />
      );

    case 'benefits':
      return (
        <div className="space-y-3">
          <FieldString label="Título" value={c.title} onChange={(v) => set('title', v)} />
          <FieldArray
            label="Itens"
            value={(c.items as { icon?: string; title: string; description: string }[]) ?? []}
            onChange={(v) => set('items', v)}
            empty={{ icon: '✨', title: '', description: '' }}
            renderItem={(item, update) => (
              <div className="space-y-2">
                <Input
                  placeholder="Ícone (emoji)"
                  value={item.icon ?? ''}
                  onChange={(e) => update({ ...item, icon: e.target.value })}
                  className="h-8 w-20"
                />
                <Input
                  placeholder="Título"
                  value={item.title}
                  onChange={(e) => update({ ...item, title: e.target.value })}
                  className="h-8"
                />
                <textarea
                  placeholder="Descrição"
                  value={item.description}
                  onChange={(e) => update({ ...item, description: e.target.value })}
                  rows={2}
                  className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                />
              </div>
            )}
          />
        </div>
      );

    case 'features':
      return (
        <div className="space-y-3">
          <FieldString label="Título" value={c.title} onChange={(v) => set('title', v)} />
          <FieldArray
            label="Features"
            value={(c.items as string[]) ?? []}
            onChange={(v) => set('items', v)}
            empty=""
            renderItem={(item, update) => (
              <Input
                placeholder="Feature"
                value={item as string}
                onChange={(e) => update(e.target.value)}
                className="h-8"
              />
            )}
          />
        </div>
      );

    case 'stats':
      return (
        <div className="space-y-3">
          <FieldString label="Título" value={c.title} onChange={(v) => set('title', v)} />
          <FieldArray
            label="Itens"
            value={
              (c.items as {
                number: string | number;
                label: string;
                suffix?: string;
                prefix?: string;
              }[]) ?? []
            }
            onChange={(v) => set('items', v)}
            empty={{ number: 0, label: '' }}
            renderItem={(item, update) => (
              <div className="grid grid-cols-3 gap-2">
                <Input
                  placeholder="Prefixo"
                  value={item.prefix ?? ''}
                  onChange={(e) => update({ ...item, prefix: e.target.value })}
                  className="h-8"
                />
                <Input
                  placeholder="Número"
                  value={String(item.number)}
                  onChange={(e) => update({ ...item, number: e.target.value })}
                  className="h-8"
                />
                <Input
                  placeholder="Sufixo"
                  value={item.suffix ?? ''}
                  onChange={(e) => update({ ...item, suffix: e.target.value })}
                  className="h-8"
                />
                <Input
                  placeholder="Label"
                  value={item.label}
                  onChange={(e) => update({ ...item, label: e.target.value })}
                  className="col-span-3 h-8"
                />
              </div>
            )}
          />
        </div>
      );

    case 'testimonials':
      return (
        <div className="space-y-3">
          <FieldString label="Título" value={c.title} onChange={(v) => set('title', v)} />
          <FieldArray
            label="Depoimentos"
            value={
              (c.items as {
                name: string;
                role?: string;
                company?: string;
                text: string;
                photo?: string;
                stars?: number;
              }[]) ?? []
            }
            onChange={(v) => set('items', v)}
            empty={{ name: '', text: '', stars: 5 }}
            renderItem={(item, update) => (
              <div className="space-y-2">
                <Input
                  placeholder="Nome"
                  value={item.name}
                  onChange={(e) => update({ ...item, name: e.target.value })}
                  className="h-8"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Cargo"
                    value={item.role ?? ''}
                    onChange={(e) => update({ ...item, role: e.target.value })}
                    className="h-8"
                  />
                  <Input
                    placeholder="Empresa"
                    value={item.company ?? ''}
                    onChange={(e) => update({ ...item, company: e.target.value })}
                    className="h-8"
                  />
                </div>
                <textarea
                  placeholder="Depoimento"
                  value={item.text}
                  onChange={(e) => update({ ...item, text: e.target.value })}
                  rows={3}
                  className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Foto URL"
                    value={item.photo ?? ''}
                    onChange={(e) => update({ ...item, photo: e.target.value })}
                    className="h-8"
                  />
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    placeholder="Estrelas"
                    value={item.stars ?? 5}
                    onChange={(e) => update({ ...item, stars: Number(e.target.value) })}
                    className="h-8"
                  />
                </div>
              </div>
            )}
          />
        </div>
      );

    case 'faq':
      return (
        <div className="space-y-3">
          <FieldString label="Título" value={c.title} onChange={(v) => set('title', v)} />
          <FieldArray
            label="Perguntas"
            value={(c.items as { question: string; answer: string }[]) ?? []}
            onChange={(v) => set('items', v)}
            empty={{ question: '', answer: '' }}
            renderItem={(item, update) => (
              <div className="space-y-2">
                <Input
                  placeholder="Pergunta"
                  value={item.question}
                  onChange={(e) => update({ ...item, question: e.target.value })}
                  className="h-8"
                />
                <textarea
                  placeholder="Resposta"
                  value={item.answer}
                  onChange={(e) => update({ ...item, answer: e.target.value })}
                  rows={3}
                  className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                />
              </div>
            )}
          />
        </div>
      );

    case 'cta':
      return (
        <div className="space-y-3">
          <FieldString label="Título" value={c.title} onChange={(v) => set('title', v)} />
          <FieldText label="Subtítulo" value={c.subtitle} onChange={(v) => set('subtitle', v)} />
          <FieldString label="Texto do botão" value={c.button_text} onChange={(v) => set('button_text', v)} />
          <FieldString label="Link do botão" value={c.button_href} onChange={(v) => set('button_href', v)} />
        </div>
      );

    case 'whatsapp_button':
      return (
        <div className="space-y-3">
          <FieldString label="Telefone (com DDD)" value={c.phone} onChange={(v) => set('phone', v)} placeholder="5571999999999" />
          <FieldText label="Mensagem pré-definida" value={c.message} onChange={(v) => set('message', v)} />
          <FieldString label="Texto do botão" value={c.text} onChange={(v) => set('text', v)} />
        </div>
      );

    case 'floating_cta':
      return (
        <div className="space-y-3">
          <FieldString label="Telefone" value={c.phone} onChange={(v) => set('phone', v)} />
          <FieldText label="Mensagem" value={c.message} onChange={(v) => set('message', v)} />
        </div>
      );

    case 'form':
      return (
        <div className="space-y-3">
          <FieldString label="Título" value={c.title} onChange={(v) => set('title', v)} />
          <FieldString
            label="Slug do formulário"
            value={c.form_slug}
            onChange={(v) => set('form_slug', v)}
            placeholder="meu-formulario"
          />
          <p className="text-[11px] text-muted-foreground">
            Crie o formulário em /formularios e cole o slug aqui.
          </p>
        </div>
      );

    case 'product_grid':
      return (
        <div className="space-y-3">
          <FieldString label="Título" value={c.title} onChange={(v) => set('title', v)} />
          <FieldSelect
            label="Colunas"
            value={String(c.columns ?? 3)}
            onChange={(v) => set('columns', Number(v))}
            options={[
              { value: '2', label: '2 colunas' },
              { value: '3', label: '3 colunas' },
              { value: '4', label: '4 colunas' },
            ]}
          />
        </div>
      );

    case 'banner':
      return (
        <div className="space-y-3">
          <FieldString label="Texto" value={c.text} onChange={(v) => set('text', v)} />
          <FieldString label="Botão (texto)" value={c.cta_text} onChange={(v) => set('cta_text', v)} />
          <FieldString label="Botão (link)" value={c.cta_href} onChange={(v) => set('cta_href', v)} />
        </div>
      );

    case 'countdown':
      return (
        <div className="space-y-3">
          <FieldString label="Título" value={c.title} onChange={(v) => set('title', v)} />
          <FieldString
            label="Data alvo (ISO)"
            value={c.target_date}
            onChange={(v) => set('target_date', v)}
            placeholder="2026-06-30T23:59:00-03:00"
          />
        </div>
      );

    case 'about':
      return (
        <div className="space-y-3">
          <FieldString label="Título" value={c.title} onChange={(v) => set('title', v)} />
          <FieldText label="Texto" value={c.text} onChange={(v) => set('text', v)} rows={5} />
          <FieldString label="Imagem URL" value={c.image} onChange={(v) => set('image', v)} />
        </div>
      );

    case 'team':
      return (
        <div className="space-y-3">
          <FieldString label="Título" value={c.title} onChange={(v) => set('title', v)} />
          <FieldArray
            label="Membros"
            value={(c.items as { name: string; role?: string; photo?: string }[]) ?? []}
            onChange={(v) => set('items', v)}
            empty={{ name: '' }}
            renderItem={(item, update) => (
              <div className="space-y-2">
                <Input placeholder="Nome" value={item.name} onChange={(e) => update({ ...item, name: e.target.value })} className="h-8" />
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Cargo" value={item.role ?? ''} onChange={(e) => update({ ...item, role: e.target.value })} className="h-8" />
                  <Input placeholder="Foto URL" value={item.photo ?? ''} onChange={(e) => update({ ...item, photo: e.target.value })} className="h-8" />
                </div>
              </div>
            )}
          />
        </div>
      );

    case 'pricing_table':
      return (
        <div className="space-y-3">
          <FieldString label="Título" value={c.title} onChange={(v) => set('title', v)} />
          <FieldArray
            label="Planos"
            value={
              (c.plans as {
                name: string;
                price: string;
                period?: string;
                features: string[];
                cta_text?: string;
                cta_href?: string;
                highlighted?: boolean;
              }[]) ?? []
            }
            onChange={(v) => set('plans', v)}
            empty={{ name: '', price: '', features: [] }}
            renderItem={(plan, update) => (
              <div className="space-y-2">
                <Input placeholder="Nome do plano" value={plan.name} onChange={(e) => update({ ...plan, name: e.target.value })} className="h-8" />
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Preço (ex: R$ 99)" value={plan.price} onChange={(e) => update({ ...plan, price: e.target.value })} className="h-8" />
                  <Input placeholder="Período (ex: mês)" value={plan.period ?? ''} onChange={(e) => update({ ...plan, period: e.target.value })} className="h-8" />
                </div>
                <textarea
                  placeholder="Features (uma por linha)"
                  value={(plan.features ?? []).join('\n')}
                  onChange={(e) =>
                    update({
                      ...plan,
                      features: e.target.value
                        .split('\n')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  rows={4}
                  className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="CTA texto" value={plan.cta_text ?? ''} onChange={(e) => update({ ...plan, cta_text: e.target.value })} className="h-8" />
                  <Input placeholder="CTA link" value={plan.cta_href ?? ''} onChange={(e) => update({ ...plan, cta_href: e.target.value })} className="h-8" />
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={!!plan.highlighted}
                    onChange={(e) => update({ ...plan, highlighted: e.target.checked })}
                  />
                  Destacar este plano
                </label>
              </div>
            )}
          />
        </div>
      );

    case 'footer':
      return (
        <div className="space-y-3">
          <FieldString label="Logo (texto)" value={c.logo} onChange={(v) => set('logo', v)} />
          <FieldText label="Texto institucional" value={c.text} onChange={(v) => set('text', v)} />
          <FieldArray
            label="Links"
            value={(c.links as { label: string; href: string }[]) ?? []}
            onChange={(v) => set('links', v)}
            empty={{ label: '', href: '' }}
            renderItem={(item, update) => (
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Label" value={item.label} onChange={(e) => update({ ...item, label: e.target.value })} className="h-8" />
                <Input placeholder="URL" value={item.href} onChange={(e) => update({ ...item, href: e.target.value })} className="h-8" />
              </div>
            )}
          />
          <FieldArray
            label="Redes sociais"
            value={(c.social as { network: string; url: string }[]) ?? []}
            onChange={(v) => set('social', v)}
            empty={{ network: '', url: '' }}
            renderItem={(item, update) => (
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Rede" value={item.network} onChange={(e) => update({ ...item, network: e.target.value })} className="h-8" />
                <Input placeholder="URL" value={item.url} onChange={(e) => update({ ...item, url: e.target.value })} className="h-8" />
              </div>
            )}
          />
          <FieldString label="Copyright" value={c.copyright} onChange={(v) => set('copyright', v)} />
        </div>
      );

    case 'spacer':
      return (
        <FieldString
          label="Altura (px)"
          value={String(c.height ?? 40)}
          onChange={(v) => set('height', Number(v))}
        />
      );

    case 'custom_html':
      return (
        <div>
          <Label className="mb-1 block text-[10px] uppercase text-muted-foreground">HTML</Label>
          <textarea
            value={(c.html as string) ?? ''}
            onChange={(e) => set('html', e.target.value)}
            rows={10}
            className="w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
          />
        </div>
      );

    default:
      return (
        <p className="text-xs text-muted-foreground">
          Edição visual deste bloco em breve. Para já, use o assistente IA pra ajustar.
        </p>
      );
  }
}

// ────────────────────────────────────────────────────────────
// Field helpers
// ────────────────────────────────────────────────────────────

function FieldString({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: unknown;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <Label className="mb-1 block text-[10px] uppercase text-muted-foreground">{label}</Label>
      <Input
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8"
      />
    </div>
  );
}

function FieldText({
  label,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  value: unknown;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <div>
      <Label className="mb-1 block text-[10px] uppercase text-muted-foreground">{label}</Label>
      <textarea
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
      />
    </div>
  );
}

function FieldSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <Label className="mb-1 block text-[10px] uppercase text-muted-foreground">{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface FieldArrayProps<T> {
  label: string;
  value: T[];
  onChange: (v: T[]) => void;
  empty: T;
  renderItem: (item: T, update: (next: T) => void) => React.ReactNode;
}

function FieldArray<T>({ label, value, onChange, empty, renderItem }: FieldArrayProps<T>) {
  function update(idx: number, next: T) {
    const arr = [...value];
    arr[idx] = next;
    onChange(arr);
  }
  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }
  function add() {
    // Deep clone do empty pra arrays
    onChange([...value, JSON.parse(JSON.stringify(empty)) as T]);
  }
  return (
    <div>
      <Label className="mb-1 block text-[10px] uppercase text-muted-foreground">{label}</Label>
      <div className="space-y-2">
        {value.map((item, idx) => (
          <div key={idx} className="rounded-md border border-border bg-background/50 p-2">
            {renderItem(item, (next) => update(idx, next))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-1 h-6 w-full justify-center text-[10px] text-destructive hover:bg-destructive/10"
              onClick={() => remove(idx)}
            >
              <Trash2 className="h-3 w-3" />
              Remover
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="h-7 w-full text-xs" onClick={add}>
          + Adicionar
        </Button>
      </div>
    </div>
  );
}
