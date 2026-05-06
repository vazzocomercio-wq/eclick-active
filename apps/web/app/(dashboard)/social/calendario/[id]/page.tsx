'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Calendar as CalIcon } from 'lucide-react';
import { socialApi, type SocialCalendar } from '@/lib/api/social';
import { useContents } from '@/hooks/use-social';
import { ContentCard } from '@/components/social/content-card';
import { Button } from '@/components/ui/button';

export default function CalendarDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? null;
  const [calendar, setCalendar] = useState<SocialCalendar | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const c = await socialApi.calendars.get(id);
        setCalendar(c);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const { data: contents } = useContents({
    calendar_id: id ?? undefined,
    page_size: 100,
  });

  if (loading || !calendar) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b border-border bg-background px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/social/calendario">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <CalIcon className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold leading-tight">{calendar.name}</h1>
            <p className="text-xs text-muted-foreground">
              {calendar.start_date} → {calendar.end_date} · {calendar.objective}
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <h2 className="mb-3 text-sm font-semibold">
          Conteúdos ({contents?.total ?? 0})
        </h2>
        {!contents || contents.rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
            Calendário vazio
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {contents.rows.map((c) => (
              <ContentCard key={c.id} content={c} compact />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
