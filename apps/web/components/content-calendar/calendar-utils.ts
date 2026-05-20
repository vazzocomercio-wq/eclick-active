/**
 * Utilities de calendário sem dependência externa (sem date-fns/dayjs).
 * Suficiente pra montar grade do mês + ranges de semana.
 */

export interface CalendarDay {
  date: Date;
  inMonth: boolean;
}

/**
 * Constrói grade 7×N do mês de `cursor`. Inclui dias do mês anterior/seguinte
 * pra completar a primeira/última semana. Sempre 6 linhas (42 células) pra
 * altura constante da grade.
 */
export function buildMonthGrid(cursor: Date): CalendarDay[] {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay(); // 0=domingo

  const days: CalendarDay[] = [];
  // 6 semanas × 7 dias = 42 células
  const start = new Date(year, month, 1 - startWeekday);
  for (let i = 0; i < 42; i++) {
    const date = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + i,
    );
    days.push({ date, inMonth: date.getMonth() === month });
  }
  return days;
}

/** Formata YYYY-MM-DD em UTC sem timezone shift. */
export function formatDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function shiftMonth(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

export function shiftDays(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta);
}

/** Início da semana contendo `d` (domingo). */
export function startOfWeek(d: Date): Date {
  const wd = d.getDay();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - wd);
}

export function buildWeekDays(cursor: Date): Date[] {
  const start = startOfWeek(cursor);
  return Array.from({ length: 7 }, (_, i) => shiftDays(start, i));
}

const MONTH_NAME_KEYS = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
] as const;

const WEEKDAY_NAME_KEYS = [
  'sun',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
] as const;

type Translator = (key: string, values?: Record<string, string | number>) => string;

export function formatMonthYear(d: Date, t: Translator): string {
  const key = MONTH_NAME_KEYS[d.getMonth()] ?? '1';
  return t('monthYear', { month: t(`month.names.${key}`), year: d.getFullYear() });
}

export function formatLongDate(d: Date, t: Translator): string {
  const wdKey = WEEKDAY_NAME_KEYS[d.getDay()] ?? 'sun';
  const monthKey = MONTH_NAME_KEYS[d.getMonth()] ?? '1';
  return t('longDate', {
    weekday: t(`weekdayLong.${wdKey}`),
    day: d.getDate(),
    month: t(`month.names.${monthKey}`),
  });
}

/** Soma N dias num "YYYY-MM-DD" e retorna formatado igual. */
export function addDaysIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y!, (m ?? 1) - 1, (d ?? 1) + days);
  return formatDateKey(date);
}
