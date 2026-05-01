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

interface ContactsTableProps {
  contacts: Contact[];
  loading: boolean;
  onSelect: (contact: Contact) => void;
}

export function ContactsTable({ contacts, loading, onSelect }: ContactsTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
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
            : contacts.map((c) => (
                <TableRow
                  key={c.id}
                  onClick={() => onSelect(c)}
                  className="cursor-pointer"
                >
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
              ))}
      </TableBody>
    </Table>
  );
}

function renderSkeletonRows() {
  return Array.from({ length: 6 }).map((_, i) => (
    <TableRow key={i}>
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
      <TableCell colSpan={8} className="py-16 text-center text-sm text-muted-foreground">
        Nenhum contato encontrado.
      </TableCell>
    </TableRow>
  );
}
