import { addDays, differenceInCalendarDays, startOfDay } from 'date-fns';
import { formatDate } from './time';

/**
 * Ein Zeitraum der Arbeitsunfaehigkeit (AUF-033): Kalendertage von `from` bis `to`, beide als
 * lokale Mitternacht und einschliesslich. Wochenenden gehoeren dazu -- die sechs Wochen der
 * Entgeltfortzahlung zaehlen nach Kalendertagen.
 */
export interface SickPeriod {
  employmentId: string;
  from: number;
  to: number;
  /**
   * Aerztliche Bescheinigung liegt vor; nur dann zaehlt ein Urlaubstag im Zeitraum nicht als
   * Urlaub (§ 9 BUrlG).
   */
  certificate: boolean;
}

/** Entgeltfortzahlung im Krankheitsfall "bis zur Dauer von sechs Wochen" (§ 3 Abs. 1 EntgFG). */
export const ENTGELTFORTZAHLUNG_TAGE = 42;

/** Ueberschneiden sich zwei Zeitraeume derselben Beschaeftigung? */
export function sickPeriodsOverlap(a: SickPeriod, b: SickPeriod): boolean {
  return a.employmentId === b.employmentId && a.from <= b.to && b.from <= a.to;
}

/**
 * Zeitraeume aus Speicher oder Backup: nur mit Beschaeftigung, endlichen Daten und `to` nicht vor
 * `from`; Daten auf Mitternacht, `certificate` nur bei `true`. Nach Beginn sortiert; ein Zeitraum,
 * der einen frueheren derselben Beschaeftigung ueberschneidet, entfaellt.
 */
export function cleanSickPeriods(raw: unknown): SickPeriod[] {
  if (!Array.isArray(raw)) return [];
  const kandidaten: SickPeriod[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const x = item as Record<string, unknown>;
    if (typeof x.employmentId !== 'string' || x.employmentId === '') continue;
    if (typeof x.from !== 'number' || !Number.isFinite(x.from)) continue;
    if (typeof x.to !== 'number' || !Number.isFinite(x.to)) continue;
    const from = startOfDay(x.from).getTime();
    const to = startOfDay(x.to).getTime();
    if (to < from) continue;
    kandidaten.push({ employmentId: x.employmentId, from, to, certificate: x.certificate === true });
  }
  return [...kandidaten]
    .sort((a, b) => a.from - b.from || a.to - b.to)
    .reduce<SickPeriod[]>(
      (out, p) => (out.some((q) => sickPeriodsOverlap(q, p)) ? out : [...out, p]),
      [],
    );
}

/**
 * Zusammenfuehren beim Backup-Import: ein eingehender Zeitraum, der einen lokalen derselben
 * Beschaeftigung ueberschneidet, entfaellt.
 */
export function mergeSickPeriods(
  local: readonly SickPeriod[],
  incoming: readonly SickPeriod[],
): SickPeriod[] {
  const neu = incoming.filter((p) => !local.some((q) => sickPeriodsOverlap(q, p)));
  return cleanSickPeriods([...local, ...neu]);
}

/** Kalendertage der Zeitraeume einer Beschaeftigung, je mit der Angabe, ob bescheinigt. */
export function sickDaysOf(
  periods: readonly SickPeriod[],
  employmentId: string,
): Map<number, boolean> {
  const tage = new Map<number, boolean>();
  for (const p of periods) {
    if (p.employmentId !== employmentId) continue;
    for (let tag = new Date(p.from); tag.getTime() <= p.to; tag = addDays(tag, 1)) {
      tage.set(tag.getTime(), p.certificate);
    }
  }
  return tage;
}

/**
 * Urlaub und Krankheit einer Beschaeftigung trennen (§ 9 BUrlG): Ein Urlaubstag in einem Zeitraum
 * mit Bescheinigung zaehlt nicht als Urlaub, sondern als Krankheitstag; ohne Bescheinigung bleibt
 * er Urlaub und ist kein Krankheitstag. Ergebnis: die Tage fuer Konto und Urlaubsstand.
 */
export function splitVacationAndSickness(
  vacationDates: readonly number[],
  periods: readonly SickPeriod[],
  employmentId: string,
): { vacationDates: number[]; sickDates: number[] } {
  const krank = sickDaysOf(periods, employmentId);
  const urlaub = new Set(vacationDates.map((d) => startOfDay(d).getTime()));
  return {
    vacationDates: vacationDates.filter((d) => krank.get(startOfDay(d).getTime()) !== true),
    sickDates: [...krank]
      .filter(([tag, bescheinigt]) => bescheinigt || !urlaub.has(tag))
      .map(([tag]) => tag)
      .sort((a, b) => a - b),
  };
}

/**
 * Zusammenhaengende Krankheitszeiten einer Beschaeftigung, die laenger als sechs Wochen dauern
 * (§ 3 Abs. 1 EntgFG). Aneinandergrenzende Zeitraeume (Folgebescheinigung) zaehlen als einer; ob
 * es dieselbe Krankheit ist, weiss die App nicht.
 */
export function longSickRuns(
  periods: readonly SickPeriod[],
  employmentId: string,
): { from: number; to: number; days: number }[] {
  const eigene = periods
    .filter((p) => p.employmentId === employmentId)
    .sort((a, b) => a.from - b.from);
  const laeufe = eigene.reduce<{ from: number; to: number }[]>((out, p) => {
    const letzter = out[out.length - 1];
    if (letzter !== undefined && differenceInCalendarDays(p.from, letzter.to) <= 1) {
      return [...out.slice(0, -1), { from: letzter.from, to: Math.max(letzter.to, p.to) }];
    }
    return [...out, { from: p.from, to: p.to }];
  }, []);
  return laeufe
    .map((l) => ({ ...l, days: differenceInCalendarDays(l.to, l.from) + 1 }))
    .filter((l) => l.days > ENTGELTFORTZAHLUNG_TAGE);
}

/** Der Zeitraum einer Beschaeftigung, in dem ein Tag liegt; sonst undefined (AUF-034). */
export function sickPeriodOn(
  periods: readonly SickPeriod[],
  employmentId: string,
  date: number,
): SickPeriod | undefined {
  const tag = startOfDay(date).getTime();
  return periods.find((p) => p.employmentId === employmentId && p.from <= tag && tag <= p.to);
}

/** Listenzeile, z. B. "02.11.2026 bis 13.11.2026 (12 Kalendertage), mit Bescheinigung". */
export function sickPeriodLabel(p: SickPeriod): string {
  const tage = differenceInCalendarDays(p.to, p.from) + 1;
  const spanne =
    p.from === p.to ? formatDate(p.from) : `${formatDate(p.from)} bis ${formatDate(p.to)}`;
  const anzahl = `${tage} ${tage === 1 ? 'Kalendertag' : 'Kalendertage'}`;
  return `${spanne} (${anzahl}), ${p.certificate ? 'mit' : 'ohne'} Bescheinigung`;
}

/** Hinweis zu einer zusammenhaengenden Krankheit ueber sechs Wochen (aus longSickRuns). */
export function longSickHint(run: { from: number; to: number; days: number }): string {
  return (
    `Krank vom ${formatDate(run.from)} bis ${formatDate(run.to)} (${run.days} Kalendertage): ` +
    'Die Entgeltfortzahlung durch den Arbeitgeber dauert hoechstens sechs Wochen ' +
    '(§ 3 Abs. 1 EntgFG). Das Konto rechnet die Tage weiter ohne Minusstunden.'
  );
}

/**
 * Wartezeit: Der Anspruch auf Entgeltfortzahlung „entsteht nach vierwöchiger ununterbrochener Dauer
 * des Arbeitsverhältnisses“ (§ 3 Abs. 3 EntgFG). Vier Wochen sind 28 Kalendertage ab „Beschaeftigt
 * seit“; der letzte Tag der Wartezeit ist der Beginn plus 27 Tage.
 */
export const WARTEZEIT_TAGE = 28;

/**
 * Krankheitszeiten einer Beschaeftigung, die in ihre Wartezeit fallen (AUF-041), samt deren letztem
 * Tag; null, wenn keine hineinfaellt. Das Konto rechnet sie weiter wie jede Krankheit.
 */
export function waitingPeriodSick(
  periods: readonly SickPeriod[],
  employmentId: string,
  employmentStart: number,
): { until: number; periods: SickPeriod[] } | null {
  const beginn = startOfDay(employmentStart);
  const until = addDays(beginn, WARTEZEIT_TAGE - 1).getTime();
  const betroffen = periods.filter(
    (p) => p.employmentId === employmentId && p.from <= until && p.to >= beginn.getTime(),
  );
  return betroffen.length > 0 ? { until, periods: betroffen } : null;
}

/** Hinweis zur Wartezeit (aus waitingPeriodSick, AUF-041). */
export function waitingPeriodHint(w: { until: number }): string {
  return (
    `Krank in den ersten vier Wochen der Beschaeftigung (bis ${formatDate(w.until)}): ` +
    'Der Anspruch auf Entgeltfortzahlung entsteht erst nach vierwoechiger ununterbrochener Dauer ' +
    'des Arbeitsverhaeltnisses (§ 3 Abs. 3 EntgFG). Das Konto rechnet die Tage weiter ohne Minusstunden.'
  );
}
