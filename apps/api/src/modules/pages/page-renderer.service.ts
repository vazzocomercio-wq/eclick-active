import { Injectable } from '@nestjs/common';
import type {
  Page,
  PageBlock,
  BlockType,
  StoreProduct,
} from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';

/**
 * Compila uma Page (blocks JSON) em HTML estático completo, otimizado pra:
 *  - Performance: CSS inline (sem requests externos exceto Google Fonts),
 *    HTML semântico, mobile-first responsive.
 *  - SEO: meta tags completas, Open Graph, structured data.
 *  - Conversão: lazy-load de imagens, scripts de analytics não-bloqueantes,
 *    botão WhatsApp flutuante opcional.
 *
 * Usado no endpoint `/p/:slug` (servido como published_html da row, sem
 * renderização runtime — fast TTFB).
 */
@Injectable()
export class PageRendererService {
  constructor(private readonly supabase: SupabaseService) {}

  async renderPage(page: Page): Promise<string> {
    // Pra páginas de loja, busca produtos pra inlinar nos blocks de produto
    let products: StoreProduct[] = [];
    if (page.page_type === 'store') {
      const { data } = await this.supabase.adminClient
        .from('store_products')
        .select('*')
        .eq('page_id', page.id)
        .eq('is_active', true)
        .order('position', { ascending: true });
      products = (data ?? []) as StoreProduct[];
    }

    const styles = this.cssVariables(page);
    const blocksHtml = page.blocks
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((block) => this.renderBlock(block, page, products))
      .join('\n');

    const head = this.renderHead(page);
    const tracking = this.renderTrackingScripts(page);
    const floatingWa = this.renderFloatingWhatsApp(page);
    const cartScript = page.page_type === 'store' ? this.renderCartScript(page) : '';

    return `<!DOCTYPE html>
<html lang="pt-BR">
${head}
<body>
<style>${styles}</style>
<main class="ec-page">
${blocksHtml}
</main>
${floatingWa}
${cartScript}
${tracking}
</body>
</html>`;
  }

  // ──────────────────────────────────────────────────────────
  // Head
  // ──────────────────────────────────────────────────────────

  private renderHead(page: Page): string {
    const seo = page.seo;
    const title = this.escape(seo.title ?? page.name);
    const description = this.escape(seo.description ?? '');
    const ogTitle = this.escape(seo.og_title ?? title);
    const ogDescription = this.escape(seo.og_description ?? description);
    const ogImage = seo.og_image ?? '';
    const favicon = seo.favicon ?? '';
    const robots = seo.robots ?? 'index, follow';

    const fonts = this.googleFontsUrl(page);

    return `<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="${robots}" />
<title>${title}</title>
${description ? `<meta name="description" content="${description}" />` : ''}

<meta property="og:type" content="website" />
<meta property="og:title" content="${ogTitle}" />
${ogDescription ? `<meta property="og:description" content="${ogDescription}" />` : ''}
${ogImage ? `<meta property="og:image" content="${this.escape(ogImage)}" />` : ''}

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${ogTitle}" />
${ogDescription ? `<meta name="twitter:description" content="${ogDescription}" />` : ''}

${favicon ? `<link rel="icon" href="${this.escape(favicon)}" />` : ''}
${fonts ? `<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin /><link rel="stylesheet" href="${fonts}" />` : ''}
${page.settings.tracking_scripts?.custom_head_html ?? ''}
</head>`;
  }

  private googleFontsUrl(page: Page): string {
    const heading = page.global_styles.font_heading;
    const body = page.global_styles.font_body;
    const families = new Set<string>();
    if (heading) families.add(heading);
    if (body && body !== heading) families.add(body);
    if (families.size === 0) return '';
    const params = Array.from(families).map(
      (f) => `family=${encodeURIComponent(f)}:wght@400;500;600;700`,
    );
    return `https://fonts.googleapis.com/css2?${params.join('&')}&display=swap`;
  }

  // ──────────────────────────────────────────────────────────
  // CSS variables + reset
  // ──────────────────────────────────────────────────────────

  private cssVariables(page: Page): string {
    const s = page.global_styles;
    return `
:root {
  --ec-primary: ${s.primary_color ?? '#00E5FF'};
  --ec-secondary: ${s.secondary_color ?? '#0EA5E9'};
  --ec-accent: ${s.accent_color ?? '#22C55E'};
  --ec-bg: ${s.background ?? '#0A0A0F'};
  --ec-text: ${s.text_color ?? '#F5F5F7'};
  --ec-muted: rgba(255,255,255,0.6);
  --ec-border: rgba(255,255,255,0.1);
  --ec-radius: ${s.border_radius ?? 8}px;
  --ec-font-heading: ${s.font_heading ? `'${s.font_heading}',` : ''} system-ui, -apple-system, sans-serif;
  --ec-font-body: ${s.font_body ? `'${s.font_body}',` : ''} system-ui, -apple-system, sans-serif;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body { background: var(--ec-bg); color: var(--ec-text); font-family: var(--ec-font-body); line-height: 1.6; -webkit-font-smoothing: antialiased; }
img, video { max-width: 100%; height: auto; display: block; }
a { color: var(--ec-primary); text-decoration: none; transition: opacity 0.15s; }
a:hover { opacity: 0.85; }
h1,h2,h3,h4,h5,h6 { font-family: var(--ec-font-heading); line-height: 1.2; font-weight: 700; }
h1 { font-size: clamp(2rem, 5vw, 3.5rem); }
h2 { font-size: clamp(1.5rem, 3vw, 2.5rem); }
h3 { font-size: clamp(1.25rem, 2vw, 1.75rem); }
.ec-page { width: 100%; }
.ec-container { width: 100%; margin: 0 auto; padding: 0 24px; }
.ec-container--sm { max-width: 640px; }
.ec-container--md { max-width: 960px; }
.ec-container--lg { max-width: 1200px; }
.ec-container--full { max-width: 100%; padding: 0; }
.ec-block { padding: 64px 0; }
.ec-block--sm { padding: 32px 0; }
.ec-block--md { padding: 64px 0; }
.ec-block--lg { padding: 96px 0; }
.ec-block--xl { padding: 128px 0; }
.ec-btn { display: inline-block; padding: 14px 28px; border-radius: var(--ec-radius); font-weight: 600; cursor: pointer; border: none; font-size: 16px; transition: transform 0.1s, box-shadow 0.15s; text-align: center; }
.ec-btn--primary { background: var(--ec-primary); color: #000; }
.ec-btn--primary:hover { transform: translateY(-1px); box-shadow: 0 8px 20px rgba(0,229,255,0.25); }
.ec-btn--secondary { background: transparent; color: var(--ec-text); border: 1.5px solid var(--ec-border); }
.ec-btn--secondary:hover { background: rgba(255,255,255,0.05); }
.ec-grid { display: grid; gap: 24px; }
.ec-grid--2 { grid-template-columns: repeat(2, 1fr); }
.ec-grid--3 { grid-template-columns: repeat(3, 1fr); }
.ec-grid--4 { grid-template-columns: repeat(4, 1fr); }
@media (max-width: 768px) {
  .ec-grid--2, .ec-grid--3, .ec-grid--4 { grid-template-columns: 1fr; }
  .ec-block { padding: 48px 0; }
  .ec-hide-mobile { display: none !important; }
}
@media (min-width: 769px) {
  .ec-hide-desktop { display: none !important; }
}
.ec-fade-in { animation: ec-fadeIn 0.6s ease-out both; }
@keyframes ec-fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
input, select, textarea { font-family: inherit; }
${this.storeStyles()}
`;
  }

  private storeStyles(): string {
    return `
.ec-product-card { background: rgba(255,255,255,0.03); border: 1px solid var(--ec-border); border-radius: var(--ec-radius); overflow: hidden; transition: transform 0.15s, border-color 0.15s; }
.ec-product-card:hover { transform: translateY(-2px); border-color: var(--ec-primary); }
.ec-product-card__img { aspect-ratio: 1/1; object-fit: cover; width: 100%; background: rgba(255,255,255,0.05); }
.ec-product-card__body { padding: 16px; }
.ec-product-card__name { font-size: 16px; font-weight: 600; margin-bottom: 8px; }
.ec-product-card__price { font-size: 20px; font-weight: 700; color: var(--ec-primary); }
.ec-product-card__compare { font-size: 14px; color: var(--ec-muted); text-decoration: line-through; margin-right: 6px; }
.ec-product-card__btn { width: 100%; margin-top: 12px; padding: 10px; border-radius: calc(var(--ec-radius) - 2px); border: none; background: var(--ec-primary); color: #000; font-weight: 600; cursor: pointer; }
.ec-cart-badge { position: relative; }
.ec-cart-badge[data-count]:not([data-count="0"])::after { content: attr(data-count); position: absolute; top: -8px; right: -8px; background: var(--ec-accent); color: #000; border-radius: 999px; min-width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; padding: 0 6px; }
`;
  }

  // ──────────────────────────────────────────────────────────
  // Block dispatch
  // ──────────────────────────────────────────────────────────

  private renderBlock(block: PageBlock, page: Page, products: StoreProduct[]): string {
    const wrapperClasses = this.blockWrapperClasses(block);
    const inner = this.renderBlockInner(block, page, products);
    const containerClass = `ec-container ec-container--${block.settings.max_width ?? 'lg'}`;
    const bgStyle = block.settings.background
      ? ` style="background: ${this.escape(block.settings.background)};"`
      : '';
    const id = block.settings.anchor_id ? ` id="${this.escape(block.settings.anchor_id)}"` : '';

    // Blocos full-bleed (navbar/footer/floating) escapam o container padrão
    if (
      block.type === 'navbar' ||
      block.type === 'footer' ||
      block.type === 'floating_cta' ||
      block.type === 'hero' ||
      block.type === 'hero_video'
    ) {
      return `<section class="${wrapperClasses}"${bgStyle}${id}>${inner}</section>`;
    }

    return `<section class="${wrapperClasses}"${bgStyle}${id}><div class="${containerClass}">${inner}</div></section>`;
  }

  private blockWrapperClasses(block: PageBlock): string {
    const classes = [`ec-block ec-block--${block.settings.padding ?? 'md'}`, `ec-block-${block.type}`];
    if (block.settings.visibility === 'desktop') classes.push('ec-hide-mobile');
    if (block.settings.visibility === 'mobile') classes.push('ec-hide-desktop');
    if (block.settings.animation === 'fade_in') classes.push('ec-fade-in');
    return classes.join(' ');
  }

  // ──────────────────────────────────────────────────────────
  // Block renderers — cada tipo
  // ──────────────────────────────────────────────────────────

  private renderBlockInner(block: PageBlock, page: Page, products: StoreProduct[]): string {
    const c = block.content;
    switch (block.type) {
      case 'navbar':
        return this.renderNavbar(c);
      case 'hero':
        return this.renderHero(c);
      case 'hero_video':
        return this.renderHeroVideo(c);
      case 'heading':
        return this.renderHeading(c);
      case 'text':
        return this.renderText(c);
      case 'image':
        return this.renderImage(c);
      case 'video':
        return this.renderVideo(c);
      case 'gallery':
        return this.renderGallery(c);
      case 'benefits':
        return this.renderBenefits(c);
      case 'features':
        return this.renderFeatures(c);
      case 'stats':
        return this.renderStats(c);
      case 'testimonials':
        return this.renderTestimonials(c);
      case 'faq':
        return this.renderFaq(c);
      case 'about':
        return this.renderAbout(c);
      case 'team':
        return this.renderTeam(c);
      case 'timeline':
        return this.renderTimeline(c);
      case 'comparison':
        return this.renderComparison(c);
      case 'countdown':
        return this.renderCountdown(c);
      case 'banner':
        return this.renderBanner(c);
      case 'divider':
        return '<hr style="border: none; border-top: 1px solid var(--ec-border); margin: 0 auto; max-width: 80%;" />';
      case 'spacer': {
        const h = (c.height as number) ?? 40;
        return `<div style="height:${h}px"></div>`;
      }
      case 'custom_html':
        // CUIDADO: HTML cru. Admin é responsável pelo conteúdo. Não escape.
        return typeof c.html === 'string' ? c.html : '';
      case 'cta':
        return this.renderCta(c);
      case 'form':
        return this.renderForm(c, page);
      case 'whatsapp_button':
        return this.renderWhatsAppButton(c);
      case 'booking':
        return this.renderBookingPlaceholder(c);
      case 'product_grid':
        return this.renderProductGrid(c, products);
      case 'product_featured':
        return this.renderProductFeatured(c, products);
      case 'product_carousel':
        return this.renderProductCarousel(c, products);
      case 'cart':
        return this.renderCartBlock();
      case 'checkout':
        return this.renderCheckoutBlock(page);
      case 'pricing_table':
        return this.renderPricingTable(c);
      case 'two_columns':
        return this.renderTwoColumns(c);
      case 'three_columns':
        return this.renderThreeColumns(c);
      case 'section':
        return this.renderSection(c);
      case 'footer':
        return this.renderFooter(c, page);
      case 'floating_cta':
        return this.renderFloatingCta(c);
      default:
        return `<!-- bloco "${block.type}" não suportado -->`;
    }
  }

  // ─── Layout/Conteúdo ───
  private renderNavbar(c: Record<string, unknown>): string {
    const logo = (c.logo_text as string) ?? (c.logo_image as string) ?? 'Marca';
    const links = (c.links as { label: string; href: string }[]) ?? [];
    const ctaText = c.cta_text as string | undefined;
    const ctaHref = (c.cta_href as string) ?? '#';
    const useImage = !!c.logo_image;

    return `<nav style="position: sticky; top: 0; z-index: 100; background: rgba(10,10,15,0.85); backdrop-filter: blur(12px); border-bottom: 1px solid var(--ec-border);">
  <div class="ec-container ec-container--lg" style="display: flex; align-items: center; justify-content: space-between; padding: 16px 24px;">
    <a href="#" style="font-size: 18px; font-weight: 700; color: var(--ec-text);">
      ${useImage ? `<img src="${this.escape(c.logo_image as string)}" alt="${this.escape(logo)}" style="height:40px;width:auto;" />` : this.escape(logo)}
    </a>
    <div style="display: flex; align-items: center; gap: 24px;" class="ec-hide-mobile">
      ${links.map((l) => `<a href="${this.escape(l.href)}" style="color: var(--ec-text); font-size: 14px;">${this.escape(l.label)}</a>`).join('')}
      ${ctaText ? `<a href="${this.escape(ctaHref)}" class="ec-btn ec-btn--primary" style="padding:8px 18px;font-size:14px;">${this.escape(ctaText)}</a>` : ''}
    </div>
  </div>
</nav>`;
  }

  private renderHero(c: Record<string, unknown>): string {
    const headline = this.escape((c.headline as string) ?? '');
    const subheadline = this.escape((c.subheadline as string) ?? '');
    const ctaText = (c.cta_text as string) ?? '';
    const ctaHref = (c.cta_href as string) ?? '#';
    const ctaSecondaryText = c.cta_secondary_text as string | undefined;
    const ctaSecondaryHref = (c.cta_secondary_href as string) ?? '#';
    const image = c.image as string | undefined;
    const layout = (c.layout as string) ?? 'centered'; // 'centered' | 'split'

    if (layout === 'split' && image) {
      return `<div class="ec-container ec-container--lg" style="padding-top: 80px; padding-bottom: 80px;">
  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: center;" class="ec-hero-split">
    <div>
      <h1 style="margin-bottom: 24px;">${headline}</h1>
      ${subheadline ? `<p style="font-size: 1.125rem; color: var(--ec-muted); margin-bottom: 32px;">${subheadline}</p>` : ''}
      <div style="display: flex; gap: 12px; flex-wrap: wrap;">
        ${ctaText ? `<a href="${this.escape(ctaHref)}" class="ec-btn ec-btn--primary">${this.escape(ctaText)}</a>` : ''}
        ${ctaSecondaryText ? `<a href="${this.escape(ctaSecondaryHref)}" class="ec-btn ec-btn--secondary">${this.escape(ctaSecondaryText)}</a>` : ''}
      </div>
    </div>
    <img src="${this.escape(image)}" alt="" loading="lazy" style="border-radius: var(--ec-radius); aspect-ratio: 4/3; object-fit: cover;" />
  </div>
</div>
<style>@media(max-width:768px){.ec-hero-split{grid-template-columns:1fr !important;}}</style>`;
    }

    return `<div class="ec-container ec-container--md" style="padding-top: 100px; padding-bottom: 100px; text-align: center;">
  ${image ? `<img src="${this.escape(image)}" alt="" loading="lazy" style="margin: 0 auto 32px; max-height: 280px; border-radius: var(--ec-radius);" />` : ''}
  <h1 style="margin-bottom: 24px;">${headline}</h1>
  ${subheadline ? `<p style="font-size: 1.25rem; color: var(--ec-muted); margin: 0 auto 32px; max-width: 720px;">${subheadline}</p>` : ''}
  <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
    ${ctaText ? `<a href="${this.escape(ctaHref)}" class="ec-btn ec-btn--primary">${this.escape(ctaText)}</a>` : ''}
    ${ctaSecondaryText ? `<a href="${this.escape(ctaSecondaryHref)}" class="ec-btn ec-btn--secondary">${this.escape(ctaSecondaryText)}</a>` : ''}
  </div>
</div>`;
  }

  private renderHeroVideo(c: Record<string, unknown>): string {
    const headline = this.escape((c.headline as string) ?? '');
    const subheadline = this.escape((c.subheadline as string) ?? '');
    const videoUrl = (c.video_url as string) ?? '';
    const ctaText = (c.cta_text as string) ?? '';
    const ctaHref = (c.cta_href as string) ?? '#';
    const embed = this.youtubeEmbedUrl(videoUrl);
    return `<div style="position:relative;min-height:600px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000;">
  ${embed ? `<iframe src="${embed}?autoplay=1&mute=1&loop=1&controls=0&playlist=${this.youtubeId(videoUrl) ?? ''}" allow="autoplay" frameborder="0" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:0.4;"></iframe>` : ''}
  <div style="position:relative;z-index:1;text-align:center;padding:80px 24px;max-width:960px;">
    <h1 style="margin-bottom:24px;">${headline}</h1>
    ${subheadline ? `<p style="font-size:1.25rem;color:var(--ec-muted);margin-bottom:32px;">${subheadline}</p>` : ''}
    ${ctaText ? `<a href="${this.escape(ctaHref)}" class="ec-btn ec-btn--primary">${this.escape(ctaText)}</a>` : ''}
  </div>
</div>`;
  }

  private renderHeading(c: Record<string, unknown>): string {
    const title = this.escape((c.title as string) ?? '');
    const sub = this.escape((c.subtitle as string) ?? '');
    return `<div style="text-align: center;">
  <h2 style="margin-bottom: ${sub ? '12px' : '0'};">${title}</h2>
  ${sub ? `<p style="font-size: 1.125rem; color: var(--ec-muted); max-width: 720px; margin: 0 auto;">${sub}</p>` : ''}
</div>`;
  }

  private renderText(c: Record<string, unknown>): string {
    const html = (c.html as string) ?? this.escape((c.text as string) ?? '');
    const align = (c.align as string) ?? 'left';
    return `<div style="text-align: ${align}; font-size: 1.0625rem; line-height: 1.8; max-width: 720px; margin: 0 auto;">${html}</div>`;
  }

  private renderImage(c: Record<string, unknown>): string {
    const url = (c.url as string) ?? '';
    const alt = this.escape((c.alt as string) ?? '');
    const caption = this.escape((c.caption as string) ?? '');
    return `<figure style="text-align: center;">
  <img src="${this.escape(url)}" alt="${alt}" loading="lazy" style="border-radius: var(--ec-radius); margin: 0 auto;" />
  ${caption ? `<figcaption style="margin-top: 12px; color: var(--ec-muted); font-size: 0.875rem;">${caption}</figcaption>` : ''}
</figure>`;
  }

  private renderVideo(c: Record<string, unknown>): string {
    const url = (c.url as string) ?? '';
    const embed = this.youtubeEmbedUrl(url);
    if (!embed) return '';
    return `<div style="aspect-ratio: 16/9; max-width: 960px; margin: 0 auto; border-radius: var(--ec-radius); overflow: hidden;">
  <iframe src="${embed}" allowfullscreen frameborder="0" style="width: 100%; height: 100%;"></iframe>
</div>`;
  }

  private renderGallery(c: Record<string, unknown>): string {
    const items = (c.images as { url: string; alt?: string }[]) ?? [];
    return `<div class="ec-grid ec-grid--3">
  ${items
    .map(
      (i) => `<img src="${this.escape(i.url)}" alt="${this.escape(i.alt ?? '')}" loading="lazy" style="border-radius: var(--ec-radius); aspect-ratio: 1/1; object-fit: cover;" />`,
    )
    .join('')}
</div>`;
  }

  private renderBenefits(c: Record<string, unknown>): string {
    const title = this.escape((c.title as string) ?? '');
    const items = (c.items as { icon?: string; title: string; description: string }[]) ?? [];
    const cols = items.length === 4 ? 4 : items.length === 2 ? 2 : 3;
    return `${title ? `<h2 style="text-align: center; margin-bottom: 48px;">${title}</h2>` : ''}
<div class="ec-grid ec-grid--${cols}">
  ${items
    .map(
      (it) => `<div style="text-align: center; padding: 24px;">
    ${it.icon ? `<div style="width: 56px; height: 56px; margin: 0 auto 16px; background: rgba(0,229,255,0.1); border-radius: var(--ec-radius); display: flex; align-items: center; justify-content: center; font-size: 28px;">${this.escape(it.icon)}</div>` : ''}
    <h3 style="font-size: 1.25rem; margin-bottom: 8px;">${this.escape(it.title)}</h3>
    <p style="color: var(--ec-muted); font-size: 0.9375rem;">${this.escape(it.description)}</p>
  </div>`,
    )
    .join('')}
</div>`;
  }

  private renderFeatures(c: Record<string, unknown>): string {
    const title = this.escape((c.title as string) ?? '');
    const items = (c.items as string[]) ?? [];
    return `${title ? `<h2 style="text-align: center; margin-bottom: 32px;">${title}</h2>` : ''}
<ul style="max-width: 640px; margin: 0 auto; list-style: none;">
  ${items
    .map(
      (it) => `<li style="display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--ec-border);">
    <span style="color: var(--ec-accent); flex-shrink: 0;">✓</span>
    <span>${this.escape(it)}</span>
  </li>`,
    )
    .join('')}
</ul>`;
  }

  private renderStats(c: Record<string, unknown>): string {
    const title = this.escape((c.title as string) ?? '');
    const items =
      (c.items as { number: string | number; label: string; suffix?: string; prefix?: string }[]) ??
      [];
    return `${title ? `<h2 style="text-align: center; margin-bottom: 48px;">${title}</h2>` : ''}
<div class="ec-grid ec-grid--${items.length > 4 ? 4 : items.length}" style="text-align: center;">
  ${items
    .map(
      (it) => `<div>
    <div style="font-size: 3rem; font-weight: 700; color: var(--ec-primary); line-height: 1;">${this.escape(String(it.prefix ?? ''))}${this.escape(String(it.number))}${this.escape(String(it.suffix ?? ''))}</div>
    <div style="margin-top: 8px; color: var(--ec-muted);">${this.escape(it.label)}</div>
  </div>`,
    )
    .join('')}
</div>`;
  }

  private renderTestimonials(c: Record<string, unknown>): string {
    const title = this.escape((c.title as string) ?? '');
    const items =
      (c.items as {
        name: string;
        role?: string;
        company?: string;
        text: string;
        photo?: string;
        stars?: number;
      }[]) ?? [];
    return `${title ? `<h2 style="text-align: center; margin-bottom: 48px;">${title}</h2>` : ''}
<div class="ec-grid ec-grid--${items.length > 3 ? 3 : items.length}">
  ${items
    .map(
      (t) => `<div style="background: rgba(255,255,255,0.03); border: 1px solid var(--ec-border); border-radius: var(--ec-radius); padding: 24px;">
    ${t.stars ? `<div style="color: #F59E0B; margin-bottom: 12px;">${'★'.repeat(Math.min(5, t.stars))}${'☆'.repeat(Math.max(0, 5 - t.stars))}</div>` : ''}
    <p style="margin-bottom: 16px; line-height: 1.6;">"${this.escape(t.text)}"</p>
    <div style="display: flex; align-items: center; gap: 12px;">
      ${t.photo ? `<img src="${this.escape(t.photo)}" alt="${this.escape(t.name)}" style="width: 40px; height: 40px; border-radius: 999px; object-fit: cover;" />` : ''}
      <div>
        <div style="font-weight: 600;">${this.escape(t.name)}</div>
        ${t.role || t.company ? `<div style="font-size: 0.875rem; color: var(--ec-muted);">${this.escape([t.role, t.company].filter(Boolean).join(' · '))}</div>` : ''}
      </div>
    </div>
  </div>`,
    )
    .join('')}
</div>`;
  }

  private renderFaq(c: Record<string, unknown>): string {
    const title = this.escape((c.title as string) ?? '');
    const items = (c.items as { question: string; answer: string }[]) ?? [];
    return `${title ? `<h2 style="text-align: center; margin-bottom: 48px;">${title}</h2>` : ''}
<div style="max-width: 720px; margin: 0 auto;">
  ${items
    .map(
      (it) => `<details style="border-bottom: 1px solid var(--ec-border); padding: 16px 0;">
    <summary style="cursor: pointer; font-weight: 600; font-size: 1.0625rem; list-style: none; display: flex; justify-content: space-between; align-items: center;">
      ${this.escape(it.question)}
      <span style="font-size: 1.5rem; line-height: 1;">+</span>
    </summary>
    <p style="padding-top: 12px; color: var(--ec-muted); line-height: 1.7;">${this.escape(it.answer)}</p>
  </details>`,
    )
    .join('')}
</div>
<style>details[open] summary > span { transform: rotate(45deg); transition: transform 0.2s; }</style>`;
  }

  private renderAbout(c: Record<string, unknown>): string {
    const title = this.escape((c.title as string) ?? 'Sobre nós');
    const text = this.escape((c.text as string) ?? '');
    const image = c.image as string | undefined;
    return `<div class="ec-grid ec-grid--2" style="align-items: center;">
  ${image ? `<img src="${this.escape(image)}" alt="" loading="lazy" style="border-radius: var(--ec-radius);" />` : ''}
  <div>
    <h2 style="margin-bottom: 16px;">${title}</h2>
    <p style="color: var(--ec-muted); font-size: 1.0625rem; line-height: 1.7;">${text}</p>
  </div>
</div>`;
  }

  private renderTeam(c: Record<string, unknown>): string {
    const title = this.escape((c.title as string) ?? 'Nosso time');
    const items =
      (c.items as { name: string; role?: string; photo?: string; bio?: string }[]) ?? [];
    return `<h2 style="text-align: center; margin-bottom: 48px;">${title}</h2>
<div class="ec-grid ec-grid--${items.length > 3 ? 4 : items.length}" style="text-align: center;">
  ${items
    .map(
      (m) => `<div>
    ${m.photo ? `<img src="${this.escape(m.photo)}" alt="${this.escape(m.name)}" style="width: 120px; height: 120px; border-radius: 999px; object-fit: cover; margin: 0 auto 12px;" />` : ''}
    <div style="font-weight: 600;">${this.escape(m.name)}</div>
    ${m.role ? `<div style="font-size: 0.875rem; color: var(--ec-muted);">${this.escape(m.role)}</div>` : ''}
  </div>`,
    )
    .join('')}
</div>`;
  }

  private renderTimeline(c: Record<string, unknown>): string {
    const title = this.escape((c.title as string) ?? '');
    const items =
      (c.items as { step?: string | number; title: string; description: string }[]) ?? [];
    return `${title ? `<h2 style="text-align: center; margin-bottom: 48px;">${title}</h2>` : ''}
<div style="max-width: 720px; margin: 0 auto; position: relative;">
  ${items
    .map(
      (it, idx) => `<div style="display: flex; gap: 24px; padding: 24px 0; ${idx < items.length - 1 ? 'border-bottom: 1px solid var(--ec-border);' : ''}">
    <div style="flex-shrink: 0; width: 48px; height: 48px; border-radius: 999px; background: var(--ec-primary); color: #000; display: flex; align-items: center; justify-content: center; font-weight: 700;">${this.escape(String(it.step ?? idx + 1))}</div>
    <div>
      <h3 style="margin-bottom: 8px;">${this.escape(it.title)}</h3>
      <p style="color: var(--ec-muted);">${this.escape(it.description)}</p>
    </div>
  </div>`,
    )
    .join('')}
</div>`;
  }

  private renderComparison(c: Record<string, unknown>): string {
    const title = this.escape((c.title as string) ?? '');
    const headers = (c.headers as string[]) ?? [];
    const rows = (c.rows as string[][]) ?? [];
    return `${title ? `<h2 style="text-align: center; margin-bottom: 48px;">${title}</h2>` : ''}
<div style="overflow-x: auto;">
<table style="width: 100%; border-collapse: collapse;">
  <thead>
    <tr>${headers.map((h) => `<th style="padding: 16px; text-align: left; border-bottom: 2px solid var(--ec-border);">${this.escape(h)}</th>`).join('')}</tr>
  </thead>
  <tbody>
    ${rows
      .map(
        (r) => `<tr>${r
          .map(
            (cell) =>
              `<td style="padding: 14px 16px; border-bottom: 1px solid var(--ec-border);">${this.escape(cell)}</td>`,
          )
          .join('')}</tr>`,
      )
      .join('')}
  </tbody>
</table>
</div>`;
  }

  private renderCountdown(c: Record<string, unknown>): string {
    const title = this.escape((c.title as string) ?? 'Oferta termina em');
    const targetDate = (c.target_date as string) ?? '';
    return `<div style="text-align: center;">
  <h2 style="margin-bottom: 24px;">${title}</h2>
  <div id="ec-countdown" data-target="${this.escape(targetDate)}" style="display: flex; gap: 16px; justify-content: center; flex-wrap: wrap;">
    <div style="background: rgba(255,255,255,0.05); padding: 16px 24px; border-radius: var(--ec-radius); min-width: 100px;"><div data-count="d" style="font-size: 2.5rem; font-weight: 700;">--</div><div style="color: var(--ec-muted); font-size: 0.875rem;">dias</div></div>
    <div style="background: rgba(255,255,255,0.05); padding: 16px 24px; border-radius: var(--ec-radius); min-width: 100px;"><div data-count="h" style="font-size: 2.5rem; font-weight: 700;">--</div><div style="color: var(--ec-muted); font-size: 0.875rem;">horas</div></div>
    <div style="background: rgba(255,255,255,0.05); padding: 16px 24px; border-radius: var(--ec-radius); min-width: 100px;"><div data-count="m" style="font-size: 2.5rem; font-weight: 700;">--</div><div style="color: var(--ec-muted); font-size: 0.875rem;">min</div></div>
    <div style="background: rgba(255,255,255,0.05); padding: 16px 24px; border-radius: var(--ec-radius); min-width: 100px;"><div data-count="s" style="font-size: 2.5rem; font-weight: 700;">--</div><div style="color: var(--ec-muted); font-size: 0.875rem;">seg</div></div>
  </div>
</div>
<script>
(function(){var el=document.getElementById('ec-countdown');if(!el)return;var t=new Date(el.dataset.target).getTime();function tick(){var d=t-Date.now();if(d<0){el.innerHTML='<div style=\\'font-size:1.5rem;color:var(--ec-muted);\\'>Encerrado</div>';return;}var s=Math.floor(d/1000)%60,m=Math.floor(d/60000)%60,h=Math.floor(d/3600000)%24,dd=Math.floor(d/86400000);el.querySelector('[data-count=d]').textContent=String(dd).padStart(2,'0');el.querySelector('[data-count=h]').textContent=String(h).padStart(2,'0');el.querySelector('[data-count=m]').textContent=String(m).padStart(2,'0');el.querySelector('[data-count=s]').textContent=String(s).padStart(2,'0');}tick();setInterval(tick,1000);})();
</script>`;
  }

  private renderBanner(c: Record<string, unknown>): string {
    const text = this.escape((c.text as string) ?? '');
    const ctaText = c.cta_text as string | undefined;
    const ctaHref = (c.cta_href as string) ?? '#';
    return `<div style="background: linear-gradient(135deg, var(--ec-primary), var(--ec-secondary)); padding: 48px; border-radius: var(--ec-radius); text-align: center; color: #000;">
  <h2 style="margin-bottom: 16px; color: #000;">${text}</h2>
  ${ctaText ? `<a href="${this.escape(ctaHref)}" style="display: inline-block; padding: 12px 32px; background: #000; color: #fff; border-radius: var(--ec-radius); font-weight: 600;">${this.escape(ctaText)}</a>` : ''}
</div>`;
  }

  private renderCta(c: Record<string, unknown>): string {
    const title = this.escape((c.title as string) ?? '');
    const subtitle = this.escape((c.subtitle as string) ?? '');
    const text = (c.button_text as string) ?? 'Saiba mais';
    const href = (c.button_href as string) ?? '#';
    return `<div style="text-align: center; padding: 48px 24px; background: linear-gradient(135deg, rgba(0,229,255,0.1), rgba(34,197,94,0.1)); border-radius: var(--ec-radius); border: 1px solid var(--ec-border);">
  <h2 style="margin-bottom: 12px;">${title}</h2>
  ${subtitle ? `<p style="color: var(--ec-muted); margin-bottom: 24px;">${subtitle}</p>` : ''}
  <a href="${this.escape(href)}" class="ec-btn ec-btn--primary">${this.escape(text)}</a>
</div>`;
  }

  private renderForm(c: Record<string, unknown>, _page: Page): string {
    const title = this.escape((c.title as string) ?? '');
    const formId = c.form_id as string | undefined;
    const formSlug = c.form_slug as string | undefined;
    if (!formSlug && !formId) {
      return `<div style="text-align: center; color: var(--ec-muted);">Formulário não configurado.</div>`;
    }
    // Preferimos slug — embeda /f/:slug via iframe
    const slug = formSlug ?? formId; // fallback para id se slug não veio
    return `${title ? `<h2 style="text-align: center; margin-bottom: 24px;">${title}</h2>` : ''}
<div style="max-width: 640px; margin: 0 auto;">
  <iframe src="/f/${this.escape(slug ?? '')}" loading="lazy" style="width: 100%; min-height: 700px; border: none; border-radius: var(--ec-radius);"></iframe>
</div>`;
  }

  private renderWhatsAppButton(c: Record<string, unknown>): string {
    const phone = (c.phone as string) ?? '';
    const message = (c.message as string) ?? 'Olá! Quero saber mais.';
    const text = (c.text as string) ?? 'Falar no WhatsApp';
    const url = `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
    return `<div style="text-align: center;">
  <a href="${this.escape(url)}" target="_blank" rel="noopener" style="display: inline-flex; align-items: center; gap: 12px; padding: 16px 32px; background: #25D366; color: #fff; border-radius: var(--ec-radius); font-weight: 600; font-size: 1.0625rem;">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" /></svg>
    ${this.escape(text)}
  </a>
</div>`;
  }

  private renderBookingPlaceholder(c: Record<string, unknown>): string {
    const title = this.escape((c.title as string) ?? 'Agende um horário');
    return `<div style="text-align: center; padding: 48px; border: 2px dashed var(--ec-border); border-radius: var(--ec-radius);">
  <h2 style="margin-bottom: 16px;">${title}</h2>
  <p style="color: var(--ec-muted);">Widget de agendamento integrado em breve.</p>
</div>`;
  }

  // ─── Loja ───
  private renderProductGrid(c: Record<string, unknown>, products: StoreProduct[]): string {
    const title = this.escape((c.title as string) ?? 'Produtos');
    const cols = (c.columns as number) ?? 3;
    return `<h2 style="text-align: center; margin-bottom: 48px;">${title}</h2>
<div class="ec-grid ec-grid--${cols}">
  ${products.map((p) => this.renderProductCard(p)).join('')}
</div>`;
  }

  private renderProductFeatured(_c: Record<string, unknown>, products: StoreProduct[]): string {
    const p = products[0];
    if (!p) return '';
    const img = p.images[0] ?? '';
    return `<div class="ec-grid ec-grid--2" style="align-items: center;">
  ${img ? `<img src="${this.escape(img)}" alt="${this.escape(p.name)}" loading="lazy" style="border-radius: var(--ec-radius);" />` : ''}
  <div>
    <h2 style="margin-bottom: 12px;">${this.escape(p.name)}</h2>
    ${p.description ? `<p style="color: var(--ec-muted); margin-bottom: 24px;">${this.escape(p.description)}</p>` : ''}
    <div style="display: flex; align-items: baseline; gap: 12px; margin-bottom: 24px;">
      ${p.compare_at_price ? `<span class="ec-product-card__compare">${this.formatPrice(p.compare_at_price, p.currency)}</span>` : ''}
      <span style="font-size: 2rem; font-weight: 700; color: var(--ec-primary);">${this.formatPrice(p.price, p.currency)}</span>
    </div>
    <button class="ec-btn ec-btn--primary" data-add-cart="${p.id}" data-name="${this.escape(p.name)}" data-price="${p.price}" data-image="${this.escape(img)}">Adicionar ao carrinho</button>
  </div>
</div>`;
  }

  private renderProductCarousel(_c: Record<string, unknown>, products: StoreProduct[]): string {
    return `<div style="display: flex; gap: 16px; overflow-x: auto; padding-bottom: 16px;">
  ${products.map((p) => `<div style="min-width: 280px; max-width: 280px;">${this.renderProductCard(p)}</div>`).join('')}
</div>`;
  }

  private renderProductCard(p: StoreProduct): string {
    const img = p.images[0] ?? '';
    return `<article class="ec-product-card">
  ${img ? `<img src="${this.escape(img)}" alt="${this.escape(p.name)}" loading="lazy" class="ec-product-card__img" />` : '<div class="ec-product-card__img"></div>'}
  <div class="ec-product-card__body">
    <h3 class="ec-product-card__name">${this.escape(p.name)}</h3>
    <div>
      ${p.compare_at_price ? `<span class="ec-product-card__compare">${this.formatPrice(p.compare_at_price, p.currency)}</span>` : ''}
      <span class="ec-product-card__price">${this.formatPrice(p.price, p.currency)}</span>
    </div>
    <button class="ec-product-card__btn" data-add-cart="${p.id}" data-name="${this.escape(p.name)}" data-price="${p.price}" data-image="${this.escape(img)}">Adicionar</button>
  </div>
</article>`;
  }

  private renderCartBlock(): string {
    return `<div id="ec-cart-section" style="max-width: 720px; margin: 0 auto;">
  <h2 style="text-align: center; margin-bottom: 32px;">Seu carrinho</h2>
  <div id="ec-cart-items" style="margin-bottom: 24px;"></div>
  <div id="ec-cart-empty" style="text-align: center; color: var(--ec-muted); padding: 48px;">Seu carrinho está vazio.</div>
  <div id="ec-cart-summary" style="display: none; padding: 24px; border-top: 1px solid var(--ec-border);">
    <div style="display: flex; justify-content: space-between; margin-bottom: 12px;"><span>Subtotal</span><strong id="ec-cart-subtotal">R$ 0</strong></div>
    <a href="#checkout" class="ec-btn ec-btn--primary" style="display: block; text-align: center;">Ir pro checkout</a>
  </div>
</div>`;
  }

  private renderCheckoutBlock(page: Page): string {
    const adminPhone = (page.settings.store?.admin_phone ?? '').replace(/\D/g, '');
    const pixKey = page.settings.store?.pix_key ?? '';
    return `<div id="checkout" style="max-width: 720px; margin: 0 auto;">
  <h2 style="text-align: center; margin-bottom: 32px;">Finalizar pedido</h2>
  <form id="ec-checkout-form" style="display: flex; flex-direction: column; gap: 16px;">
    <div><label style="display:block;font-size:14px;margin-bottom:6px;">Nome completo*</label><input name="customer_name" required style="width:100%;padding:12px;background:rgba(255,255,255,0.03);border:1px solid var(--ec-border);border-radius:var(--ec-radius);color:var(--ec-text);" /></div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
      <div><label style="display:block;font-size:14px;margin-bottom:6px;">Email</label><input name="customer_email" type="email" style="width:100%;padding:12px;background:rgba(255,255,255,0.03);border:1px solid var(--ec-border);border-radius:var(--ec-radius);color:var(--ec-text);" /></div>
      <div><label style="display:block;font-size:14px;margin-bottom:6px;">Telefone*</label><input name="customer_phone" required style="width:100%;padding:12px;background:rgba(255,255,255,0.03);border:1px solid var(--ec-border);border-radius:var(--ec-radius);color:var(--ec-text);" /></div>
    </div>
    <div><label style="display:block;font-size:14px;margin-bottom:6px;">CEP</label><input name="cep" maxlength="9" style="width:140px;padding:12px;background:rgba(255,255,255,0.03);border:1px solid var(--ec-border);border-radius:var(--ec-radius);color:var(--ec-text);" /></div>
    <div><label style="display:block;font-size:14px;margin-bottom:6px;">Endereço</label><input name="street" style="width:100%;padding:12px;background:rgba(255,255,255,0.03);border:1px solid var(--ec-border);border-radius:var(--ec-radius);color:var(--ec-text);" /></div>
    <div style="display: grid; grid-template-columns: 100px 1fr; gap: 12px;">
      <div><label style="display:block;font-size:14px;margin-bottom:6px;">Nº</label><input name="number" style="width:100%;padding:12px;background:rgba(255,255,255,0.03);border:1px solid var(--ec-border);border-radius:var(--ec-radius);color:var(--ec-text);" /></div>
      <div><label style="display:block;font-size:14px;margin-bottom:6px;">Complemento</label><input name="complement" style="width:100%;padding:12px;background:rgba(255,255,255,0.03);border:1px solid var(--ec-border);border-radius:var(--ec-radius);color:var(--ec-text);" /></div>
    </div>
    <div><label style="display:block;font-size:14px;margin-bottom:6px;">Observações</label><textarea name="notes" rows="3" style="width:100%;padding:12px;background:rgba(255,255,255,0.03);border:1px solid var(--ec-border);border-radius:var(--ec-radius);color:var(--ec-text);"></textarea></div>
    <div id="ec-checkout-summary" style="background: rgba(255,255,255,0.03); padding: 16px; border-radius: var(--ec-radius);"></div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;">
      ${adminPhone ? `<button type="button" data-pay="whatsapp" class="ec-btn ec-btn--primary" style="flex:1;background:#25D366;color:#fff;">Finalizar via WhatsApp</button>` : ''}
      ${pixKey ? `<button type="button" data-pay="pix" class="ec-btn ec-btn--secondary" style="flex:1;">Pagar com PIX</button>` : ''}
    </div>
    <div id="ec-pix-detail" style="display:none;background:rgba(34,197,94,0.1);border:1px solid var(--ec-accent);padding:16px;border-radius:var(--ec-radius);">
      <strong>Chave PIX:</strong> <span id="ec-pix-key">${this.escape(pixKey)}</span>
      <button type="button" id="ec-pix-copy" style="margin-left:12px;padding:6px 12px;background:var(--ec-accent);color:#000;border:none;border-radius:6px;cursor:pointer;">Copiar</button>
      <p style="margin-top:8px;font-size:14px;color:var(--ec-muted);">Após pagar, clique abaixo pra confirmar e enviar comprovante via WhatsApp.</p>
      <button type="button" data-pay="pix-confirm" class="ec-btn ec-btn--primary" style="margin-top:12px;">Já paguei — confirmar pedido</button>
    </div>
  </form>
</div>`;
  }

  private renderPricingTable(c: Record<string, unknown>): string {
    const title = this.escape((c.title as string) ?? '');
    const plans =
      (c.plans as {
        name: string;
        price: string;
        period?: string;
        features: string[];
        cta_text?: string;
        cta_href?: string;
        highlighted?: boolean;
      }[]) ?? [];
    return `${title ? `<h2 style="text-align: center; margin-bottom: 48px;">${title}</h2>` : ''}
<div class="ec-grid ec-grid--${plans.length > 3 ? 3 : plans.length}">
  ${plans
    .map(
      (p) => `<div style="background: ${p.highlighted ? 'rgba(0,229,255,0.1)' : 'rgba(255,255,255,0.03)'}; border: 2px solid ${p.highlighted ? 'var(--ec-primary)' : 'var(--ec-border)'}; border-radius: var(--ec-radius); padding: 32px; ${p.highlighted ? 'transform: scale(1.02);' : ''}">
    <h3 style="margin-bottom: 8px;">${this.escape(p.name)}</h3>
    <div style="font-size: 2.5rem; font-weight: 700; margin-bottom: 24px;">${this.escape(p.price)}${p.period ? `<span style="font-size: 1rem; color: var(--ec-muted); font-weight: 400;">/${this.escape(p.period)}</span>` : ''}</div>
    <ul style="list-style: none; margin-bottom: 24px;">${p.features.map((f) => `<li style="padding: 6px 0; color: var(--ec-muted);">✓ ${this.escape(f)}</li>`).join('')}</ul>
    ${p.cta_text ? `<a href="${this.escape(p.cta_href ?? '#')}" class="ec-btn ec-btn--primary" style="width: 100%; display: block; text-align: center;">${this.escape(p.cta_text)}</a>` : ''}
  </div>`,
    )
    .join('')}
</div>`;
  }

  private renderTwoColumns(c: Record<string, unknown>): string {
    const left = (c.left as string) ?? '';
    const right = (c.right as string) ?? '';
    return `<div class="ec-grid ec-grid--2">
  <div>${left}</div>
  <div>${right}</div>
</div>`;
  }

  private renderThreeColumns(c: Record<string, unknown>): string {
    const cols = (c.columns as string[]) ?? [];
    return `<div class="ec-grid ec-grid--3">
  ${cols.map((col) => `<div>${col}</div>`).join('')}
</div>`;
  }

  private renderSection(c: Record<string, unknown>): string {
    const title = this.escape((c.title as string) ?? '');
    const html = (c.html as string) ?? '';
    return `${title ? `<h2 style="text-align: center; margin-bottom: 24px;">${title}</h2>` : ''}<div>${html}</div>`;
  }

  private renderFooter(c: Record<string, unknown>, _page: Page): string {
    const logo = (c.logo as string) ?? '';
    const text = this.escape((c.text as string) ?? '');
    const links = (c.links as { label: string; href: string }[]) ?? [];
    const social = (c.social as { network: string; url: string }[]) ?? [];
    const copyright = this.escape(
      (c.copyright as string) ?? `© ${new Date().getFullYear()} Todos os direitos reservados.`,
    );
    return `<footer style="border-top: 1px solid var(--ec-border); padding: 48px 24px; background: rgba(0,0,0,0.4);">
  <div class="ec-container ec-container--lg">
    <div class="ec-grid ec-grid--3" style="margin-bottom: 32px;">
      <div>
        ${logo ? `<div style="font-size: 1.25rem; font-weight: 700; margin-bottom: 12px;">${this.escape(logo)}</div>` : ''}
        ${text ? `<p style="color: var(--ec-muted); font-size: 0.9375rem;">${text}</p>` : ''}
      </div>
      <div>
        <h4 style="margin-bottom: 12px; font-size: 1rem;">Links</h4>
        ${links.map((l) => `<a href="${this.escape(l.href)}" style="display: block; color: var(--ec-muted); padding: 4px 0;">${this.escape(l.label)}</a>`).join('')}
      </div>
      <div>
        <h4 style="margin-bottom: 12px; font-size: 1rem;">Redes</h4>
        <div style="display: flex; gap: 12px;">${social.map((s) => `<a href="${this.escape(s.url)}" target="_blank" rel="noopener" style="color: var(--ec-muted); text-transform: capitalize;">${this.escape(s.network)}</a>`).join('')}</div>
      </div>
    </div>
    <div style="text-align: center; padding-top: 24px; border-top: 1px solid var(--ec-border); color: var(--ec-muted); font-size: 0.875rem;">${copyright}</div>
  </div>
</footer>`;
  }

  private renderFloatingCta(c: Record<string, unknown>): string {
    const type = (c.type as string) ?? 'whatsapp';
    if (type === 'whatsapp') {
      const phone = ((c.phone as string) ?? '').replace(/\D/g, '');
      const message = (c.message as string) ?? '';
      return `<a href="https://wa.me/${phone}?text=${encodeURIComponent(message)}" target="_blank" rel="noopener" style="position: fixed; bottom: 24px; right: 24px; width: 60px; height: 60px; background: #25D366; color: #fff; border-radius: 999px; display: flex; align-items: center; justify-content: center; box-shadow: 0 6px 20px rgba(37,211,102,0.4); z-index: 99;" aria-label="WhatsApp">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" /></svg>
      </a>`;
    }
    return '';
  }

  // ──────────────────────────────────────────────────────────
  // Floating WhatsApp global (settings-driven, independente do block)
  // ──────────────────────────────────────────────────────────
  private renderFloatingWhatsApp(page: Page): string {
    const cfg = page.settings.whatsapp_floating;
    if (!cfg?.enabled || !cfg.phone) return '';
    const phone = cfg.phone.replace(/\D/g, '');
    const msg = cfg.message ?? 'Olá! Vim através do site.';
    const pos = cfg.position === 'bottom_left' ? 'left: 24px;' : 'right: 24px;';
    return `<a href="https://wa.me/${phone}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener" style="position:fixed;bottom:24px;${pos}width:60px;height:60px;background:#25D366;color:#fff;border-radius:999px;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(37,211,102,0.4);z-index:99;" aria-label="WhatsApp">
  <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" /></svg>
</a>`;
  }

  // ──────────────────────────────────────────────────────────
  // Tracking scripts (GA, FB Pixel, etc) — injetados ao final do <body>
  // ──────────────────────────────────────────────────────────
  private renderTrackingScripts(page: Page): string {
    const t = page.settings.tracking_scripts;
    if (!t) return '';
    let out = '';
    if (t.google_analytics_id) {
      out += `<script async src="https://www.googletagmanager.com/gtag/js?id=${this.escape(t.google_analytics_id)}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${this.escape(t.google_analytics_id)}');</script>`;
    }
    if (t.facebook_pixel_id) {
      out += `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${this.escape(t.facebook_pixel_id)}');fbq('track','PageView');</script>`;
    }
    if (t.tiktok_pixel_id) {
      out += `<script>!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('${this.escape(t.tiktok_pixel_id)}');ttq.page();}(window,document,'ttq');</script>`;
    }
    return out;
  }

  // ──────────────────────────────────────────────────────────
  // Cart script — client-side (localStorage) pra páginas tipo store
  // ──────────────────────────────────────────────────────────
  private renderCartScript(page: Page): string {
    const apiUrl = process.env.PUBLIC_API_URL ?? '';
    const slug = page.slug;
    const adminPhone = (page.settings.store?.admin_phone ?? '').replace(/\D/g, '');
    const waMsgTemplate =
      page.settings.store?.whatsapp_after_order ??
      'Olá! Acabei de fazer um pedido na loja:\n{summary}\nTotal: {total}\nNome: {customer_name}';
    return `<script>
(function(){
  var KEY='ec_cart_${slug}';
  function getCart(){try{return JSON.parse(localStorage.getItem(KEY)||'[]');}catch(e){return [];}}
  function setCart(c){localStorage.setItem(KEY,JSON.stringify(c));render();}
  function format(v){return 'R$ '+Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});}
  function add(p){var c=getCart();var ex=c.find(function(x){return x.product_id===p.product_id;});if(ex){ex.quantity+=1;}else{c.push({product_id:p.product_id,name:p.name,price:Number(p.price),image:p.image,quantity:1});}setCart(c);}
  function remove(id){setCart(getCart().filter(function(x){return x.product_id!==id;}));}
  function setQty(id,q){var c=getCart();var i=c.find(function(x){return x.product_id===id;});if(i){i.quantity=Math.max(1,q);}setCart(c);}
  function subtotal(){return getCart().reduce(function(s,i){return s+i.price*i.quantity;},0);}
  function render(){
    var count=getCart().reduce(function(s,i){return s+i.quantity;},0);
    document.querySelectorAll('[data-cart-count]').forEach(function(el){el.dataset.count=count;el.setAttribute('data-count',count);});
    var items=document.getElementById('ec-cart-items');var summary=document.getElementById('ec-cart-summary');var empty=document.getElementById('ec-cart-empty');var sub=document.getElementById('ec-cart-subtotal');
    if(items){
      var c=getCart();
      if(c.length===0){items.innerHTML='';if(empty)empty.style.display='block';if(summary)summary.style.display='none';}
      else {if(empty)empty.style.display='none';if(summary)summary.style.display='block';
        items.innerHTML=c.map(function(i){return '<div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--ec-border);align-items:center;">'+(i.image?'<img src="'+i.image+'" style="width:60px;height:60px;object-fit:cover;border-radius:8px;" />':'')+'<div style="flex:1;"><div style="font-weight:600;">'+i.name+'</div><div style="color:var(--ec-muted);font-size:14px;">'+format(i.price)+'</div></div><div><button data-qty-dec="'+i.product_id+'" style="width:28px;height:28px;background:rgba(255,255,255,0.05);border:1px solid var(--ec-border);color:var(--ec-text);border-radius:6px;cursor:pointer;">-</button><span style="margin:0 12px;">'+i.quantity+'</span><button data-qty-inc="'+i.product_id+'" style="width:28px;height:28px;background:rgba(255,255,255,0.05);border:1px solid var(--ec-border);color:var(--ec-text);border-radius:6px;cursor:pointer;">+</button></div><button data-cart-remove="'+i.product_id+'" style="background:none;border:none;color:var(--ec-muted);cursor:pointer;font-size:20px;margin-left:12px;">&times;</button></div>';}).join('');
        if(sub)sub.textContent=format(subtotal());
      }
    }
    var cs=document.getElementById('ec-checkout-summary');
    if(cs){var c=getCart();cs.innerHTML='<strong>Resumo do pedido</strong><div style="margin-top:8px;">'+c.map(function(i){return '<div style="display:flex;justify-content:space-between;font-size:14px;padding:4px 0;"><span>'+i.quantity+'x '+i.name+'</span><span>'+format(i.price*i.quantity)+'</span></div>';}).join('')+'</div><div style="display:flex;justify-content:space-between;font-weight:700;border-top:1px solid var(--ec-border);margin-top:12px;padding-top:12px;"><span>Total</span><span>'+format(subtotal())+'</span></div>';}
  }
  document.addEventListener('click',function(e){
    var add_=e.target.closest('[data-add-cart]');if(add_){add({product_id:add_.dataset.addCart,name:add_.dataset.name,price:add_.dataset.price,image:add_.dataset.image});var t=add_.textContent;add_.textContent='Adicionado!';setTimeout(function(){add_.textContent=t;},1200);return;}
    var rem=e.target.closest('[data-cart-remove]');if(rem){remove(rem.dataset.cartRemove);return;}
    var inc=e.target.closest('[data-qty-inc]');if(inc){var c=getCart().find(function(x){return x.product_id===inc.dataset.qtyInc;});if(c)setQty(inc.dataset.qtyInc,c.quantity+1);return;}
    var dec=e.target.closest('[data-qty-dec]');if(dec){var c=getCart().find(function(x){return x.product_id===dec.dataset.qtyDec;});if(c)setQty(dec.dataset.qtyDec,Math.max(1,c.quantity-1));return;}
    var pay=e.target.closest('[data-pay]');if(pay){submitOrder(pay.dataset.pay);return;}
    var pixCp=e.target.closest('#ec-pix-copy');if(pixCp){var k=document.getElementById('ec-pix-key').textContent;navigator.clipboard.writeText(k).then(function(){pixCp.textContent='Copiado!';setTimeout(function(){pixCp.textContent='Copiar';},1500);});return;}
  });
  function submitOrder(method){
    var form=document.getElementById('ec-checkout-form');if(!form)return;
    var fd=new FormData(form);var name=fd.get('customer_name');var phone=fd.get('customer_phone');
    if(!name||!phone){alert('Preencha nome e telefone');return;}
    var c=getCart();if(c.length===0){alert('Carrinho vazio');return;}
    if(method==='pix'){var pd=document.getElementById('ec-pix-detail');if(pd)pd.style.display='block';return;}
    // whatsapp ou pix-confirm: cria pedido via API
    var payload={items:c.map(function(i){return {product_id:i.product_id,quantity:i.quantity};}),customer_name:name,customer_email:fd.get('customer_email')||undefined,customer_phone:phone,customer_address:{cep:fd.get('cep')||undefined,street:fd.get('street')||undefined,number:fd.get('number')||undefined,complement:fd.get('complement')||undefined},payment_method:method==='pix-confirm'?'pix':'whatsapp',notes:fd.get('notes')||undefined};
    fetch('${apiUrl}/p/${slug}/order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(function(r){if(!r.ok)throw new Error('http '+r.status);return r.json();}).then(function(res){
      var summary=c.map(function(i){return i.quantity+'x '+i.name+' - '+format(i.price*i.quantity);}).join('\\n');
      var msg='${this.escape(waMsgTemplate)}'.replace(/\\{summary\\}/g,summary).replace(/\\{total\\}/g,format(subtotal())).replace(/\\{customer_name\\}/g,name).replace(/\\{order_number\\}/g,'#'+res.order_number);
      localStorage.removeItem(KEY);
      ${adminPhone ? `window.location.href='https://wa.me/${adminPhone}?text='+encodeURIComponent(msg);` : `alert('Pedido recebido! #'+res.order_number);window.location.reload();`}
    }).catch(function(err){alert('Erro: '+err.message);});
  }
  render();
  // Track visit
  try{
    var sid=sessionStorage.getItem('ec_sid')||(Date.now()+Math.random().toString(36).slice(2));sessionStorage.setItem('ec_sid',sid);
    var vid=localStorage.getItem('ec_vid')||(Date.now()+Math.random().toString(36).slice(2));localStorage.setItem('ec_vid',vid);
    var qs=new URLSearchParams(location.search);
    var dev=window.innerWidth<768?'mobile':window.innerWidth<1024?'tablet':'desktop';
    fetch('${apiUrl}/p/${slug}/visit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({visitor_id:vid,session_id:sid,referrer:document.referrer,utm_source:qs.get('utm_source'),utm_medium:qs.get('utm_medium'),utm_campaign:qs.get('utm_campaign'),utm_content:qs.get('utm_content'),utm_term:qs.get('utm_term'),device:dev,browser:navigator.userAgent.slice(0,80)})});
  }catch(e){}
})();
</script>`;
  }

  // ──────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────

  private escape(s: string): string {
    if (s === undefined || s === null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private formatPrice(value: number, currency = 'BRL'): string {
    return value.toLocaleString('pt-BR', { style: 'currency', currency });
  }

  private youtubeId(url: string): string | null {
    const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([\w-]{11})/);
    return m ? (m[1] ?? null) : null;
  }

  private youtubeEmbedUrl(url: string): string | null {
    const id = this.youtubeId(url);
    if (id) return `https://www.youtube.com/embed/${id}`;
    if (url.includes('vimeo.com')) {
      const m = url.match(/vimeo\.com\/(\d+)/);
      if (m) return `https://player.vimeo.com/video/${m[1]}`;
    }
    return null;
  }
}
