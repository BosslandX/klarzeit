import { addDays, getYear, startOfDay } from 'date-fns';
import type { Employment, VacationDay } from './employment';
import { workdaysInRange } from './employment';
import { toDateInput } from './time';

export interface VacationRequestRange {
  dateSince: string;
  dateUntil: string;
  dates: number[];
}

/**
 * Buendelt offene Urlaubstage zu Clockodo-Antragszeitraeumen.
 * - Ohne Clockodo-Zugang: leere Liste.
 * - Offen: Tag der Beschaeftigung, ohne clockodoAbsence, Datum >= syncFrom.
 * - Zwei Tage im selben Kalenderjahr ohne Arbeitstag dazwischen (workdaysInRange) → ein Zeitraum.
 * - Jahreswechsel trennt (Clockodo: date_until im Jahr von date_since).
 */
export function vacationRequestRanges(
  days: readonly VacationDay[],
  emp: Employment,
): VacationRequestRange[] {
  if (emp.clockodo === null) return [];
  const syncFrom = emp.clockodo.syncFrom;
  const open = days
    .filter(
      (d) =>
        d.employmentId === emp.id &&
        d.date >= syncFrom &&
        !('clockodoAbsence' in d),
    )
    .sort((a, b) => a.date - b.date);
  if (open.length === 0) return [];

  const ranges: VacationRequestRange[] = [];
  let since = open[0].date;
  let until = open[0].date;
  const dates: number[] = [open[0].date];

  const canExtend = (prev: number, next: number): boolean => {
    if (getYear(prev) !== getYear(next)) return false;
    const gapFrom = addDays(startOfDay(prev), 1).getTime();
    const gapTo = addDays(startOfDay(next), -1).getTime();
    if (gapTo < gapFrom) return true;
    return workdaysInRange(gapFrom, gapTo, emp.workdaysPerWeek).length === 0;
  };

  for (let i = 1; i < open.length; i++) {
    const d = open[i].date;
    if (canExtend(until, d)) {
      until = d;
      dates.push(d);
    } else {
      ranges.push({
        dateSince: toDateInput(since),
        dateUntil: toDateInput(until),
        dates: [...dates],
      });
      since = d;
      until = d;
      dates.length = 0;
      dates.push(d);
    }
  }
  ranges.push({
    dateSince: toDateInput(since),
    dateUntil: toDateInput(until),
    dates: [...dates],
  });
  return ranges;
}
