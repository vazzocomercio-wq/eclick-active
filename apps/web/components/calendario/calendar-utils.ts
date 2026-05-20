import type { TaskType } from '@eclick-active/shared';

export type CalendarViewMode = 'day' | 'week' | 'month';

// ──────────────────────────────────────────────────────────
// Cores por tipo de tarefa (pills + blocos)
// Tailwind classes que funcionam em dark+light.
// ──────────────────────────────────────────────────────────

export interface TaskTypeStyle {
  bg: string;
  border: string;
  text: string;
  /** Cor de barra lateral em blocos de week/day view */
  side: string;
}

export const TASK_TYPE_STYLES: Record<TaskType, TaskTypeStyle> = {
  call: {
    bg: 'bg-blue-500/15',
    border: 'border-blue-500/30',
    text: 'text-blue-700 dark:text-blue-300',
    side: 'bg-blue-500',
  },
  meeting: {
    bg: 'bg-purple-500/15',
    border: 'border-purple-500/30',
    text: 'text-purple-700 dark:text-purple-300',
    side: 'bg-purple-500',
  },
  follow_up: {
    bg: 'bg-cyan-500/15',
    border: 'border-cyan-500/30',
    text: 'text-cyan-700 dark:text-cyan-300',
    side: 'bg-cyan-500',
  },
  email: {
    bg: 'bg-green-500/15',
    border: 'border-green-500/30',
    text: 'text-green-700 dark:text-green-300',
    side: 'bg-green-500',
  },
  whatsapp: {
    bg: 'bg-emerald-500/15',
    border: 'border-emerald-500/30',
    text: 'text-emerald-700 dark:text-emerald-300',
    side: 'bg-emerald-500',
  },
  proposal: {
    bg: 'bg-amber-500/15',
    border: 'border-amber-500/30',
    text: 'text-amber-700 dark:text-amber-300',
    side: 'bg-amber-500',
  },
  custom: {
    bg: 'bg-slate-500/15',
    border: 'border-slate-500/30',
    text: 'text-slate-700 dark:text-slate-300',
    side: 'bg-slate-500',
  },
};

// ──────────────────────────────────────────────────────────
// Date helpers (todos em timezone local)
// ──────────────────────────────────────────────────────────

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Segunda-feira como início da semana (pt-BR) */
export function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay(); // 0=dom, 1=seg...
  const diff = day === 0 ? -6 : 1 - day; // se domingo, volta 6 dias
  x.setDate(x.getDate() + diff);
  return x;
}

export function endOfWeek(d: Date): Date {
  const start = startOfWeek(d);
  return endOfDay(addDays(start, 6));
}

export function startOfMonth(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), 1);
  return startOfDay(x);
}

export function endOfMonth(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return endOfDay(x);
}

/** Range completo da grid mensal (começa na segunda da 1a semana, termina no domingo da última) */
export function monthGridRange(d: Date): { from: Date; to: Date } {
  const from = startOfWeek(startOfMonth(d));
  const to = endOfWeek(endOfMonth(d));
  return { from, to };
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function toDateKey(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function fromDateKey(key: string): Date {
  const [yyyy, mm, dd] = key.split('-').map(Number);
  return new Date(yyyy ?? 1970, (mm ?? 1) - 1, dd ?? 1);
}

// ──────────────────────────────────────────────────────────
// Formatação
// ──────────────────────────────────────────────────────────

const MONTH_KEYS = [
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

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

type Translator = (key: string) => string;

export function monthYearLabel(d: Date, t: Translator): string {
  const monthKey = MONTH_KEYS[d.getMonth()] ?? '1';
  return `${t(`month.names.${monthKey}`)} ${d.getFullYear()}`;
}

export function weekRangeLabel(d: Date, t: Translator): string {
  const start = startOfWeek(d);
  const end = addDays(start, 6);
  const startKey = MONTH_KEYS[start.getMonth()] ?? '1';
  const endKey = MONTH_KEYS[end.getMonth()] ?? '1';
  if (start.getMonth() === end.getMonth()) {
    return `${start.getDate()} – ${end.getDate()} ${t(`month.shortNames.${endKey}`)} ${end.getFullYear()}`;
  }
  return `${start.getDate()} ${t(`month.shortNames.${startKey}`)} – ${end.getDate()} ${t(`month.shortNames.${endKey}`)} ${end.getFullYear()}`;
}

export function dayLabel(d: Date, t: Translator): string {
  const wd = d.getDay() === 0 ? 6 : d.getDay() - 1;
  const wdKey = WEEKDAY_KEYS[wd] ?? 'mon';
  const monthKey = MONTH_KEYS[d.getMonth()] ?? '1';
  return `${t(`weekdayShort.${wdKey}`)}, ${d.getDate()} ${t(`month.shortNames.${monthKey}`)}`;
}

export const WEEKDAY_HEADER_KEYS = WEEKDAY_KEYS;

/** Formata HH:mm da data ISO. Retorna null se a data não tem componente de hora útil. */
export function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Hora (0-23) ou null se data inválida */
export function getHour(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.getHours();
}

/** Minuto (0-59) */
export function getMinutes(iso: string): number {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  return d.getMinutes();
}

// ──────────────────────────────────────────────────────────
// Misc
// ──────────────────────────────────────────────────────────

export const HOUR_RANGE = { start: 8, end: 20 } as const;
export const HOURS_VISIBLE = HOUR_RANGE.end - HOUR_RANGE.start; // 12 horas
export const HOUR_HEIGHT_PX = 56;

export function hasTimeComponent(iso: string): boolean {
  // Se a string tem T...:00 ou similar — heurística simples
  // Se a hora é exatamente 00:00, ainda consideramos "com hora" pra colocar no slot 0h.
  // O backend salva sempre com hora; fica no topo do dia se for >= 20h ou < 8h.
  return /T\d{2}:/.test(iso);
}

/** Retorna a posição vertical (px) dentro da grid de horas. Clampa fora do range para topo. */
export function hourSlotTop(iso: string): number {
  const h = getHour(iso);
  const m = getMinutes(iso);
  if (h === null) return 0;
  if (h < HOUR_RANGE.start) return 0;
  if (h >= HOUR_RANGE.end) return HOURS_VISIBLE * HOUR_HEIGHT_PX - HOUR_HEIGHT_PX;
  return (h - HOUR_RANGE.start) * HOUR_HEIGHT_PX + (m / 60) * HOUR_HEIGHT_PX;
}
