'use client';

import { useEffect, useState } from 'react';
import { Headphones, Plus, Trash2, Save } from 'lucide-react';
import { sacApi, type SacSlaRule, type SacResponseTemplate } from '@/lib/api/sac';
import { Button } from '@/components/ui/button';

type Tab = 'sla' | 'templates' | 'general';

export default function SacConfigPage() {
  const [tab, setTab] = useState<Tab>('sla');

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Headphones className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold">Configurações do SAC</h1>
            <p className="text-xs text-muted-foreground">Regras de SLA, templates de resposta e preferências</p>
          </div>
        </div>
      </header>

      <div className="border-b border-border px-4">
        <div className="flex gap-1">
          <TabButton active={tab === 'sla'} onClick={() => setTab('sla')}>
            Regras de SLA
          </TabButton>
          <TabButton active={tab === 'templates'} onClick={() => setTab('templates')}>
            Templates
          </TabButton>
          <TabButton active={tab === 'general'} onClick={() => setTab('general')}>
            Geral
          </TabButton>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {tab === 'sla' && <SlaTab />}
        {tab === 'templates' && <TemplatesTab />}
        {tab === 'general' && <GeneralTab />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

// ─── Tab: SLA ────────────────────────────────────────

function SlaTab() {
  const [rules, setRules] = useState<SacSlaRule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const list = await sacApi.sla.listRules();
      setRules(list);
    } finally {
      setLoading(false);
    }
  }

  async function updateRule(id: string, patch: Partial<SacSlaRule>) {
    await sacApi.sla.updateRule(id, patch);
    void load();
  }

  async function deleteRule(id: string) {
    if (!confirm('Remover esta regra?')) return;
    await sacApi.sla.deleteRule(id);
    void load();
  }

  async function createRule() {
    await sacApi.sla.createRule({
      name: 'Nova regra',
      first_response_minutes: 60,
      resolution_minutes: 480,
      business_hours_only: true,
      is_active: true,
    });
    void load();
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Regras de SLA</h2>
        <Button size="sm" onClick={createRule}>
          <Plus className="h-3.5 w-3.5" />
          <span className="ml-1">Nova regra</span>
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma regra configurada</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Nome</th>
                <th className="px-3 py-2 text-left">Prioridade</th>
                <th className="px-3 py-2 text-left">Categoria</th>
                <th className="px-3 py-2 text-left">Canal</th>
                <th className="px-3 py-2 text-left">1ª resp (min)</th>
                <th className="px-3 py-2 text-left">Resol (min)</th>
                <th className="px-3 py-2 text-left">Hor.com</th>
                <th className="px-3 py-2 text-left">Ativa</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className="border-b border-border/60">
                  <td className="px-2 py-1">
                    <input
                      defaultValue={r.name}
                      onBlur={(e) => updateRule(r.id, { name: e.target.value })}
                      className="w-full rounded-sm border border-transparent bg-transparent px-1 py-0.5 hover:border-border focus:border-primary"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      defaultValue={r.priority ?? ''}
                      onBlur={(e) => updateRule(r.id, { priority: e.target.value || null })}
                      className="w-full rounded-sm border border-transparent bg-transparent px-1 py-0.5 hover:border-border focus:border-primary"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      defaultValue={r.category ?? ''}
                      onBlur={(e) => updateRule(r.id, { category: e.target.value || null })}
                      className="w-full rounded-sm border border-transparent bg-transparent px-1 py-0.5 hover:border-border focus:border-primary"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      defaultValue={r.channel_type ?? ''}
                      onBlur={(e) => updateRule(r.id, { channel_type: e.target.value || null })}
                      className="w-full rounded-sm border border-transparent bg-transparent px-1 py-0.5 hover:border-border focus:border-primary"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      defaultValue={r.first_response_minutes}
                      onBlur={(e) => updateRule(r.id, { first_response_minutes: Number(e.target.value) })}
                      className="w-full rounded-sm border border-transparent bg-transparent px-1 py-0.5 hover:border-border focus:border-primary"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      defaultValue={r.resolution_minutes}
                      onBlur={(e) => updateRule(r.id, { resolution_minutes: Number(e.target.value) })}
                      className="w-full rounded-sm border border-transparent bg-transparent px-1 py-0.5 hover:border-border focus:border-primary"
                    />
                  </td>
                  <td className="px-2 py-1 text-center">
                    <input
                      type="checkbox"
                      defaultChecked={r.business_hours_only}
                      onChange={(e) => updateRule(r.id, { business_hours_only: e.target.checked })}
                    />
                  </td>
                  <td className="px-2 py-1 text-center">
                    <input
                      type="checkbox"
                      defaultChecked={r.is_active}
                      onChange={(e) => updateRule(r.id, { is_active: e.target.checked })}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <button
                      type="button"
                      onClick={() => deleteRule(r.id)}
                      className="text-muted-foreground hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Match: regra com mais campos preenchidos vence (priority &gt; category &gt; channel). Vazio = wildcard.
      </p>
    </div>
  );
}

// ─── Tab: Templates ──────────────────────────────────

function TemplatesTab() {
  const [templates, setTemplates] = useState<SacResponseTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SacResponseTemplate | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [content, setContent] = useState('');

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const list = await sacApi.templates.list();
      setTemplates(list);
    } finally {
      setLoading(false);
    }
  }

  function startEdit(t: SacResponseTemplate | null) {
    setEditing(t);
    setName(t?.name ?? '');
    setCategory(t?.category ?? '');
    setContent(t?.content ?? '');
  }

  async function save() {
    const body = { name, content, category: category || undefined };
    if (editing) {
      await sacApi.templates.update(editing.id, body);
    } else {
      await sacApi.templates.create(body);
    }
    setEditing(null);
    setName('');
    setCategory('');
    setContent('');
    void load();
  }

  async function remove(id: string) {
    if (!confirm('Remover este template?')) return;
    await sacApi.templates.delete(id);
    void load();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Templates de resposta</h2>
          <Button size="sm" onClick={() => startEdit(null)}>
            <Plus className="h-3.5 w-3.5" />
            <span className="ml-1">Novo</span>
          </Button>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum template criado. Crie templates pra acelerar respostas comuns.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {templates.map((t) => (
              <li
                key={t.id}
                className="flex items-start justify-between gap-2 rounded-lg border border-border bg-card p-3"
              >
                <button
                  type="button"
                  onClick={() => startEdit(t)}
                  className="flex-1 text-left"
                >
                  <div className="text-sm font-medium">{t.name}</div>
                  {t.category && (
                    <div className="text-[11px] text-muted-foreground">{t.category}</div>
                  )}
                  <p className="mt-1 line-clamp-2 text-xs text-foreground/70">{t.content}</p>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    Usos: {t.usage_count}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => remove(t.id)}
                  className="text-muted-foreground hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-3">
        <h2 className="mb-3 text-sm font-semibold">
          {editing ? 'Editar template' : 'Novo template'}
        </h2>
        <div className="flex flex-col gap-2">
          <label className="text-xs">
            <span className="text-muted-foreground">Nome</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">Categoria (opcional)</span>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="delivery_delay, refund, …"
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">
              Conteúdo — use{' '}
              <code className="rounded bg-muted px-1">{'{{cliente.nome}}'}</code>,{' '}
              <code className="rounded bg-muted px-1">{'{{pedido.numero}}'}</code>,{' '}
              <code className="rounded bg-muted px-1">{'{{pedido.rastreio}}'}</code>
            </span>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
            />
          </label>
          <div className="flex justify-end gap-2">
            {editing && (
              <Button size="sm" variant="outline" onClick={() => startEdit(null)}>
                Cancelar
              </Button>
            )}
            <Button size="sm" onClick={save} disabled={!name || !content}>
              <Save className="h-3.5 w-3.5" />
              <span className="ml-1">Salvar</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Geral ──────────────────────────────────────

function GeneralTab() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const runPreventive = async () => {
    setRunning(true);
    setResult(null);
    try {
      const r = await sacApi.runPreventive();
      setResult(`${r.created} ticket(s) preventivo(s) criados`);
    } catch {
      setResult('Falha ao rodar scan preventivo');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">SAC Preventivo</h2>
        <p className="text-xs text-muted-foreground">
          Quando a bridge SaaS está ativa, o sistema escaneia pedidos atrasados a cada hora e cria
          tickets preventivos automaticamente. Você pode disparar um scan manual agora:
        </p>
        <Button size="sm" className="mt-3" onClick={runPreventive} disabled={running}>
          {running ? 'Escaneando…' : 'Rodar scan preventivo agora'}
        </Button>
        {result && (
          <p className="mt-2 text-xs text-cyan-700 dark:text-cyan-300">{result}</p>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">Auto-classificação</h2>
        <p className="text-xs text-muted-foreground">
          Mensagens classificadas pela IA como pós-venda/suporte/reclamação com palavras-chave
          de SAC viram tickets automaticamente quando a confiança é maior que 70%. Esta regra
          está habilitada por padrão e funciona em paralelo ao Concierge.
        </p>
      </div>
    </div>
  );
}
