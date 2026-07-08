'use client';

/**
 * ProductPickerDialog — modal pra escolher um produto do catalogo e
 * enviar como mensagem na conversa atual da Inbox.
 *
 * Usa o Dialog do design system (Radix) — focus trap, role/aria, scroll
 * lock, fechar no backdrop/ESC vêm de graça.
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
import { Search, Loader2, Check, Package, ShoppingBag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { catalogApi, type CatalogProduct } from '@/lib/api/whatsapp-commerce';
import { cn } from '@/lib/utils';

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

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !sending) onClose(); }}>
      <DialogContent className="flex max-h-[88vh] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0">
        {/* Header */}
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ShoppingBag className="h-[18px] w-[18px] text-primary" />
            {t('title')}
          </DialogTitle>
        </DialogHeader>

        {/* Search */}
        <div className="border-b border-border px-5 py-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={e => setQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void refresh(q); } }}
              placeholder={t('searchPlaceholder')}
              className="w-full rounded border border-border bg-input py-2 pl-9 pr-3 text-sm outline-none focus:border-primary/60" />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 size={14} className="animate-spin" /> {t('loading')}
            </div>
          )}
          {!loading && products && products.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
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
                      className={cn(
                        'flex w-full gap-3 rounded-md border p-3 text-left transition-colors',
                        active
                          ? 'border-primary/70 bg-primary/5'
                          : 'border-border bg-card hover:border-primary/40',
                      )}>
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumb} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <Package size={20} className="text-muted-foreground/40" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm font-semibold">{p.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {p.sku ? `${t('skuPrefix', { sku: p.sku })} · ` : ''}{p.in_stock ? t('inStock', { count: p.stock }) : t('outOfStock')}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-bold text-primary">
                          {p.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </p>
                        {active && <Check size={14} className="mt-1 inline-block text-primary" />}
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
          <div className="space-y-2 border-t border-border bg-muted/20 px-5 py-3">
            <p className="text-xs text-muted-foreground">{t('observationLabel')}</p>
            <textarea value={extra} onChange={e => setExtra(e.target.value)} rows={2}
              placeholder={t('observationPlaceholder')}
              className="w-full resize-none rounded border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary/60" />
            {error && (
              <p className="text-xs text-destructive">{t('errorPrefix', { message: error })}</p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setPicked(null)} disabled={sending}>
                {t('swapProduct')}
              </Button>
              <Button type="button" size="sm" onClick={confirm} disabled={sending} className="gap-1.5">
                {sending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                {t('sendProduct')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
