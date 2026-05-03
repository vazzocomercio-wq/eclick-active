'use client';

import type { Contact } from '@eclick-active/shared';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { InitialsAvatar } from './initials-avatar';
import { TemperatureBadge } from './temperature-badge';
import { ScoreBar } from './score-bar';
import { TagPills } from './tag-pills';
import { formatPhone, formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

interface ContactsTableProps {
  contacts: Contact[];
  loading: boolean;
  onSelect: (contact: Contact) => void;
  /** IDs selecionados (Set) — controlado pelo pai. */
  selectedIds: Set<string>;
  onToggleOne: (id: string) => void;
  onToggleAll: () => void;
}

export function ContactsTable({
  contacts,
  loading,
  onSelect,
  selectedIds,
  onToggleOne,
  onToggleAll,
}: ContactsTableProps) {
  const allChecked = contacts.length > 0 && contacts.every((c) => selectedIds.has(c.id));
  const someChecked = !allChecked && contacts.some((c) => selectedIds.has(c.id));

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[40px]">
            <input
              type="checkbox"
              aria-label="Selecionar todos"
              checked={allChecked}
              ref={(el) => {
                if (el) el.indeterminate = someChecked;
              }}
              onChange={onToggleAll}
              className="h-4 w-4 cursor-pointer accent-primary"
              disabled={loading || contacts.length === 0}
            />
          </TableHead>
          <TableHead className="w-[60px]">Contato</TableHead>
          <TableHead>Nome</TableHead>
          <TableHead>Telefone</TableHead>
          <TableHead>Email</TableHead>
          <TableHead className="w-[120px]">Temperatura</TableHead>
          <TableHead className="w-[140px]">Score</TableHead>
          <TableHead>Tags</TableHead>
          <TableHead className="w-[120px] text-right">Última atividade</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading
          ? renderSkeletonRows()
          : contacts.length === 0
            ? renderEmpty()
            : contacts.map((c) => {
                const checked = selectedIds.has(c.id);
                return (
                  <TableRow
                    key={c.id}
                    onClick={() => onSelect(c)}
                    className={cn(
                      'cursor-pointer transition-colors',
                      checked && 'bg-primary/5',
                    )}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Selecionar ${c.name ?? 'contato'}`}
                        checked={checked}
                        onChange={() => onToggleOne(c.id)}
                        className="h-4 w-4 cursor-pointer accent-primary"
                      />
                    </TableCell>
                    <TableCell>
                      <InitialsAvatar name={c.name} src={c.avatar_url} />
                    </TableCell>
                    <TableCell className="font-medium text-foreground">
                      {c.name ?? <span className="text-muted-foreground">sem nome</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.phone ? formatPhone(c.phone) : '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.email ?? '—'}</TableCell>
                    <TableCell>
                      <TemperatureBadge temperature={c.temperature} />
                    </TableCell>
                    <TableCell>
                      <ScoreBar score={c.score} />
                    </TableCell>
                    <TableCell>
                      <TagPills tags={c.tags} />
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {formatRelativeTime(c.updated_at)}
                    </TableCell>
                  </TableRow>
                );
              })}
      </TableBody>
    </Table>
  );
}

function renderSkeletonRows() {
  return Array.from({ length: 6 }).map((_, i) => (
    <TableRow key={i}>
      <TableCell>
        <Skeleton className="h-4 w-4 rounded" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-9 w-9 rounded-full" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-32" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-28" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-40" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-20 rounded-md" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-1.5 w-24 rounded-full" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-24" />
      </TableCell>
      <TableCell>
        <Skeleton className="ml-auto h-4 w-16" />
      </TableCell>
    </TableRow>
  ));
}

function renderEmpty() {
  return (
    <TableRow>
      <TableCell colSpan={9} className="py-16 text-center text-sm text-muted-foreground">
        Nenhum contato encontrado.
      </TableCell>
    </TableRow>
  );
}
