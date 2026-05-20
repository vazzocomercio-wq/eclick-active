'use client';

/**
 * ProductPickerDialog — modal pra escolher um produto do catalogo e
 * enviar como mensagem na conversa atual da Inbox.
 *
 * Fluxo:
 *   1. Lista produtos via catalogApi.list (com busca por nome/sku).
 *   2. User escolhe um produto.
 *   3. Pode opcionalmente adicionar uma "observacao" curta (extra
 *      ao caption automatico nome+preco+sku+link).
 *   4. Confirmar dispara onSelect(product, extra) — o caller (chat-panel)
 *      chama messagesApi.sendProduct.
 *
 * Stateless quanto a envio: o caller controla o sending+erro pra reusar
 * o handler central de envio do chat-panel.
 */

import { useEffect, useState, useCallback } from 'react';
import { Search, Loader2, X, Check, Package, ShoppingBag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { catalogApi, type CatalogProduct } from '@/lib/api/whatsapp-commerce';

interface Props {
  open:     boolean;
  onClose:  () => void;
  onSelect: (p: CatalogProduct, extra: string) => Promise<void>;
}

export function ProductPickerDialog({ open, onClose, onSelect }: Props) {
  const t = useTranslations('inbox.productPicker');
  const [products, setProducts] = useState<CatalogProduct[] | null>(null);
  const [loading, setLoading]   = useState(false);
  const [q, setQ]               = useState('');
  const [picked, setPicked]     = useState<CatalogProduct | null>(null);
  const [extra, setExtra]       = useState('');
  const [sending, setSending]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const refresh = useCallback(async (query?: string) => {
    setLoading(true); setError(null);
    try {
      const list = await catalogApi.list({ q: query?.trim() || undefined, limit: 24 });
      setProducts(list);
    } catch (e) {
      setError((e as Error).message);
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setPicked(null); setExtra(''); setError(null);
    void refresh();
  }, [open, refresh]);

  // ESC fecha
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  async function confirm() {
    if (!picked || sending) return;
    setSending(true); setError(null);
    try {
      await onSelect(picked, extra.trim());
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-background border border-border rounded-xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-base font-bold flex items-center gap-2">
            <ShoppingBag size={18} className="text-cyan-400" />
            {t('title')}
          </h2>
          <button onClick={onClose} aria-label={t('closeAria')} className="text-muted-foreground hover:text-foreground p-1">
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-border">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={e => setQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void refresh(q); } }}
              placeholder={t('searchPlaceholder')}
              className="w-full pl-9 pr-3 py-2 text-sm bg-input border border-border rounded outline-none focus:border-cyan-400/60" />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading && (
            <div className="py-12 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={14} className="animate-spin" /> {t('loading')}
            </div>
          )}
          {!loading && products && products.length === 0 && (
            <div className="py-12 flex flex-col items-center gap-2 text-center">
              <Package size={36} className="text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">{t('empty')}</p>
            </div>
          )}
          {!loading && products && products.length > 0 && (
            <ul className="space-y-2">
              {products.map(p => {
                const active = picked?.product_id === p.product_id;
                const thumb = p.thumbnail_url ?? p.photo_urls?.[0] ?? null;
                return (
                  <li key={p.product_id}>
                    <button type="button" onClick={() => setPicked(p)}
                      className={`w-full text-left flex gap-3 p-3 rounded-md border transition-colors ${
                        active
                          ? 'border-cyan-400/70 bg-cyan-400/5'
                          : 'border-border hover:border-cyan-400/40 bg-card'
                      }`}>
                      <div className="w-14 h-14 rounded shrink-0 bg-muted overflow-hidden flex items-center justify-center">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumb} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Package size={20} className="text-muted-foreground/40" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold line-clamp-2">{p.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {p.sku ? `${t('skuPrefix', { sku: p.sku })} · ` : ''}{p.in_stock ? t('inStock', { count: p.stock }) : t('outOfStock')}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-cyan-400">
                          {p.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </p>
                        {active && <Check size={14} className="text-cyan-400 inline-block mt-1" />}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Picker confirm */}
        {picked && (
          <div className="px-5 py-3 border-t border-border space-y-2 bg-muted/20">
            <p className="text-xs text-muted-foreground">{t('observationLabel')}</p>
            <textarea value={extra} onChange={e => setExtra(e.target.value)} rows={2}
              placeholder={t('observationPlaceholder')}
              className="w-full px-3 py-2 text-sm bg-input border border-border rounded outline-none focus:border-cyan-400/60 resize-none" />
            {error && (
              <p className="text-xs text-red-400">{t('errorPrefix', { message: error })}</p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setPicked(null)} disabled={sending}
                className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                {t('swapProduct')}
              </button>
              <button onClick={confirm} disabled={sending}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-cyan-400 hover:bg-cyan-300 text-black text-xs font-semibold disabled:opacity-50">
                {sending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                {t('sendProduct')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
