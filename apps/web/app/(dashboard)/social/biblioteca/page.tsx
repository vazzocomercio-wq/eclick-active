'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Image as ImageIcon, Filter } from 'lucide-react';
import { useContents, useBrands } from '@/hooks/use-social';
import type { ContentStatus, ContentType, ContentPillar } from '@/lib/api/social';
import { ContentCard } from '@/components/social/content-card';
import { Button } from '@/components/ui/button';

const STATUS_OPTIONS: Array<[ContentStatus | 'all', string]> = [
  ['all', 'Todos'],
  ['draft', 'Rascunhos'],
  ['pending_approval', 'Aguardam aprovação'],
  ['approved', 'Aprovados'],
  ['scheduled', 'Agendados'],
  ['published', 'Publicados'],
  ['rejected', 'Rejeitados'],
];

const TYPE_OPTIONS: Array<[ContentType | 'all', string]> = [
  ['all', 'Todos'],
  ['post', 'Post'],
  ['carousel', 'Carrossel'],
  ['reel', 'Reel'],
];

const PILLAR_OPTIONS: Array<[ContentPillar | 'all', string]> = [
  ['all', 'Todos'],
  ['educational', 'Educacional'],
  ['promotional', 'Promocional'],
  ['social_proof', 'Prova social'],
  ['entertainment', 'Entretenimento'],
  ['institutional', 'Institucional'],
  ['engagement', 'Engajamento'],
];

export default function BibliotecaPage() {
  const { brands } = useBrands();
  const [status, setStatus] = useState<ContentStatus | 'all'>('all');
  const [type, setType] = useState<ContentType | 'all'>('all');
  const [pillar, setPillar] = useState<ContentPillar | 'all'>('all');
  const [brandId, setBrandId] = useState<string>('all');
  const [search, setSearch] = useState('');

  const { data, loading } = useContents({
    status: status === 'all' ? undefined : status,
    content_type: type === 'all' ? undefined : type,
    pillar: pillar === 'all' ? undefined : pillar,
    brand_id: brandId === 'all' ? undefined : brandId,
    search: search || undefined,
    page_size: 50,
  });

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b border-border bg-background px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/social">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <ImageIcon className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold leading-tight">Biblioteca</h1>
            <p className="text-xs text-muted-foreground">
              {data ? `${data.total} conteúdo(s)` : 'Carregando…'}
            </p>
          </div>
        </div>
      </header>

      {/* Filtros */}
      <div className="border-b border-border bg-muted/20 px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por título ou caption…"
            className="w-48 rounded-md border border-border bg-background px-2 py-1 text-xs"
          />
          <FilterSelect
            value={status}
            onChange={(v) => setStatus(v as ContentStatus | 'all')}
            options={STATUS_OPTIONS}
          />
          <FilterSelect
            value={type}
            onChange={(v) => setType(v as ContentType | 'all')}
            options={TYPE_OPTIONS}
          />
          <FilterSelect
            value={pillar}
            onChange={(v) => setPillar(v as ContentPillar | 'all')}
            options={PILLAR_OPTIONS}
          />
          {brands.length > 1 && (
            <select
              value={brandId}
              onChange={(e) => setBrandId(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
            >
              <option value="all">Todas as marcas</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {loading && (data?.rows.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : !data || data.rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center">
            <ImageIcon className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nenhum conteúdo encontrado com esses filtros
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {data.rows.map((c) => (
              <ContentCard key={c.id} content={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-border bg-background px-2 py-1 text-xs"
    >
      {options.map(([k, l]) => (
        <option key={k} value={k}>
          {l}
        </option>
      ))}
    </select>
  );
}
