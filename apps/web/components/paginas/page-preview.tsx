'use client';

import { useMemo } from 'react';
import type { Page, PageBlock, StoreProduct } from '@eclick-active/shared';

/**
 * Preview live no editor — renderiza blocks como iframe srcDoc usando
 * o mesmo HTML estático que será publicado. Garantia de WYSIWYG perfeito
 * porque é o MESMO renderer do backend (idealmente).
 *
 * Estratégia simplificada: renderizamos um HTML inline básico no client
 * (suficiente pra ver a estrutura). Pra fidelidade 100% no preview, use
 * o botão "Preview full-screen" que abre /pages/:id/preview no backend.
 */

interface Props {
  page: Page;
  products: StoreProduct[];
  device: 'desktop' | 'tablet' | 'mobile';
  highlightBlockId?: string | null;
}

export function PagePreview({ page, products, device, highlightBlockId }: Props) {
  const html = useMemo(() => buildHtml(page, products, highlightBlockId), [page, products, highlightBlockId]);

  const widths: Record<typeof device, string> = {
    desktop: '100%',
    tablet: '768px',
    mobile: '375px',
  };

  return (
    <div className="flex h-full justify-center overflow-auto p-4">
      <div
        className="h-full overflow-hidden rounded-lg shadow-2xl transition-[width] duration-200"
        style={{
          width: widths[device],
          maxWidth: '100%',
        }}
      >
        <iframe
          srcDoc={html}
          title="Preview"
          sandbox="allow-same-origin"
          className="h-full w-full border-0"
          style={{ background: page.global_styles.background ?? '#0A0A0F' }}
        />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// HTML builder (versão client-side simplificada — bate visualmente
// com o renderer do backend; usado pra preview rápido no editor)
// ────────────────────────────────────────────────────────────

function buildHtml(page: Page, products: StoreProduct[], highlight: string | null | undefined): string {
  const sortedBlocks = [...page.blocks].sort((a, b) => a.position - b.position);
  const cssVars = `
:root {
  --ec-primary: ${page.global_styles.primary_color ?? '#00E5FF'};
  --ec-secondary: ${page.global_styles.secondary_color ?? '#0EA5E9'};
  --ec-accent: ${page.global_styles.accent_color ?? '#22C55E'};
  --ec-bg: ${page.global_styles.background ?? '#0A0A0F'};
  --ec-text: ${page.global_styles.text_color ?? '#F5F5F7'};
  --ec-muted: rgba(255,255,255,0.6);
  --ec-border: rgba(255,255,255,0.1);
  --ec-radius: ${page.global_styles.border_radius ?? 8}px;
  --ec-font-heading: ${page.global_styles.font_heading ? `'${page.global_styles.font_heading}',` : ''} system-ui, sans-serif;
  --ec-font-body: ${page.global_styles.font_body ? `'${page.global_styles.font_body}',` : ''} system-ui, sans-serif;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--ec-bg); color: var(--ec-text); font-family: var(--ec-font-body); line-height: 1.6; }
img { max-width: 100%; height: auto; display: block; }
a { color: var(--ec-primary); text-decoration: none; }
h1,h2,h3 { font-family: var(--ec-font-heading); line-height: 1.2; }
h1 { font-size: clamp(2rem, 5vw, 3.5rem); font-weight: 700; }
h2 { font-size: clamp(1.5rem, 3vw, 2.5rem); font-weight: 700; }
h3 { font-size: 1.25rem; font-weight: 600; }
.ec-block { padding: 64px 24px; }
.ec-block--sm { padding: 32px 24px; }
.ec-block--lg { padding: 96px 24px; }
.ec-block--xl { padding: 128px 24px; }
.ec-container { max-width: 1200px; margin: 0 auto; }
.ec-btn { display: inline-block; padding: 14px 28px; border-radius: var(--ec-radius); font-weight: 600; cursor: pointer; border: none; font-size: 16px; }
.ec-btn--primary { background: var(--ec-primary); color: #000; }
.ec-btn--secondary { background: transparent; color: var(--ec-text); border: 1.5px solid var(--ec-border); }
.ec-grid { display: grid; gap: 24px; }
.ec-grid--2 { grid-template-columns: repeat(2, 1fr); }
.ec-grid--3 { grid-template-columns: repeat(3, 1fr); }
.ec-grid--4 { grid-template-columns: repeat(4, 1fr); }
@media (max-width: 768px) {
  .ec-grid--2, .ec-grid--3, .ec-grid--4 { grid-template-columns: 1fr; }
  .ec-block { padding: 40px 20px; }
}
.ec-product { background: rgba(255,255,255,0.03); border: 1px solid var(--ec-border); border-radius: var(--ec-radius); overflow: hidden; }
.ec-product img { aspect-ratio: 1/1; object-fit: cover; width: 100%; background: rgba(255,255,255,0.05); }
.ec-product__body { padding: 14px; }
.ec-product__price { font-size: 1.25rem; font-weight: 700; color: var(--ec-primary); }
.ec-highlight { outline: 2px solid var(--ec-primary); outline-offset: 4px; }
`;

  const blocksHtml = sortedBlocks
    .map((b) => {
      const isHighlight = highlight && b.id === highlight;
      const inner = renderBlock(b, products);
      const wrapper = `<section class="ec-block ec-block--${b.settings.padding ?? 'md'} ${isHighlight ? 'ec-highlight' : ''}" data-block-id="${b.id}">${inner}</section>`;
      return wrapper;
    })
    .join('\n');

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${cssVars}</style></head><body>${blocksHtml}<script>document.addEventListener('click',function(e){if(e.target.closest('a,button')){e.preventDefault();}});</script></body></html>`;
}

function renderBlock(b: PageBlock, products: StoreProduct[]): string {
  const c = b.content;
  const e = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  switch (b.type) {
    case 'navbar': {
      const links = (c.links as { label: string; href: string }[]) ?? [];
      return `<nav class="ec-container" style="display:flex;justify-content:space-between;align-items:center;padding:16px 24px;"><strong style="font-size:18px;">${e(c.logo_text ?? c.logo_image ?? 'Marca')}</strong><div style="display:flex;gap:24px;">${links.map((l) => `<a>${e(l.label)}</a>`).join('')}${c.cta_text ? `<a class="ec-btn ec-btn--primary" style="padding:8px 18px;font-size:14px;">${e(c.cta_text)}</a>` : ''}</div></nav>`;
    }

    case 'hero': {
      const layout = c.layout === 'split' && c.image ? 'split' : 'centered';
      if (layout === 'split') {
        return `<div class="ec-container" style="display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center;"><div><h1 style="margin-bottom:24px;">${e(c.headline)}</h1>${c.subheadline ? `<p style="font-size:1.125rem;color:var(--ec-muted);margin-bottom:32px;">${e(c.subheadline)}</p>` : ''}<div style="display:flex;gap:12px;flex-wrap:wrap;">${c.cta_text ? `<a class="ec-btn ec-btn--primary">${e(c.cta_text)}</a>` : ''}${c.cta_secondary_text ? `<a class="ec-btn ec-btn--secondary">${e(c.cta_secondary_text)}</a>` : ''}</div></div><img src="${e(c.image)}" style="border-radius:var(--ec-radius);aspect-ratio:4/3;object-fit:cover;" /></div>`;
      }
      return `<div class="ec-container" style="text-align:center;padding:60px 0;">${c.image ? `<img src="${e(c.image)}" style="margin:0 auto 32px;max-height:280px;border-radius:var(--ec-radius);" />` : ''}<h1 style="margin-bottom:24px;">${e(c.headline)}</h1>${c.subheadline ? `<p style="font-size:1.25rem;color:var(--ec-muted);max-width:720px;margin:0 auto 32px;">${e(c.subheadline)}</p>` : ''}<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">${c.cta_text ? `<a class="ec-btn ec-btn--primary">${e(c.cta_text)}</a>` : ''}${c.cta_secondary_text ? `<a class="ec-btn ec-btn--secondary">${e(c.cta_secondary_text)}</a>` : ''}</div></div>`;
    }

    case 'heading':
      return `<div class="ec-container" style="text-align:center;"><h2>${e(c.title)}</h2>${c.subtitle ? `<p style="font-size:1.125rem;color:var(--ec-muted);margin-top:12px;">${e(c.subtitle)}</p>` : ''}</div>`;

    case 'text':
      return `<div class="ec-container" style="text-align:${e(c.align ?? 'left')};max-width:720px;font-size:1.0625rem;line-height:1.8;">${e(c.text)}</div>`;

    case 'image':
      return `<div class="ec-container" style="text-align:center;"><img src="${e(c.url)}" alt="${e(c.alt)}" style="border-radius:var(--ec-radius);margin:0 auto;" />${c.caption ? `<p style="margin-top:12px;color:var(--ec-muted);font-size:0.875rem;">${e(c.caption)}</p>` : ''}</div>`;

    case 'benefits': {
      const items = (c.items as { icon?: string; title: string; description: string }[]) ?? [];
      const cols = items.length === 4 ? 4 : items.length === 2 ? 2 : 3;
      return `<div class="ec-container">${c.title ? `<h2 style="text-align:center;margin-bottom:48px;">${e(c.title)}</h2>` : ''}<div class="ec-grid ec-grid--${cols}">${items.map((it) => `<div style="text-align:center;padding:24px;">${it.icon ? `<div style="width:56px;height:56px;margin:0 auto 16px;background:rgba(0,229,255,0.1);border-radius:var(--ec-radius);display:flex;align-items:center;justify-content:center;font-size:28px;">${e(it.icon)}</div>` : ''}<h3 style="margin-bottom:8px;">${e(it.title)}</h3><p style="color:var(--ec-muted);">${e(it.description)}</p></div>`).join('')}</div></div>`;
    }

    case 'features': {
      const items = (c.items as string[]) ?? [];
      return `<div class="ec-container">${c.title ? `<h2 style="text-align:center;margin-bottom:32px;">${e(c.title)}</h2>` : ''}<ul style="max-width:640px;margin:0 auto;list-style:none;">${items.map((it) => `<li style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--ec-border);"><span style="color:var(--ec-accent);">✓</span><span>${e(it)}</span></li>`).join('')}</ul></div>`;
    }

    case 'stats': {
      const items = (c.items as { number: string; label: string; suffix?: string; prefix?: string }[]) ?? [];
      return `<div class="ec-container">${c.title ? `<h2 style="text-align:center;margin-bottom:48px;">${e(c.title)}</h2>` : ''}<div class="ec-grid ec-grid--${Math.min(4, items.length || 3)}" style="text-align:center;">${items.map((it) => `<div><div style="font-size:3rem;font-weight:700;color:var(--ec-primary);line-height:1;">${e(it.prefix)}${e(it.number)}${e(it.suffix)}</div><div style="margin-top:8px;color:var(--ec-muted);">${e(it.label)}</div></div>`).join('')}</div></div>`;
    }

    case 'testimonials': {
      const items = (c.items as { name: string; role?: string; text: string; stars?: number }[]) ?? [];
      return `<div class="ec-container">${c.title ? `<h2 style="text-align:center;margin-bottom:48px;">${e(c.title)}</h2>` : ''}<div class="ec-grid ec-grid--3">${items.map((t) => `<div style="background:rgba(255,255,255,0.03);border:1px solid var(--ec-border);border-radius:var(--ec-radius);padding:24px;">${t.stars ? `<div style="color:#F59E0B;margin-bottom:12px;">${'★'.repeat(t.stars)}</div>` : ''}<p style="margin-bottom:16px;">"${e(t.text)}"</p><div style="font-weight:600;">${e(t.name)}</div>${t.role ? `<div style="font-size:0.875rem;color:var(--ec-muted);">${e(t.role)}</div>` : ''}</div>`).join('')}</div></div>`;
    }

    case 'faq': {
      const items = (c.items as { question: string; answer: string }[]) ?? [];
      return `<div class="ec-container">${c.title ? `<h2 style="text-align:center;margin-bottom:48px;">${e(c.title)}</h2>` : ''}<div style="max-width:720px;margin:0 auto;">${items.map((it) => `<details style="border-bottom:1px solid var(--ec-border);padding:16px 0;"><summary style="cursor:pointer;font-weight:600;">${e(it.question)}</summary><p style="padding-top:12px;color:var(--ec-muted);">${e(it.answer)}</p></details>`).join('')}</div></div>`;
    }

    case 'cta':
      return `<div class="ec-container" style="text-align:center;padding:48px;background:linear-gradient(135deg,rgba(0,229,255,0.1),rgba(34,197,94,0.1));border-radius:var(--ec-radius);"><h2 style="margin-bottom:12px;">${e(c.title)}</h2>${c.subtitle ? `<p style="color:var(--ec-muted);margin-bottom:24px;">${e(c.subtitle)}</p>` : ''}<a class="ec-btn ec-btn--primary">${e(c.button_text ?? 'Saiba mais')}</a></div>`;

    case 'whatsapp_button':
      return `<div class="ec-container" style="text-align:center;"><a class="ec-btn" style="background:#25D366;color:#fff;display:inline-flex;align-items:center;gap:12px;">📱 ${e(c.text ?? 'Falar no WhatsApp')}</a></div>`;

    case 'product_grid': {
      const cols = (c.columns as number) ?? 3;
      return `<div class="ec-container"><h2 style="text-align:center;margin-bottom:48px;">${e(c.title ?? 'Produtos')}</h2><div class="ec-grid ec-grid--${cols}">${products.map((p) => productCard(p)).join('')}</div></div>`;
    }

    case 'product_featured': {
      const p = products[0];
      if (!p) return `<div class="ec-container" style="text-align:center;color:var(--ec-muted);">Adicione produtos pra ver o destaque.</div>`;
      const img = p.images[0] ?? '';
      return `<div class="ec-container ec-grid ec-grid--2" style="align-items:center;">${img ? `<img src="${e(img)}" style="border-radius:var(--ec-radius);" />` : ''}<div><h2 style="margin-bottom:12px;">${e(p.name)}</h2>${p.description ? `<p style="color:var(--ec-muted);margin-bottom:24px;">${e(p.description)}</p>` : ''}<div style="font-size:2rem;font-weight:700;color:var(--ec-primary);margin-bottom:24px;">${formatPrice(p.price, p.currency)}</div><button class="ec-btn ec-btn--primary">Adicionar ao carrinho</button></div></div>`;
    }

    case 'banner':
      return `<div class="ec-container" style="background:linear-gradient(135deg,var(--ec-primary),var(--ec-secondary));padding:48px;border-radius:var(--ec-radius);text-align:center;color:#000;"><h2 style="color:#000;margin-bottom:16px;">${e(c.text)}</h2>${c.cta_text ? `<a style="display:inline-block;padding:12px 32px;background:#000;color:#fff;border-radius:var(--ec-radius);font-weight:600;">${e(c.cta_text)}</a>` : ''}</div>`;

    case 'about':
      return `<div class="ec-container ec-grid ec-grid--2" style="align-items:center;">${c.image ? `<img src="${e(c.image)}" style="border-radius:var(--ec-radius);" />` : ''}<div><h2 style="margin-bottom:16px;">${e(c.title ?? 'Sobre nós')}</h2><p style="color:var(--ec-muted);font-size:1.0625rem;">${e(c.text)}</p></div></div>`;

    case 'team': {
      const items = (c.items as { name: string; role?: string; photo?: string }[]) ?? [];
      return `<div class="ec-container"><h2 style="text-align:center;margin-bottom:48px;">${e(c.title ?? 'Time')}</h2><div class="ec-grid ec-grid--${Math.min(4, items.length || 3)}" style="text-align:center;">${items.map((m) => `<div>${m.photo ? `<img src="${e(m.photo)}" style="width:120px;height:120px;border-radius:999px;object-fit:cover;margin:0 auto 12px;" />` : ''}<div style="font-weight:600;">${e(m.name)}</div>${m.role ? `<div style="font-size:0.875rem;color:var(--ec-muted);">${e(m.role)}</div>` : ''}</div>`).join('')}</div></div>`;
    }

    case 'pricing_table': {
      const plans = (c.plans as {
        name: string;
        price: string;
        period?: string;
        features: string[];
        cta_text?: string;
        highlighted?: boolean;
      }[]) ?? [];
      return `<div class="ec-container">${c.title ? `<h2 style="text-align:center;margin-bottom:48px;">${e(c.title)}</h2>` : ''}<div class="ec-grid ec-grid--${Math.min(3, plans.length || 3)}">${plans.map((p) => `<div style="background:${p.highlighted ? 'rgba(0,229,255,0.1)' : 'rgba(255,255,255,0.03)'};border:2px solid ${p.highlighted ? 'var(--ec-primary)' : 'var(--ec-border)'};border-radius:var(--ec-radius);padding:32px;"><h3>${e(p.name)}</h3><div style="font-size:2.5rem;font-weight:700;margin:8px 0 24px;">${e(p.price)}${p.period ? `<span style="font-size:1rem;color:var(--ec-muted);font-weight:400;">/${e(p.period)}</span>` : ''}</div><ul style="list-style:none;margin-bottom:24px;">${(p.features ?? []).map((f) => `<li style="padding:6px 0;color:var(--ec-muted);">✓ ${e(f)}</li>`).join('')}</ul>${p.cta_text ? `<a class="ec-btn ec-btn--primary" style="width:100%;display:block;text-align:center;">${e(p.cta_text)}</a>` : ''}</div>`).join('')}</div></div>`;
    }

    case 'countdown':
      return `<div class="ec-container" style="text-align:center;"><h2 style="margin-bottom:24px;">${e(c.title ?? 'Termina em')}</h2><div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;">${['dias', 'horas', 'min', 'seg'].map(() => `<div style="background:rgba(255,255,255,0.05);padding:16px 24px;border-radius:var(--ec-radius);min-width:90px;"><div style="font-size:2.5rem;font-weight:700;">--</div></div>`).join('')}</div></div>`;

    case 'footer': {
      const links = (c.links as { label: string; href: string }[]) ?? [];
      const social = (c.social as { network: string; url: string }[]) ?? [];
      return `<footer class="ec-container" style="border-top:1px solid var(--ec-border);padding-top:48px;"><div class="ec-grid ec-grid--3" style="margin-bottom:32px;"><div><strong style="font-size:1.25rem;">${e(c.logo)}</strong>${c.text ? `<p style="color:var(--ec-muted);margin-top:12px;font-size:0.9375rem;">${e(c.text)}</p>` : ''}</div><div><h4 style="margin-bottom:12px;">Links</h4>${links.map((l) => `<a style="display:block;color:var(--ec-muted);padding:4px 0;">${e(l.label)}</a>`).join('')}</div><div><h4 style="margin-bottom:12px;">Redes</h4>${social.map((s) => `<a style="color:var(--ec-muted);margin-right:12px;">${e(s.network)}</a>`).join('')}</div></div><div style="text-align:center;padding-top:24px;border-top:1px solid var(--ec-border);color:var(--ec-muted);font-size:0.875rem;">${e(c.copyright ?? '')}</div></footer>`;
    }

    case 'divider':
      return `<hr style="border:none;border-top:1px solid var(--ec-border);max-width:80%;margin:0 auto;" />`;

    case 'spacer':
      return `<div style="height:${Number(c.height ?? 40)}px"></div>`;

    case 'form':
      return `<div class="ec-container" style="text-align:center;">${c.title ? `<h2 style="margin-bottom:24px;">${e(c.title)}</h2>` : ''}<div style="max-width:640px;margin:0 auto;padding:48px;border:2px dashed var(--ec-border);border-radius:var(--ec-radius);color:var(--ec-muted);">📝 Formulário ${c.form_slug ? `<code>${e(c.form_slug)}</code>` : '(slug não definido)'}<br/><small>Será embedado na página publicada.</small></div></div>`;

    case 'floating_cta':
      return `<div class="ec-container" style="text-align:center;color:var(--ec-muted);font-size:0.875rem;">📱 Botão WhatsApp flutuante (aparece fixo na página publicada)</div>`;

    case 'custom_html':
      return `<div class="ec-container">${(c.html as string) ?? '<p style="color:var(--ec-muted);text-align:center;">HTML vazio</p>'}</div>`;

    case 'video': {
      const id = ((c.url as string) ?? '').match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/);
      if (id) {
        return `<div class="ec-container" style="aspect-ratio:16/9;max-width:960px;margin:0 auto;border-radius:var(--ec-radius);overflow:hidden;"><iframe src="https://www.youtube.com/embed/${id[1]}" allowfullscreen style="width:100%;height:100%;border:0;"></iframe></div>`;
      }
      return `<div class="ec-container" style="text-align:center;color:var(--ec-muted);">URL de vídeo inválida</div>`;
    }

    default:
      return `<div class="ec-container" style="text-align:center;color:var(--ec-muted);font-size:0.875rem;border:1px dashed var(--ec-border);border-radius:var(--ec-radius);padding:32px;">Bloco "${b.type}" — preview limitado, mas será renderizado corretamente na publicação.</div>`;
  }
}

function productCard(p: StoreProduct): string {
  const e = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const img = p.images[0] ?? '';
  return `<article class="ec-product">${img ? `<img src="${e(img)}" alt="${e(p.name)}" />` : '<div style="aspect-ratio:1/1;background:rgba(255,255,255,0.05);"></div>'}<div class="ec-product__body"><h3 style="font-size:1rem;margin-bottom:8px;">${e(p.name)}</h3><div class="ec-product__price">${formatPrice(p.price, p.currency)}</div><button class="ec-btn ec-btn--primary" style="width:100%;margin-top:12px;padding:10px;">Adicionar</button></div></article>`;
}

function formatPrice(value: number, currency = 'BRL'): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency });
}
