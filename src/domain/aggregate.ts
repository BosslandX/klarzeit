import {
  startOfISOWeek,
  endOfISOWeek,
  getISOWeek,
  getISOWeekYear,
  startOfMonth,
  endOfMonth,
  startOfDay,
  endOfDay,
  format,
} from 'date-fns';
import { de } from 'date-fns/locale';
import type { TimeEntry } from './types';
import { netMs } from './time';

export type PeriodKind = 'day' | 'week' | 'month' | 'range';

/** Ein abgegrenzter Auswertungszeitraum (Grenzen inklusive, epoch ms). */
export interface Period {
  kind: PeriodKind;
  from: number;
  to: number;
  label: string;
}

export function dayPeriod(ref: number): Period {
  return {
    kind: 'day',
    from: startOfDay(ref).getTime(),
    to: endOfDay(ref).getTime(),
    label: format(ref, 'EEEE, dd.MM.yyyy', { locale: de }),
  };
}

export function weekPeriod(ref: number): Period {
  const from = startOfISOWeek(ref).getTime();
  const to = endOfISOWeek(ref).getTime();
  return {
    kind: 'week',
    from,
    to,
    label: `KW ${getISOWeek(ref)} / ${getISOWeekYear(ref)} (${format(from, 'dd.MM.', { locale: de })}–${format(to, 'dd.MM.yyyy', { locale: de })})`,
  };
}

export function monthPeriod(ref: number): Period {
  return {
    kind: 'month',
    from: startOfMonth(ref).getTime(),
    to: endOfMonth(ref).getTime(),
    label: format(ref, 'MMMM yyyy', { locale: de }),
  };
}

export function rangePeriod(fromRef: number, toRef: number): Period {
  const from = startOfDay(fromRef).getTime();
  const to = endOfDay(toRef).getTime();
  return {
    kind: 'range',
    from,
    to,
    label: `${format(from, 'dd.MM.yyyy', { locale: de })} – ${format(to, 'dd.MM.yyyy', { locale: de })}`,
  };
}

/** Summe der Netto-Arbeitszeit (ms) ueber alle Eintraege. */
export function totalMs(entries: readonly TimeEntry[]): number {
  return entries.reduce((sum, e) => sum + netMs(e), 0);
}

/** Summe der Pausen in Minuten. */
export function totalBreakMinutes(entries: readonly TimeEntry[]): number {
  return entries.reduce((sum, e) => sum + e.breakMinutes, 0);
}

export interface DayGroup {
  key: string; // yyyy-MM-dd
  dayStart: number;
  label: string; // "Mo, 02.06.2026"
  entries: TimeEntry[];
  totalMs: number;
}

/** Gruppiert Eintraege nach Kalendertag (aufsteigend sortiert). */
export function groupByDay(entries: readonly TimeEntry[]): DayGroup[] {
  const map = new Map<string, DayGroup>();
  for (const e of entries) {
    const key = format(e.start, 'yyyy-MM-dd');
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        dayStart: startOfDay(e.start).getTime(),
        label: format(e.start, 'EE, dd.MM.yyyy', { locale: de }),
        entries: [],
        totalMs: 0,
      };
      map.set(key, group);
    }
    group.entries.push(e);
    group.totalMs += netMs(e);
  }
  return [...map.values()].sort((a, b) => a.dayStart - b.dayStart);
}
