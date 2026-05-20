'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ShieldAlert, Package, AlertTriangle, RefreshCw, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSacTickets } from '@/hooks/use-sac';
import { sacApi } from '@/lib/api/sac';
import { bridgeApi, type SaasOrder, type BridgeStatus } from '@/lib/api/bridge';
import { SacTicketsTable } from '@/components/sac/sac-tickets-table';
import { Button } from '@/components/ui/button';

/**
 * Tela de risco reputacional + pedidos atrasados sem ticket.
 * Cruza tickets com reputation_risk >= medium ou SLA breached, e
 * (se bridge ativa) pedidos do SaaS atrasados que ainda não têm ticket.
 */
export default function SacRiscosPage() {
  const t = useTranslations('sac.risks');
  // Tickets em risco
  const { data: critical } = useSacTickets({
    reputation_risk_min: 'medium',
    status: ['new', 'in_progress', 'reopened', 'waiting_customer', 'waiting_internal'],
    page_size: 25,
  });
  const { data: breached } = useSacTickets({
    sla_breached: true,
    status: ['new', 'in_progress', 'reopened'],
    page_size: 25,
  });

  // Bridge SaaS — pedidos atrasados
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null);
  const [delayedOrders, setDelayedOrders] = useState<SaasOrder[]>([]);
  const [loadingBridge, setLoadingBridge] = useState(true);
  const [running, setRunning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);

  useEffect(() => {
    void loadBridge();
  }, []);

  async function loadBridge() {
    setLoadingBridge(true);
    try {
      const status = await bridgeApi.status();
      setBridgeStatus(status);
      if (status.has_saas) {
        const recent = await bridgeApi.recent(50);
        const now = Date.now();
        const delayed = recent.filter((o) => {
          if (!o.shipping_estimated_delivery) return false;
          if (o.shipping_status === 'delivered' || o.shipping_status === 'cancelled') return false;
          return new Date(o.shipping_estimated_delivery).getTime() < now;
        });
        setDelayedOrders(delayed);
      }
    } catch {
      setBridgeStatus({ has_saas: false, checked_at: '', cache_ttl_ms: 0 });
    } finally {
      setLoadingBridge(false);
    }
  }

  const runPreventive = async () => {
    setRunning(true);
    setScanResult(null);
    try {
      const r = await sacApi.runPreventive();
      setScanResult(t('preventiveResult', { count: r.created }));
      void loadBridge();
    } catch {
      setScanResult(t('preventiveFailed'));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-4 py-3 md:px-6">
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-5 w-5 text-red-500" />
          <div>
            <h1 className="text-lg font-semibold">{t('title')}</h1>
            <p className="text-xs text-muted-foreground">
              {t('subtitle')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/sac">{t('back')}</Link>
          </Button>
          {bridgeStatus?.has_saas && (
            <Button size="sm" onClick={runPreventive} disabled={running}>
              <Sparkles className="h-3.5 w-3.5" />
              <span className="ml-1">{running ? t('scanning') : t('createPreventive')}</span>
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {scanResult && (
          <div className="mb-4 rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 text-sm text-cyan-700 dark:text-cyan-300">
            {scanResult}
          </div>
        )}

        {/* Risco reputacional */}
        <section className="mb-6">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            {t('criticalSection')}
            <span className="rounded-full bg-red-500/15 px-1.5 text-[11px] font-medium text-red-700 dark:text-red-300">
              {critical?.total ?? 0}
            </span>
          </h2>
          <SacTicketsTable
            tickets={critical?.rows ?? []}
            emptyMessage={t('criticalEmpty')}
          />
        </section>

        {/* SLA vencidos */}
        <section className="mb-6">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            {t('breachedSection')}
            <span className="rounded-full bg-amber-500/15 px-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
              {breached?.total ?? 0}
            </span>
          </h2>
          <SacTicketsTable
            tickets={breached?.rows ?? []}
            emptyMessage={t('breachedEmpty')}
          />
        </section>

        {/* Bridge SaaS */}
        <section className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Package className="h-4 w-4 text-orange-500" />
              {t('delayedSection')}
              {bridgeStatus?.has_saas && (
                <span className="rounded-full bg-orange-500/15 px-1.5 text-[11px] font-medium text-orange-700 dark:text-orange-300">
                  {delayedOrders.length}
                </span>
              )}
            </h2>
            <Button variant="ghost" size="sm" onClick={loadBridge} disabled={loadingBridge}>
              <RefreshCw className={`h-3.5 w-3.5 ${loadingBridge ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {loadingBridge ? (
            <p className="text-sm text-muted-foreground">{t('loading')}</p>
          ) : !bridgeStatus?.has_saas ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
              <Package className="mx-auto mb-2 h-6 w-6 opacity-50" />
              {t('bridgeOff')}
            </div>
          ) : delayedOrders.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
              {t('delayedEmpty')}
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">{t('table.marketplace')}</th>
                    <th className="px-3 py-2 text-left">{t('table.order')}</th>
                    <th className="px-3 py-2 text-left">{t('table.customer')}</th>
                    <th className="px-3 py-2 text-left">{t('table.status')}</th>
                    <th className="px-3 py-2 text-left">{t('table.delay')}</th>
                    <th className="px-3 py-2 text-left">{t('table.value')}</th>
                  </tr>
                </thead>
                <tbody>
                  {delayedOrders.map((o) => {
                    const delayDays = o.shipping_estimated_delivery
                      ? Math.ceil(
                          (Date.now() - new Date(o.shipping_estimated_delivery).getTime()) /
                            86_400_000,
                        )
                      : 0;
                    return (
                      <tr key={o.id} className="border-b border-border/60">
                        <td className="px-3 py-2 align-middle text-xs">
                          {o.marketplace ?? '—'}
                        </td>
                        <td className="px-3 py-2 align-middle font-mono text-xs">
                          {o.marketplace_order_id ?? o.id.slice(0, 8)}
                        </td>
                        <td className="px-3 py-2 align-middle text-xs">
                          {o.buyer_nickname ?? o.buyer_phone ?? '—'}
                        </td>
                        <td className="px-3 py-2 align-middle text-xs text-muted-foreground">
                          {o.shipping_status ?? '—'}
                        </td>
                        <td className="px-3 py-2 align-middle">
                          <span className="inline-flex items-center rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:text-red-300">
                            {t('delayDays', { n: delayDays })}
                          </span>
                        </td>
                        <td className="px-3 py-2 align-middle text-xs">
                          {typeof o.total_amount === 'number'
                            ? o.total_amount.toLocaleString('pt-BR', {
                                style: 'currency',
                                currency: 'BRL',
                              })
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {bridgeStatus?.has_saas && delayedOrders.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t('preventiveHint')}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
