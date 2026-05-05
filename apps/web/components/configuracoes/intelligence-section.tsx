'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  PlayCircle,
  Plus,
  Send,
  Trash2,
  UserPlus,
  XCircle,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  alertManagersApi,
  alertRoutingApi,
  alertDeliveriesApi,
  adSignalsApi,
  type AlertManager,
  type AlertRoutingRule,
  type AlertDelivery,
  type AdSignal,
  type DeliveryMode,
} from '@/lib/api/active-intelligence';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Tab = 'managers' | 'rules' | 'signals' | 'deliveries';

const TABS: Array<{ key: Tab; label: string; icon: typeof Bell }> = [
  { key: 'managers', label: 'Gestores', icon: UserPlus },
  { key: 'rules', label: 'Regras', icon: Zap },
  { key: 'signals', label: 'Sinais', icon: AlertTriangle },
  { key: 'deliveries', label: 'Entregas', icon: Send },
];

/**
 * /configuracoes > Inteligência (umbrella).
 * 4 tabs:
 *   - Gestores: cadastrar managers + verify-phone
 *   - Regras: routing rules signal_type → managers
 *   - Sinais: ad_signals listing (read-only + ack)
 *   - Entregas: alert_deliveries listing
 */
export function IntelligenceSection() {
  const [tab, setTab] = useState<Tab>('managers');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-primary" />
          Inteligência (Alertas)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Cadastre gestores que recebem alertas via WhatsApp e configure quais sinais cada um vê.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border pb-2">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors',
                  tab === t.key
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        {tab === 'managers' && <ManagersTab />}
        {tab === 'rules' && <RulesTab />}
        {tab === 'signals' && <SignalsTab />}
        {tab === 'deliveries' && <DeliveriesTab />}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
// Managers tab
// ─────────────────────────────────────────────────────────────

function ManagersTab() {
  const [managers, setManagers] = useState<AlertManager[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [department, setDepartment] = useState('');
  const [creating, setCreating] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [confirmCode, setConfirmCode] = useState<Record<string, string>>({});

  async function reload() {
    setLoading(true);
    try {
      const data = await alertManagersApi.list();
      setManagers(data);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Falha ao listar');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
  }, []);

  async function handleCreate() {
    if (!name.trim() || !phone.trim()) {
      toast.error('Nome e telefone obrigatórios');
      return;
    }
    setCreating(true);
    try {
      await alertManagersApi.create({
        name: name.trim(),
        phone: phone.trim(),
        department: department.trim() || undefined,
      });
      toast.success('Gestor cadastrado. Clique em "Enviar código" pra verificar o telefone.');
      setName('');
      setPhone('');
      setDepartment('');
      setShowCreate(false);
      void reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Falha ao criar');
    } finally {
      setCreating(false);
    }
  }

  async function handleVerify(id: string) {
    setVerifyingId(id);
    try {
      await alertManagersApi.verifyPhone(id);
      toast.success('Código enviado por WhatsApp. Cole no campo abaixo pra confirmar.');
      void reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Falha ao enviar código');
    } finally {
      setVerifyingId(null);
    }
  }

  async function handleConfirm(id: string) {
    const code = confirmCode[id];
    if (!code || code.length !== 6) {
      toast.error('Cole o código de 6 dígitos');
      return;
    }
    try {
      await alertManagersApi.confirmPhone(id, code);
      toast.success('Telefone confirmado. Gestor agora recebe alertas.');
      setConfirmCode((prev) => ({ ...prev, [id]: '' }));
      void reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Falha ao confirmar');
    }
  }

  async function handleDelete(m: AlertManager) {
    if (!confirm(`Remover gestor ${m.name}?`)) return;
    try {
      await alertManagersApi.remove(m.id);
      toast.success('Removido');
      void reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Falha ao remover');
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {!showCreate ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowCreate(true)}
          className="self-start gap-1"
        >
          <Plus className="h-3.5 w-3.5" /> Novo gestor
        </Button>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-card/50 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase">Nome</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Marina" />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase">Telefone</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="5511999999999"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase">Departamento (opc)</Label>
              <Input
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="Marketing"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={creating}>
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Criar'}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
      ) : managers.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
          Nenhum gestor cadastrado.
        </div>
      ) : (
        managers.map((m) => (
          <div
            key={m.id}
            className="flex flex-col gap-2 rounded-md border border-border bg-card/30 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-1 items-center gap-2 min-w-0">
                <ManagerStatusIcon status={m.status} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{m.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {m.phone_masked}
                    {m.department && ` · ${m.department}`}
                    {m.verified_at &&
                      ` · verificado ${new Date(m.verified_at).toLocaleDateString('pt-BR')}`}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                {m.status !== 'active' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleVerify(m.id)}
                    disabled={verifyingId === m.id}
                  >
                    {verifyingId === m.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      'Enviar código'
                    )}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => handleDelete(m)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </div>
            {m.status === 'pending_verification' && (
              <div className="flex items-end gap-2">
                <div className="flex flex-1 flex-col gap-1">
                  <Label className="text-[10px] uppercase">Código recebido (6 dígitos)</Label>
                  <Input
                    value={confirmCode[m.id] ?? ''}
                    onChange={(e) =>
                      setConfirmCode((prev) => ({
                        ...prev,
                        [m.id]: e.target.value.replace(/\D/g, '').slice(0, 6),
                      }))
                    }
                    placeholder="123456"
                    maxLength={6}
                  />
                </div>
                <Button size="sm" onClick={() => handleConfirm(m.id)}>
                  Confirmar
                </Button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function ManagerStatusIcon({ status }: { status: AlertManager['status'] }) {
  if (status === 'active') return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />;
  if (status === 'pending_verification')
    return <Clock className="h-4 w-4 shrink-0 text-amber-500" />;
  return <XCircle className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

// ─────────────────────────────────────────────────────────────
// Rules tab
// ─────────────────────────────────────────────────────────────

const SIGNAL_TYPES = [
  '*',
  'metric_threshold',
  'metric_anomaly',
  'creative_fatigue',
  'audience_burnout',
  'scaling_inefficiency',
  'pixel_drift',
  'lead_unattended',
];

const DELIVERY_MODE_LABELS: Record<DeliveryMode, string> = {
  immediate: 'Imediato',
  digest_8h: 'Digest 8h',
  digest_14h: 'Digest 14h',
  digest_18h: 'Digest 18h',
  weekly: 'Semanal (seg 8h)',
};

function RulesTab() {
  const [rules, setRules] = useState<AlertRoutingRule[]>([]);
  const [managers, setManagers] = useState<AlertManager[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<{
    name: string;
    signal_type: string;
    min_severity: 'warning' | 'critical';
    manager_ids: string[];
    delivery_mode: DeliveryMode;
    business_hours_only: boolean;
  }>({
    name: '',
    signal_type: '*',
    min_severity: 'warning',
    manager_ids: [],
    delivery_mode: 'immediate',
    business_hours_only: false,
  });

  async function reload() {
    setLoading(true);
    try {
      const [r, m] = await Promise.all([
        alertRoutingApi.list(),
        alertManagersApi.list(),
      ]);
      setRules(r);
      setManagers(m.filter((x) => x.status === 'active'));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Falha ao carregar');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
  }, []);

  async function handleCreate() {
    if (draft.manager_ids.length === 0) {
      toast.error('Selecione ao menos 1 gestor');
      return;
    }
    setCreating(true);
    try {
      await alertRoutingApi.create({
        name: draft.name.trim() || undefined,
        signal_type: draft.signal_type,
        min_severity: draft.min_severity,
        manager_ids: draft.manager_ids,
        delivery_mode: draft.delivery_mode,
        business_hours_only: draft.business_hours_only,
      });
      toast.success('Regra criada');
      setShowCreate(false);
      setDraft({
        name: '',
        signal_type: '*',
        min_severity: 'warning',
        manager_ids: [],
        delivery_mode: 'immediate',
        business_hours_only: false,
      });
      void reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Falha ao criar');
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleEnabled(rule: AlertRoutingRule) {
    try {
      await alertRoutingApi.update(rule.id, { enabled: !rule.enabled });
      void reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Falha ao salvar');
    }
  }

  async function handleDelete(rule: AlertRoutingRule) {
    if (!confirm(`Remover regra ${rule.name ?? rule.signal_type}?`)) return;
    try {
      await alertRoutingApi.remove(rule.id);
      toast.success('Removida');
      void reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Falha ao remover');
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {managers.length === 0 ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Cadastre pelo menos 1 gestor verificado antes de criar regras.
        </div>
      ) : !showCreate ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowCreate(true)}
          className="self-start gap-1"
        >
          <Plus className="h-3.5 w-3.5" /> Nova regra
        </Button>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-card/50 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase">Nome (opc)</Label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Alertas críticos pro Marketing"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase">Tipo de sinal</Label>
              <select
                value={draft.signal_type}
                onChange={(e) => setDraft({ ...draft, signal_type: e.target.value })}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
              >
                {SIGNAL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t === '*' ? 'Qualquer sinal' : t}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase">Severidade mínima</Label>
              <select
                value={draft.min_severity}
                onChange={(e) =>
                  setDraft({ ...draft, min_severity: e.target.value as 'warning' | 'critical' })
                }
                className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
              >
                <option value="warning">Warning (encaminha tudo)</option>
                <option value="critical">Critical (só os mais graves)</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase">Modo de entrega</Label>
              <select
                value={draft.delivery_mode}
                onChange={(e) =>
                  setDraft({ ...draft, delivery_mode: e.target.value as DeliveryMode })
                }
                className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
              >
                {Object.entries(DELIVERY_MODE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-[10px] uppercase">Gestores destinatários</Label>
            <div className="flex flex-wrap gap-1.5">
              {managers.map((m) => {
                const sel = draft.manager_ids.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        manager_ids: sel
                          ? draft.manager_ids.filter((x) => x !== m.id)
                          : [...draft.manager_ids, m.id],
                      })
                    }
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                      sel
                        ? 'border-primary bg-primary/15 text-primary'
                        : 'border-border text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {m.name}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={draft.business_hours_only}
              onChange={(e) =>
                setDraft({ ...draft, business_hours_only: e.target.checked })
              }
            />
            Só horário comercial (8h-20h tz da org)
          </label>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={creating}>
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Criar regra'}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
      ) : rules.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
          Nenhuma regra de roteamento configurada.
        </div>
      ) : (
        rules.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between gap-2 rounded-md border border-border bg-card/30 p-3"
          >
            <div className="flex flex-1 items-center gap-2 min-w-0">
              <input
                type="checkbox"
                checked={r.enabled}
                onChange={() => handleToggleEnabled(r)}
                className="h-3.5 w-3.5 cursor-pointer"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm">
                  <span className="font-medium">{r.name ?? r.signal_type}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {r.signal_type === '*' ? 'Qualquer' : r.signal_type}
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {DELIVERY_MODE_LABELS[r.delivery_mode]} · severidade ≥ {r.min_severity} ·{' '}
                  {r.manager_ids.length} gestor(es)
                  {r.business_hours_only && ' · só horário comercial'}
                </div>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => handleDelete(r)}>
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        ))
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Signals tab
// ─────────────────────────────────────────────────────────────

function SignalsTab() {
  const [signals, setSignals] = useState<AdSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'sent' | 'acked' | 'all'>('pending');
  const [detecting, setDetecting] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const data = await adSignalsApi.list(filter === 'all' ? undefined : filter);
      setSignals(data);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Falha ao carregar');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
  }, [filter]);

  async function handleDetect() {
    setDetecting(true);
    try {
      const r = await adSignalsApi.detect();
      toast.success(
        `Detectados ${r.total} sinal(is) (L1=${r.layer1} L2=${r.layer2} L3=${r.layer3})`,
      );
      void reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Falha ao detectar');
    } finally {
      setDetecting(false);
    }
  }

  async function handleAck(s: AdSignal) {
    try {
      await adSignalsApi.ack(s.id);
      toast.success('Marcado como visto');
      void reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Falha ao acknowledgear');
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex shrink-0 gap-1 overflow-x-auto">
          {(['pending', 'sent', 'acked', 'all'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                'shrink-0 rounded-md px-2.5 py-1 text-[11px] transition-colors',
                filter === f
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {f === 'all' ? 'Todos' : f}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={handleDetect} disabled={detecting}>
          {detecting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <PlayCircle className="h-3.5 w-3.5" />
          )}
          <span className="ml-1">Rodar detecção agora</span>
        </Button>
      </div>

      {loading ? (
        <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
      ) : signals.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
          Nenhum sinal {filter === 'all' ? '' : filter} encontrado.
        </div>
      ) : (
        signals.map((s) => (
          <div
            key={s.id}
            className="flex items-start justify-between gap-2 rounded-md border border-border bg-card/30 p-3"
          >
            <div className="flex flex-1 gap-2 min-w-0">
              <SeverityIcon severity={s.severity} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {s.signal_type}
                  {s.campaign && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      · {s.campaign.name}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {new Date(s.generated_at).toLocaleString('pt-BR')}
                  {s.metric_key && ` · ${s.metric_key}`}
                  {s.current_value !== null &&
                    ` · valor=${s.current_value}${s.threshold_value !== null ? ` / alvo=${s.threshold_value}` : ''}`}
                  {' · '}
                  <span
                    className={cn(
                      s.status === 'pending'
                        ? 'text-amber-500'
                        : s.status === 'sent'
                          ? 'text-emerald-500'
                          : 'text-muted-foreground',
                    )}
                  >
                    {s.status}
                  </span>
                </div>
              </div>
            </div>
            {s.status !== 'acked' && (
              <Button variant="ghost" size="sm" onClick={() => handleAck(s)}>
                <CheckCircle2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function SeverityIcon({ severity }: { severity: 'warning' | 'critical' }) {
  return severity === 'critical' ? (
    <span className="text-base shrink-0">🚨</span>
  ) : (
    <span className="text-base shrink-0">⚠️</span>
  );
}

// ─────────────────────────────────────────────────────────────
// Deliveries tab
// ─────────────────────────────────────────────────────────────

function DeliveriesTab() {
  const [deliveries, setDeliveries] = useState<AlertDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'sent' | 'failed' | 'acked'>('all');

  async function reload() {
    setLoading(true);
    try {
      const data = await alertDeliveriesApi.list({
        status: filter === 'all' ? undefined : filter,
        limit: 100,
      });
      setDeliveries(data);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Falha ao carregar');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
  }, [filter]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex shrink-0 gap-1 overflow-x-auto">
        {(['all', 'pending', 'sent', 'failed', 'acked'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              'shrink-0 rounded-md px-2.5 py-1 text-[11px] transition-colors',
              filter === f
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {f === 'all' ? 'Todas' : f}
          </button>
        ))}
      </div>

      {loading ? (
        <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
      ) : deliveries.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
          Nenhuma entrega encontrada.
        </div>
      ) : (
        deliveries.map((d) => (
          <div
            key={d.id}
            className="flex flex-col gap-1 rounded-md border border-border bg-card/30 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm">
                <DeliveryStatusBadge status={d.status} />
                <span className="font-medium">{d.manager_name ?? d.manager_id}</span>
                <span className="text-[10px] text-muted-foreground">
                  {d.delivery_mode} · narrador={d.narrator}
                </span>
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {new Date(d.generated_at).toLocaleString('pt-BR')}
              </span>
            </div>
            {d.message_text && (
              <pre className="whitespace-pre-wrap rounded border border-border bg-background px-2 py-1.5 text-[11px] font-sans text-muted-foreground">
                {d.message_text}
              </pre>
            )}
            {d.error_message && (
              <div className="text-[10px] text-destructive">
                erro: {d.error_message}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function DeliveryStatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    queued: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
    sent: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
    failed: 'bg-destructive/15 text-destructive',
    acked: 'bg-muted text-muted-foreground',
  };
  return (
    <span
      className={cn('rounded-sm px-1.5 py-0.5 text-[9px] font-medium uppercase', colorMap[status])}
    >
      {status}
    </span>
  );
}
