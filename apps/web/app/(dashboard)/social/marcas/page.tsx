'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, ArrowLeft, Megaphone } from 'lucide-react';
import { useBrands } from '@/hooks/use-social';
import { socialApi } from '@/lib/api/social';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function MarcasPage() {
  const router = useRouter();
  const { brands, loading, refresh } = useBrands();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [creatingNow, setCreatingNow] = useState(false);

  const create = async () => {
    if (!newName.trim()) return;
    setCreatingNow(true);
    try {
      const b = await socialApi.brands.create({ name: newName.trim() });
      router.push(`/social/marcas/${b.id}`);
    } catch {
      setCreatingNow(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b border-border bg-background px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/social">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <Megaphone className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Marcas</h1>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5" />
          <span className="ml-1">Nova marca</span>
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {creating && (
          <div className="mb-4 rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-4">
            <h2 className="mb-2 text-sm font-semibold">Nova marca</h2>
            <div className="flex gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nome da marca (ex: Vazzo Comércio)"
                className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void create();
                  if (e.key === 'Escape') setCreating(false);
                }}
              />
              <Button size="sm" onClick={create} disabled={creatingNow || !newName.trim()}>
                {creatingNow ? 'Criando…' : 'Criar'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setCreating(false)}>
                Cancelar
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Você completa identidade visual, tom de voz e linha editorial na próxima tela.
            </p>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : brands.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
            <Megaphone className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nenhuma marca configurada ainda. Crie a primeira pra começar a gerar conteúdos.
            </p>
            <Button size="sm" className="mt-3" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" />
              <span className="ml-1">Criar marca</span>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {brands.map((b) => (
              <Link
                key={b.id}
                href={`/social/marcas/${b.id}`}
                className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
              >
                <div className="flex items-center gap-2">
                  {b.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={b.logo_url}
                      alt=""
                      className="h-10 w-10 rounded-md object-cover"
                    />
                  ) : (
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-md text-sm font-bold text-white"
                      style={{
                        background: `linear-gradient(135deg, ${b.primary_color}, ${b.secondary_color})`,
                      }}
                    >
                      {b.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="flex flex-1 flex-col leading-tight">
                    <span className="text-sm font-semibold">{b.name}</span>
                    {b.niche && (
                      <span className="text-xs text-muted-foreground">{b.niche}</span>
                    )}
                  </div>
                  {!b.is_active && (
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      Inativa
                    </span>
                  )}
                </div>
                {b.description && (
                  <p className="line-clamp-2 text-xs text-foreground/70">{b.description}</p>
                )}
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span
                    className={cn(
                      'inline-block h-3 w-3 rounded-full border border-border',
                    )}
                    style={{ background: b.primary_color }}
                  />
                  <span
                    className={cn(
                      'inline-block h-3 w-3 rounded-full border border-border',
                    )}
                    style={{ background: b.secondary_color }}
                  />
                  <span>· tom: {b.tone_of_voice}</span>
                </div>
              </Link>
            ))}
          </div>
        )}

        {brands.length > 0 && !creating && (
          <Button
            size="sm"
            variant="ghost"
            className="mt-4"
            onClick={() => void refresh()}
          >
            Atualizar lista
          </Button>
        )}
      </div>
    </div>
  );
}
