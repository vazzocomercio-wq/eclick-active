'use client';

import { useEffect, useState } from 'react';
import {
  Edit,
  Loader2,
  Package,
  Plus,
  ShoppingBag,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  PageSettings,
  StoreOrder,
  StoreProduct,
} from '@eclick-active/shared';
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
import { pagesApi } from '@/lib/api/pages';
import { useConfirm } from '@/components/ui/confirm-provider';
import { cn } from '@/lib/utils';

interface Props {
  pageId: string;
  products: StoreProduct[];
  onProductsChange: (products: StoreProduct[]) => void;
  storeSettings: NonNullable<PageSettings['store']>;
  onStoreSettingsChange: (s: NonNullable<PageSettings['store']>) => void;
}

export function StoreEditor({
  pageId,
  products,
  onProductsChange,
  storeSettings,
  onStoreSettingsChange,
}: Props) {
  const [tab, setTab] = useState<'products' | 'orders' | 'checkout'>('products');
  const [productDialog, setProductDialog] = useState<{
    open: boolean;
    editing: StoreProduct | null;
  }>({ open: false, editing: null });
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  useEffect(() => {
    if (tab !== 'orders') return;
    setLoadingOrders(true);
    pagesApi
      .listOrders(pageId)
      .then((res) => setOrders(res.data))
      .catch(() => {})
      .finally(() => setLoadingOrders(false));
  }, [tab, pageId]);

  return (
    <div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="products">Produtos ({products.length})</TabsTrigger>
          <TabsTrigger value="orders">Pedidos</TabsTrigger>
          <TabsTrigger value="checkout">Checkout</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="space-y-3 pt-3">
          <Button
            size="sm"
            className="w-full"
            onClick={() => setProductDialog({ open: true, editing: null })}
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar produto
          </Button>

          {products.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              Nenhum produto cadastrado.
            </div>
          ) : (
            <div className="space-y-2">
              {products.map((p) => (
                <ProductRow
                  key={p.id}
                  product={p}
                  pageId={pageId}
                  onEdit={() => setProductDialog({ open: true, editing: p })}
                  onChange={(updated) =>
                    onProductsChange(products.map((x) => (x.id === updated.id ? updated : x)))
                  }
                  onDelete={() =>
                    onProductsChange(products.filter((x) => x.id !== p.id))
                  }
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="orders" className="pt-3">
          {loadingOrders ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : orders.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              Nenhum pedido ainda.
            </div>
          ) : (
            <OrdersList pageId={pageId} orders={orders} onChange={setOrders} />
          )}
        </TabsContent>

        <TabsContent value="checkout" className="space-y-3 pt-3">
          <CheckoutSettings settings={storeSettings} onChange={onStoreSettingsChange} />
        </TabsContent>
      </Tabs>

      {productDialog.open && (
        <ProductDialog
          pageId={pageId}
          editing={productDialog.editing}
          onClose={() => setProductDialog({ open: false, editing: null })}
          onSaved={(prod) => {
            if (productDialog.editing) {
              onProductsChange(products.map((p) => (p.id === prod.id ? prod : p)));
            } else {
              onProductsChange([...products, prod]);
            }
            setProductDialog({ open: false, editing: null });
          }}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Product row
// ────────────────────────────────────────────────────────────

function ProductRow({
  product,
  pageId,
  onEdit,
  onChange,
  onDelete,
}: {
  product: StoreProduct;
  pageId: string;
  onEdit: () => void;
  onChange: (p: StoreProduct) => void;
  onDelete: () => void;
}) {
  const confirm = useConfirm();
  async function toggleActive() {
    try {
      const updated = await pagesApi.updateProduct(pageId, product.id, {
        is_active: !product.is_active,
      });
      onChange(updated);
    } catch (err) {
      toast.error('Falha ao atualizar', {
        description: err instanceof Error ? err.message : 'erro',
      });
    }
  }

  async function remove() {
    const ok = await confirm({
      title: `Excluir "${product.name}"?`,
      variant: 'destructive',
      confirmLabel: 'Excluir',
      icon: Trash2,
    });
    if (!ok) return;
    try {
      await pagesApi.removeProduct(pageId, product.id);
      onDelete();
      toast.success('Produto excluído');
    } catch (err) {
      toast.error('Falha ao excluir', {
        description: err instanceof Error ? err.message : 'erro',
      });
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card p-2">
      {product.images[0] ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={product.images[0]}
          alt={product.name}
          className="h-10 w-10 rounded-md object-cover"
        />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
          <Package className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="truncate text-xs font-medium">{product.name}</div>
        <div className="text-[11px] text-muted-foreground">
          {product.price.toLocaleString('pt-BR', { style: 'currency', currency: product.currency })}
          {product.stock_quantity !== null && (
            <span> · {product.stock_quantity} em estoque</span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={toggleActive}
        className={cn(
          'h-5 w-9 rounded-full transition-colors',
          product.is_active ? 'bg-primary' : 'bg-muted',
        )}
        title={product.is_active ? 'Ativo' : 'Inativo'}
      >
        <span
          className={cn(
            'block h-4 w-4 rounded-full bg-white transition-transform',
            product.is_active ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </button>
      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onEdit}>
        <Edit className="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
        onClick={remove}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Product dialog (create + edit)
// ────────────────────────────────────────────────────────────

function ProductDialog({
  pageId,
  editing,
  onClose,
  onSaved,
}: {
  pageId: string;
  editing: StoreProduct | null;
  onClose: () => void;
  onSaved: (p: StoreProduct) => void;
}) {
  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [price, setPrice] = useState(editing?.price ?? 0);
  const [compareAtPrice, setCompareAtPrice] = useState(editing?.compare_at_price ?? 0);
  const [imagesText, setImagesText] = useState((editing?.images ?? []).join('\n'));
  const [stockQuantity, setStockQuantity] = useState(editing?.stock_quantity ?? '');
  const [sku, setSku] = useState(editing?.sku ?? '');
  const [category, setCategory] = useState(editing?.category ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Nome é obrigatório');
      return;
    }
    if (price <= 0) {
      setError('Preço deve ser maior que zero');
      return;
    }
    setSubmitting(true);
    setError(null);
    const payload = {
      name: name.trim(),
      description: description || undefined,
      price: Number(price),
      compare_at_price: compareAtPrice ? Number(compareAtPrice) : undefined,
      images: imagesText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      sku: sku || undefined,
      category: category || undefined,
      stock_quantity: stockQuantity === '' ? undefined : Number(stockQuantity),
    };
    try {
      const result = editing
        ? await pagesApi.updateProduct(pageId, editing.id, payload)
        : await pagesApi.createProduct(pageId, payload);
      onSaved(result);
      toast.success(editing ? 'Produto atualizado' : 'Produto criado');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !submitting && !o && onClose()}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar produto' : 'Novo produto'}</DialogTitle>
            <DialogDescription>
              Informações exibidas nos blocos de produto e no carrinho.
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 space-y-3">
            <div>
              <Label className="text-xs">Nome *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </div>
            <div>
              <Label className="text-xs">Descrição</Label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Preço *</Label>
                <Input
                  type="number"
                  step={0.01}
                  min={0}
                  value={price}
                  onChange={(e) => setPrice(Number(e.target.value))}
                  required
                />
              </div>
              <div>
                <Label className="text-xs">Preço &ldquo;de&rdquo; (riscado)</Label>
                <Input
                  type="number"
                  step={0.01}
                  min={0}
                  value={compareAtPrice}
                  onChange={(e) => setCompareAtPrice(Number(e.target.value))}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Imagens (URLs, uma por linha)</Label>
              <textarea
                value={imagesText}
                onChange={(e) => setImagesText(e.target.value)}
                rows={3}
                placeholder="https://...
https://..."
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-xs"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">SKU</Label>
                <Input value={sku} onChange={(e) => setSku(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Categoria</Label>
                <Input value={category} onChange={(e) => setCategory(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Estoque</Label>
                <Input
                  type="number"
                  min={0}
                  value={stockQuantity}
                  onChange={(e) => setStockQuantity(e.target.value)}
                  placeholder="ilimitado"
                />
              </div>
            </div>
          </div>

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? 'Salvar' : 'Criar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────
// Orders list
// ────────────────────────────────────────────────────────────

function OrdersList({
  pageId,
  orders,
  onChange,
}: {
  pageId: string;
  orders: StoreOrder[];
  onChange: (orders: StoreOrder[]) => void;
}) {
  const [selected, setSelected] = useState<StoreOrder | null>(null);

  return (
    <>
      <div className="space-y-1">
        {orders.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => setSelected(o)}
            className="flex w-full items-center gap-2 rounded-md border border-border bg-card p-2 text-left hover:border-primary/50"
          >
            <ShoppingBag className="h-3.5 w-3.5 text-primary" />
            <div className="flex-1 min-w-0">
              <div className="truncate text-xs font-medium">
                #{o.order_number} — {o.customer_name ?? 'Cliente'}
              </div>
              <div className="text-[11px] text-muted-foreground">
                R$ {o.total.toFixed(2)} · {o.items.length} itens
              </div>
            </div>
            <span
              className={cn(
                'shrink-0 rounded-full px-1.5 py-0.5 text-[9px] uppercase',
                o.payment_status === 'paid'
                  ? 'bg-green-500/15 text-green-500'
                  : o.payment_status === 'pending'
                    ? 'bg-yellow-500/15 text-yellow-500'
                    : 'bg-muted text-muted-foreground',
              )}
            >
              {o.payment_status}
            </span>
          </button>
        ))}
      </div>

      {selected && (
        <OrderDialog
          pageId={pageId}
          order={selected}
          onClose={() => setSelected(null)}
          onUpdate={(updated) => {
            onChange(orders.map((x) => (x.id === updated.id ? updated : x)));
            setSelected(updated);
          }}
        />
      )}
    </>
  );
}

function OrderDialog({
  pageId,
  order,
  onClose,
  onUpdate,
}: {
  pageId: string;
  order: StoreOrder;
  onClose: () => void;
  onUpdate: (o: StoreOrder) => void;
}) {
  async function setStatus(
    field: 'payment_status' | 'fulfillment_status',
    value: string,
  ) {
    try {
      const updated = await pagesApi.updateOrder(pageId, order.id, { [field]: value as never });
      onUpdate(updated);
      toast.success('Status atualizado');
    } catch (err) {
      toast.error('Falha', { description: err instanceof Error ? err.message : 'erro' });
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Pedido #{order.order_number}</span>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-3">
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">Cliente</Label>
            <div className="text-sm font-medium">{order.customer_name}</div>
            <div className="text-xs text-muted-foreground">
              {order.customer_phone}
              {order.customer_email ? ` · ${order.customer_email}` : ''}
            </div>
          </div>

          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">Itens</Label>
            <div className="space-y-1">
              {order.items.map((it, i) => (
                <div key={i} className="flex justify-between text-xs">
                  <span>
                    {it.quantity}x {it.name}
                  </span>
                  <span>R$ {it.subtotal.toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between border-t border-border pt-2 text-sm font-semibold">
              <span>Total</span>
              <span>R$ {order.total.toFixed(2)}</span>
            </div>
          </div>

          {order.notes && (
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">Observações</Label>
              <div className="text-xs">{order.notes}</div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">Pagamento</Label>
              <select
                value={order.payment_status}
                onChange={(e) => setStatus('payment_status', e.target.value)}
                className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
              >
                <option value="pending">Pendente</option>
                <option value="paid">Pago</option>
                <option value="failed">Falhou</option>
                <option value="refunded">Reembolsado</option>
              </select>
            </div>
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">Entrega</Label>
              <select
                value={order.fulfillment_status}
                onChange={(e) => setStatus('fulfillment_status', e.target.value)}
                className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
              >
                <option value="unfulfilled">Não enviado</option>
                <option value="processing">Processando</option>
                <option value="shipped">Enviado</option>
                <option value="delivered">Entregue</option>
                <option value="cancelled">Cancelado</option>
              </select>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────
// Checkout settings
// ────────────────────────────────────────────────────────────

function CheckoutSettings({
  settings,
  onChange,
}: {
  settings: NonNullable<PageSettings['store']>;
  onChange: (s: NonNullable<PageSettings['store']>) => void;
}) {
  function set<K extends keyof NonNullable<PageSettings['store']>>(
    key: K,
    value: NonNullable<PageSettings['store']>[K],
  ) {
    onChange({ ...settings, [key]: value });
  }

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs">Telefone do admin (notificação de novos pedidos)</Label>
        <Input
          value={settings.admin_phone ?? ''}
          onChange={(e) => set('admin_phone', e.target.value)}
          placeholder="5571999999999"
        />
      </div>
      <div>
        <Label className="text-xs">Mensagem WhatsApp pós-pedido</Label>
        <textarea
          value={settings.whatsapp_after_order ?? ''}
          onChange={(e) => set('whatsapp_after_order', e.target.value)}
          rows={3}
          placeholder="Olá! Acabei de fazer um pedido:&#10;{summary}&#10;Total: {total}"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Placeholders: <code>{'{summary}'}</code>, <code>{'{total}'}</code>,{' '}
          <code>{'{customer_name}'}</code>, <code>{'{order_number}'}</code>
        </p>
      </div>
      <div>
        <Label className="text-xs">Chave PIX</Label>
        <Input
          value={settings.pix_key ?? ''}
          onChange={(e) => set('pix_key', e.target.value)}
          placeholder="email@empresa.com ou CPF"
        />
      </div>
      <div>
        <Label className="text-xs">Nome do recebedor PIX</Label>
        <Input
          value={settings.pix_recipient_name ?? ''}
          onChange={(e) => set('pix_recipient_name', e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Frete fixo (R$)</Label>
          <Input
            type="number"
            step={0.01}
            min={0}
            value={settings.shipping_fee ?? 0}
            onChange={(e) => set('shipping_fee', Number(e.target.value))}
          />
        </div>
        <div>
          <Label className="text-xs">Frete grátis acima de (R$)</Label>
          <Input
            type="number"
            step={0.01}
            min={0}
            value={settings.free_shipping_above ?? 0}
            onChange={(e) =>
              set('free_shipping_above', e.target.value ? Number(e.target.value) : undefined)
            }
          />
        </div>
      </div>
    </div>
  );
}
