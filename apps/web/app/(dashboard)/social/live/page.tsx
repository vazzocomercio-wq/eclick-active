'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Radio,
  Loader2,
  Search,
  X,
  Package,
  Copy,
  Check,
} from 'lucide-react';
import { useBrands } from '@/hooks/use-social';
import { socialApi, type LiveScript } from '@/lib/api/social';
import { bridgeApi, type SaasProduct } from '@/lib/api/bridge';
import { Button } from '@/components/ui/button';

export default function LiveCopilotPage() {
  const { brands } = useBrands();
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<SaasProduct[]>([]);
  const [selected, setSelected] = useState<SaasProduct[]>([]);
  const [duration, setDuration] = useState(30);
  const [objective, setObjective] = useState('vender e engajar');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [script, setScript] = useState<LiveScript | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!search.trim()) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      bridgeApi
        .listProducts({ search: search.trim(), limit: 8 }, ctrl.signal)
        .then(setResults)
        .catch(() => {});
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [search]);

  function add(p: SaasProduct) {
    if (selected.length >= 10) return;
    if (selected.some((s) => s.id === p.id)) return;
    setSelected((prev) => [...prev, p]);
    setSearch('');
    setResults([]);
  }

  async function generate() {
    const brandId = brands[0]?.id;
    if (!brandId || !selected.length || busy) return;
    setBusy(true);
    setError(null);
    setScript(null);
    try {
      const s = await socialApi.live.script({
        brand_id: brandId,
        products: selected.map((p) => ({
          name: p.title ?? p.sku ?? 'Produto',
          ref: p.id,
          price: p.price,
        })),
        duration_min: duration,
        objective,
      });
      setScript(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao gerar o roteiro');
    } finally {
      setBusy(false);
    }
  }

  function copyAll() {
    if (!script) return;
    const txt = [
      `ABERTURA:\n${script.intro}`,
      `\nESTRUTURA:\n${script.structure}`,
      ...script.segments.map(
        (s, i) =>
          `\n--- BLOCO ${i + 1}: ${s.product} ---\nGancho: ${s.hook}\n${s.talking_points.map((t) => `• ${t}`).join('\n')}\nOferta: ${s.offer}\nCTA: ${s.cta}`,
      ),
      `\nENGAJAMENTO:\n${script.engagement_prompts.map((e) => `• ${e}`).join('\n')}`,
      `\nENCERRAMENTO:\n${script.closing}`,
    ].join('\n');
    void navigator.clipboard.writeText(txt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center gap-3 border-b border-border bg-background px-4 py-3 md:px-6">
        <Link href="/social" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Radio className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <h1 className="text-lg font-semibold leading-tight">Co-piloto de Live</h1>
          <p className="text-xs text-muted-foreground">
            Roteiro de live de vendas pronto pra apresentar — escolha os produtos.
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto grid max-w-3xl gap-4">
          {/* Seleção de produtos */}
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Produtos da live</h2>
            <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
              Adicione na ordem em que vai apresentar (até 10).
            </p>

            {selected.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {selected.map((p) => (
                  <span
                    key={p.id}
                    className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/5 px-2 py-1 text-xs"
                  >
                    {p.title ?? p.sku}
                    <button
                      type="button"
                      onClick={() => setSelected((prev) => prev.filter((s) => s.id !== p.id))}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar produto no catálogo…"
                className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-sm outline-none"
              />
            </div>
            {results.length > 0 && (
              <div className="mt-1 max-h-52 overflow-y-auto rounded-md border border-border">
                {results.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => add(p)}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-muted"
                  >
                    {p.thumbnail_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={p.thumbnail_url} alt="" className="h-8 w-8 rounded object-cover" />
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center rounded bg-muted">
                        <Package className="h-3.5 w-3.5 text-muted-foreground" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-xs">{p.title ?? p.sku}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  Duração (min)
                </span>
                <input
                  type="number"
                  min={5}
                  max={180}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value) || 30)}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  Objetivo
                </span>
                <input
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                />
              </label>
            </div>

            {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
            <Button
              size="sm"
              className="mt-3"
              onClick={generate}
              disabled={busy || !selected.length || !brands[0]}
            >
              {busy ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Radio className="mr-1 h-3.5 w-3.5" />
              )}
              Gerar roteiro da live
            </Button>
          </section>

          {/* Roteiro */}
          {script && (
            <section className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Roteiro da live</h2>
                <Button variant="outline" size="sm" onClick={copyAll}>
                  {copied ? (
                    <Check className="mr-1 h-3.5 w-3.5" />
                  ) : (
                    <Copy className="mr-1 h-3.5 w-3.5" />
                  )}
                  {copied ? 'Copiado' : 'Copiar tudo'}
                </Button>
              </div>

              <Block title="Abertura">{script.intro}</Block>
              <Block title="Estrutura">{script.structure}</Block>

              {script.segments.map((s, i) => (
                <div key={i} className="mb-3 rounded-lg border border-border p-3">
                  <p className="text-sm font-semibold">
                    Bloco {i + 1}: {s.product}
                  </p>
                  <p className="mt-1 text-xs italic text-muted-foreground">“{s.hook}”</p>
                  <ul className="mt-2 list-disc pl-5 text-xs">
                    {s.talking_points.map((t, j) => (
                      <li key={j}>{t}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs">
                    <strong>Oferta:</strong> {s.offer}
                  </p>
                  <p className="text-xs">
                    <strong>CTA:</strong> {s.cta}
                  </p>
                </div>
              ))}

              <Block title="Engajamento">
                <ul className="list-disc pl-5">
                  {script.engagement_prompts.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </Block>
              <Block title="Encerramento">{script.closing}</Block>

              <p className="mt-3 rounded-md border border-dashed border-border p-2 text-[11px] text-muted-foreground">
                Live ao vivo no TikTok Shop / Instagram Live com produtos fixados +
                checkout entra na próxima etapa (precisa de credenciais das
                plataformas).
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <div className="text-sm text-foreground/90">{children}</div>
    </div>
  );
}
