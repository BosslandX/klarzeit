import { addDays, getYear, startOfDay } from 'date-fns';
import type { Employment, VacationDay } from './employment';
import { workdaysInRange } from './employment';
import type { ClockodoAbsenceRef, ClockodoAbsenceStatus } from './clockodo';
import { sickPeriodOn, type SickPeriod } from './sickness';
import { toDateInput } from './time';

export interface VacationRequestRange {
  dateSince: string;
  dateUntil: string;
  dates: number[];
  /** Ein halber Urlaubstag, immer allein im Zeitraum (AUF-047); fehlt = ganze Tage. */
  halfDay?: true;
}

/**
 * Zaehlt der Urlaubstag als Krankheit mit Bescheinigung? Dann ist er kein Urlaub (§ 9 BUrlG,
 * wie in splitVacationAndSickness; AUF-038).
 */
function zaehltAlsKrankheit(day: VacationDay, sickPeriods: readonly SickPeriod[]): boolean {
  return sickPeriodOn(sickPeriods, day.employmentId, day.date)?.certificate === true;
}

/**
 * Buendelt offene Urlaubstage zu Clockodo-Antragszeitraeumen.
 * - Ohne Clockodo-Zugang: leere Liste.
 * - Offen: Tag der Beschaeftigung, ohne clockodoAbsence, Datum >= syncFrom, kein Krankheitstag
 *   mit Bescheinigung (zaehltAlsKrankheit; er ist kein Urlaub, AUF-038).
 * - Zwei Tage im selben Kalenderjahr ohne Arbeitstag dazwischen (workdaysInRange) → ein Zeitraum.
 * - Jahreswechsel trennt (Clockodo: date_until im Jahr von date_since).
 * - Ein halber Tag ist ein eigener Zeitraum mit `halfDay` (AUF-047): Clockodo laesst einen halben
 *   Tag nicht ueber mehrere Tage laufen (HalfDayAbsenceTooLong).
 */
export function vacationRequestRanges(
  days: readonly VacationDay[],
  emp: Employment,
  sickPeriods: readonly SickPeriod[] = [],
): VacationRequestRange[] {
  if (emp.clockodo === null) return [];
  const syncFrom = emp.clockodo.syncFrom;
  const open = days
    .filter(
      (d) =>
        d.employmentId === emp.id &&
        d.date >= syncFrom &&
        d.clockodoAbsence === undefined &&
        !zaehltAlsKrankheit(d, sickPeriods),
    )
    .sort((a, b) => a.date - b.date);
  if (open.length === 0) return [];

  const ranges: VacationRequestRange[] = [];
  let since = open[0].date;
  let until = open[0].date;
  let halb = open[0].halfDay === true;
  const dates: number[] = [open[0].date];

  const canExtend = (prev: number, next: number): boolean => {
    if (getYear(prev) !== getYear(next)) return false;
    const gapFrom = addDays(startOfDay(prev), 1).getTime();
    const gapTo = addDays(startOfDay(next), -1).getTime();
    if (gapTo < gapFrom) return true;
    return workdaysInRange(gapFrom, gapTo, emp).length === 0;
  };

  const abschliessen = () =>
    ranges.push({
      dateSince: toDateInput(since),
      dateUntil: toDateInput(until),
      dates: [...dates],
      ...(halb ? { halfDay: true as const } : {}),
    });

  for (let i = 1; i < open.length; i++) {
    const d = open[i].date;
    // Ein halber Tag verlaengert keinen Zeitraum und wird von keinem verlaengert (AUF-047).
    if (!halb && open[i].halfDay !== true && canExtend(until, d)) {
      until = d;
      dates.push(d);
    } else {
      abschliessen();
      since = d;
      until = d;
      halb = open[i].halfDay === true;
      dates.length = 0;
      dates.push(d);
    }
  }
  abschliessen();
  return ranges;
}

/**
 * Setzt den Clockodo-Verweis an den genannten Tagen einer Beschaeftigung; alle
 * anderen Tage -- auch derselbe Kalendertag einer anderen Beschaeftigung -- bleiben
 * unberuehrt. Liefert eine neue Liste.
 */
export function applyAbsenceRef(
  days: readonly VacationDay[],
  employmentId: string,
  dates: readonly number[],
  ref: ClockodoAbsenceRef,
): VacationDay[] {
  const wanted = new Set(dates);
  return days.map((d) => {
    if (d.employmentId !== employmentId || !wanted.has(d.date)) return d;
    return { ...d, clockodoAbsence: ref };
  });
}

/**
 * Zieht den Status bekannter Antraege einer Beschaeftigung aus der Clockodo-Liste nach:
 * anderer Status -> neuer Verweis mit neuer Zeit (`updated`); gleicher Status -> unveraendert;
 * ID nicht in der Liste -> Verweis bleibt, der Tag zaehlt in `missing`.
 */
export function syncAbsenceStatus(
  days: readonly VacationDay[],
  employmentId: string,
  known: readonly { id: number; status: ClockodoAbsenceStatus }[],
  now: number,
): { days: VacationDay[]; updated: number; missing: number } {
  const byId = new Map(known.map((k) => [k.id, k.status]));
  let updated = 0;
  let missing = 0;
  const out = days.map((d) => {
    if (d.employmentId !== employmentId || d.clockodoAbsence === undefined) return d;
    const id = d.clockodoAbsence.id;
    const status = byId.get(id);
    if (status === undefined) {
      missing++;
      return d;
    }
    if (status === d.clockodoAbsence.status) return d;
    updated++;
    return { ...d, clockodoAbsence: { id, status, at: now } };
  });
  return { days: out, updated, missing };
}

const ABSENCE_STATUS_LABELS: Record<ClockodoAbsenceStatus, string> = {
  0: 'beantragt',
  1: 'genehmigt',
  2: 'abgelehnt',
  3: 'Genehmigung zurueckgenommen',
  4: 'storniert',
};

/** Anzeige des Clockodo-Stands eines Urlaubstags; ohne Verweis "nicht beantragt". */
export function absenceStatusLabel(ref: ClockodoAbsenceRef | undefined): string {
  if (ref === undefined) return 'nicht beantragt';
  return ABSENCE_STATUS_LABELS[ref.status];
}

/**
 * Ein beantragter oder genehmigter Urlaubstag laesst sich in Klarzeit nicht entfernen, er
 * stuende sonst weiter in Clockodo; abgelehnte, zurueckgenommene und stornierte darf der
 * Nutzer entfernen, die App tut es nie selbst.
 */
export function isVacationDayRemovable(day: VacationDay): boolean {
  if (day.clockodoAbsence === undefined) return true;
  return day.clockodoAbsence.status >= 2;
}

/** Zahl der offenen Urlaubstage einer Beschaeftigung (Summe ueber vacationRequestRanges). */
export function openVacationDayCount(
  days: readonly VacationDay[],
  emp: Employment,
  sickPeriods: readonly SickPeriod[] = [],
): number {
  return vacationRequestRanges(days, emp, sickPeriods).reduce(
    (sum, range) => sum + range.dates.length,
    0,
  );
}

/** Die Urlaubstage einer Beschaeftigung, die diesen Clockodo-Antrag tragen. */
export function daysOfAbsence(
  days: readonly VacationDay[],
  employmentId: string,
  absenceId: number,
): VacationDay[] {
  return days.filter(
    (d) => d.employmentId === employmentId && d.clockodoAbsence?.id === absenceId,
  );
}

/** Hinweis am Urlaubstag, wenn isSickInClockodoVacation zutrifft (AUF-038). */
export const CLOCKODO_SICK_HINT = 'dort weiter als Urlaub, Klarzeit aendert den Antrag nicht';

/**
 * Ein in Clockodo beantragter oder genehmigter Urlaubstag, der hier als Krankheit mit Bescheinigung
 * zaehlt (§ 9 BUrlG): Clockodo fuehrt ihn weiter als Urlaub, Klarzeit aendert den Antrag nicht
 * (AUF-038).
 */
export function isSickInClockodoVacation(
  day: VacationDay,
  sickPeriods: readonly SickPeriod[],
): boolean {
  const status = day.clockodoAbsence?.status;
  return (status === 0 || status === 1) && zaehltAlsKrankheit(day, sickPeriods);
}
