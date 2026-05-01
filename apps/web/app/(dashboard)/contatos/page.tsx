'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, AlertTriangle } from 'lucide-react';
import type { Contact, ContactTemperature } from '@eclick-active/shared';
import { Button } from '@/components/ui/button';
import { useDebounce } from '@/lib/use-debounce';
import { contactsApi } from '@/lib/api/contacts';
import { ApiError } from '@/lib/api/client';
import { ContactsFilters } from '@/components/contacts/contacts-filters';
import { ContactsTable } from '@/components/contacts/contacts-table';
import { Pagination } from '@/components/contacts/pagination';
import { NewContactDialog } from '@/components/contacts/new-contact-dialog';
import { ContactDetailSheet } from '@/components/contacts/contact-detail-sheet';

const PAGE_SIZE = 25;

export default function ContatosPage() {
  // Filters
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [temperature, setTemperature] = useState<ContactTemperature | null>(null);
  const [page, setPage] = useState(1);

  // Data
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);

  // UI state
  const [selected, setSelected] = useState<Contact | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  // Reset pra página 1 quando filtros mudam
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, temperature]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const result = await contactsApi.list(
          {
            page,
            limit: PAGE_SIZE,
            search: debouncedSearch || undefined,
            temperature: temperature ?? undefined,
          },
          signal,
        );
        setContacts(result.data);
        setTotal(result.total);
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
        if (err instanceof ApiError) {
          setError({ status: err.status, message: err.message });
        } else {
          setError({ status: 0, message: err instanceof Error ? err.message : 'Erro desconhecido' });
        }
        setContacts([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [page, debouncedSearch, temperature],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  function handleSelect(contact: Contact) {
    setSelected(contact);
    setDrawerOpen(true);
  }

  function handleCreated() {
    setPage(1);
    void load();
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border px-8 py-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Contatos</h1>
          <p className="text-sm text-muted-foreground">
            Base de leads e clientes
            {total > 0 && (
              <span className="ml-2 text-foreground/70">· {total.toLocaleString('pt-BR')} no total</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Recarregar"
            title="Recarregar"
          >
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Novo contato
          </Button>
        </div>
      </header>

      {/* Auth/error banner */}
      {error && (
        <div className="flex items-center gap-3 border-b border-destructive/30 bg-destructive/10 px-8 py-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            {error.status === 401
              ? 'Sessão expirada — faça login pra carregar os contatos.'
              : error.status === 403
                ? 'Sem permissão pra ver contatos desta organização.'
                : `Erro ao carregar (${error.status || 'rede'}): ${error.message}`}
          </span>
        </div>
      )}

      <ContactsFilters
        search={search}
        onSearchChange={setSearch}
        temperature={temperature}
        onTemperatureChange={setTemperature}
      />

      {/* Tabela */}
      <div className="flex-1 overflow-auto">
        <ContactsTable contacts={contacts} loading={loading} onSelect={handleSelect} />
      </div>

      <Pagination
        page={page}
        limit={PAGE_SIZE}
        total={total}
        onPageChange={setPage}
      />

      {/* Drawer de detalhe */}
      <ContactDetailSheet
        contact={selected}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />

      {/* Modal de criação */}
      <NewContactDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />
    </div>
  );
}
