import { getYear } from 'date-fns';
import {
  ClockodoError,
  cancelAbsence,
  createAbsence,
  deleteAbsence,
  fetchAbsences,
  fetchMe,
  type ClockodoAbsence,
  type ClockodoAuth,
  type ClockodoHttp,
} from './client';
import { getClockodoKey } from './key-store';
import {
  daysOfAbsence,
  syncAbsenceStatus,
  vacationRequestRanges,
} from '../domain/clockodo-absence';
import type { Employment, VacationDay } from '../domain/employment';
import { formatDate, fromDateInput, toDateInput } from '../domain/time';
import {
  getEmployments,
  getVacationDays,
  saveVacationDays,
  removeVacationDaysOfAbsence,
  setVacationAbsenceRef,
} from '../db/employment';

export interface VacationTransferResult {
  requested: number;
  adopted: number;
  updated: number;
  missing: number;
  mismatches: {
    dateSince: string;
    dateUntil: string;
    klarzeitDays: number;
    clockodoDays: number;
  }[];
  errors: { dateSince: string; dateUntil: string; message: string }[];
  stopped: string | null;
}

type ClockodoZugang =
  | { ok: true; employment: Employment; auth: ClockodoAuth }
  | { ok: false; stopped: string };

/** Zugang einer Beschaeftigung zu Clockodo; Meldungen wie in transferEmployment. */
async function clockodoZugang(employmentId: string): Promise<ClockodoZugang> {
  const list = await getEmployments();
  const employment = list.find((e) => e.id === employmentId);
  if (!employment) {
    return { ok: false, stopped: 'Clockodo ist fuer diese Beschaeftigung nicht eingeschaltet.' };
  }
  const config = employment.clockodo;
  if (config === null) {
    return { ok: false, stopped: 'Clockodo ist fuer diese Beschaeftigung nicht eingeschaltet.' };
  }
  if (!config.apiUser.trim()) {
    return { ok: false, stopped: 'Clockodo-Login fehlt.' };
  }
  const apiKey = await getClockodoKey(employmentId);
  if (!apiKey) {
    return { ok: false, stopped: 'API-Schluessel fehlt.' };
  }
  return { ok: true, employment, auth: { apiUser: config.apiUser.trim(), apiKey } };
}

function emptyResult(): VacationTransferResult {
  return {
    requested: 0,
    adopted: 0,
    updated: 0,
    missing: 0,
    mismatches: [],
    errors: [],
    stopped: null,
  };
}

/** Wie isFatal in src/clockodo/transfer.ts */
function isFatal(err: ClockodoError): boolean {
  return err.kind === 'auth' || err.kind === 'network' || err.kind === 'rate';
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function yearsForTransfer(
  days: readonly VacationDay[],
  employmentId: string,
  ranges: ReturnType<typeof vacationRequestRanges>,
): number[] {
  const years = new Set<number>();
  for (const d of days) {
    if (d.employmentId === employmentId && d.clockodoAbsence !== undefined) {
      years.add(getYear(d.date));
    }
  }
  for (const r of ranges) {
    years.add(Number.parseInt(r.dateSince.slice(0, 4), 10));
    years.add(Number.parseInt(r.dateUntil.slice(0, 4), 10));
  }
  return [...years].sort((a, b) => a - b);
}

function findMatchingAbsence(
  all: readonly ClockodoAbsence[],
  dateSince: string,
  dateUntil: string,
): ClockodoAbsence | undefined {
  return all.find((a) => a.dateSince === dateSince && a.dateUntil === dateUntil);
}

/**
 * Urlaubstage einer Beschaeftigung mit Clockodo abgleichen:
 * 1. Zugang pruefen (wie transferEmployment)
 * 2. Offene Zeitraeume und betroffene Jahre ermitteln
 * 3. fetchMe, fetchAbsences je Jahr — ohne Liste nichts senden
 * 4. Bekannten Status nachziehen und speichern
 * 5. Je offenem Zeitraum uebernehmen oder beantragen, sofort vermerken
 * 6. Schwere Fehler abbrechen, leichte pro Zeitraum in errors
 */
export async function transferVacations(
  employmentId: string,
  opts?: { http?: ClockodoHttp; now?: () => number },
): Promise<VacationTransferResult> {
  const result = emptyResult();
  const now = opts?.now ?? (() => Date.now());
  const http = opts?.http;

  const zugang = await clockodoZugang(employmentId);
  if (!zugang.ok) {
    result.stopped = zugang.stopped;
    return result;
  }
  const { employment, auth } = zugang;

  let days = await getVacationDays();
  const ranges = vacationRequestRanges(days, employment);
  const years = yearsForTransfer(days, employmentId, ranges);
  if (years.length === 0) {
    return result;
  }

  let usersId: number;
  try {
    const me = await fetchMe(auth, http);
    usersId = me.id;
  } catch (e) {
    if (e instanceof ClockodoError && isFatal(e)) {
      result.stopped = e.message;
      return result;
    }
    result.stopped = errorMessage(e);
    return result;
  }

  const allAbsences: ClockodoAbsence[] = [];
  for (const year of years) {
    try {
      const chunk = await fetchAbsences(auth, { usersId, year }, http);
      allAbsences.push(...chunk);
    } catch (e) {
      if (e instanceof ClockodoError) {
        result.stopped = e.message;
        return result;
      }
      result.stopped = errorMessage(e);
      return result;
    }
  }

  const known = allAbsences.map((a) => ({ id: a.id, status: a.status }));
  const synced = syncAbsenceStatus(days, employmentId, known, now());
  result.updated = synced.updated;
  result.missing = synced.missing;
  days = synced.days;
  if (synced.updated > 0) {
    await saveVacationDays(days);
  }

  for (const range of ranges) {
    let absence = findMatchingAbsence(allAbsences, range.dateSince, range.dateUntil);
    if (absence) {
      result.adopted++;
    } else {
      try {
        absence = await createAbsence(
          auth,
          { usersId, dateSince: range.dateSince, dateUntil: range.dateUntil },
          http,
        );
        result.requested++;
      } catch (e) {
        if (e instanceof ClockodoError && isFatal(e)) {
          result.stopped = e.message;
          return result;
        }
        result.errors.push({
          dateSince: range.dateSince,
          dateUntil: range.dateUntil,
          message: errorMessage(e),
        });
        continue;
      }
    }
    await setVacationAbsenceRef(employmentId, range.dates, {
      id: absence.id,
      status: absence.status,
      at: now(),
    });
    if (absence.countDays !== null && absence.countDays !== range.dates.length) {
      result.mismatches.push({
        dateSince: range.dateSince,
        dateUntil: range.dateUntil,
        klarzeitDays: range.dates.length,
        clockodoDays: absence.countDays,
      });
    }
  }

  return result;
}
/** Text fuer die Anzeige eines Abgleichs, `info` neutral, `problems` hervorgehoben. */
export function vacationTransferSummary(r: VacationTransferResult): {
  info: string[];
  problems: string[];
} {
  const info = [
    `${r.requested} beantragt, ${r.adopted} uebernommen, ${r.updated} Status aktualisiert.`,
  ];
  const problems: string[] = [];
  if (r.missing > 0) {
    problems.push(`${r.missing} Urlaubstag(e): Antrag in Clockodo nicht gefunden.`);
  }
  for (const m of r.mismatches) {
    problems.push(
      `${spanne(m.dateSince, m.dateUntil)}: Clockodo zaehlt ${m.clockodoDays} Tag(e), Klarzeit ${m.klarzeitDays}.`,
    );
  }
  for (const e of r.errors) {
    problems.push(`${spanne(e.dateSince, e.dateUntil)}: ${e.message}`);
  }
  if (r.stopped !== null) {
    problems.push(`Abgebrochen: ${r.stopped}`);
  }
  return { info, problems };
}

function spanne(dateSince: string, dateUntil: string): string {
  const from = formatDate(fromDateInput(dateSince));
  if (dateSince === dateUntil) return from;
  return `${from}–${formatDate(fromDateInput(dateUntil))}`;
}

export interface VacationWithdrawResult {
  /** deleted = geloescht, cancelled = storniert, gone = in Clockodo schon weg, null = nicht zurueckgezogen */
  outcome: 'deleted' | 'cancelled' | 'gone' | null;
  removed: number;
  error: string | null;
}

/** openapi AbsenceStatus: 4 = Cancelled (storniert) */
const STATUS_STORNIERT = 4;

/**
 * Zieht einen Urlaubsantrag in Clockodo zurueck -- nur auf Knopfdruck. Erst loeschen; darf
 * Klarzeit das nicht, stornieren (Status 4). Erst danach verschwinden seine Tage aus Klarzeit.
 */
export async function withdrawVacationRequest(
  employmentId: string,
  absenceId: number,
  opts?: { http?: ClockodoHttp },
): Promise<VacationWithdrawResult> {
  const http = opts?.http;
  const zugang = await clockodoZugang(employmentId);
  if (!zugang.ok) {
    return { outcome: null, removed: 0, error: zugang.stopped };
  }
  const { auth } = zugang;

  let outcome: 'deleted' | 'cancelled' | 'gone';

  try {
    const deleted = await deleteAbsence(auth, absenceId, http);
    outcome = deleted ? 'deleted' : 'gone';
  } catch (e) {
    if (!(e instanceof ClockodoError)) {
      return { outcome: null, removed: 0, error: errorMessage(e) };
    }
    if (isFatal(e)) {
      return { outcome: null, removed: 0, error: e.message };
    }
    const msg1 = e.message;
    try {
      const cancelled = await cancelAbsence(auth, absenceId, http);
      if (cancelled === null) {
        outcome = 'gone';
      } else if (cancelled.status === STATUS_STORNIERT) {
        outcome = 'cancelled';
      } else {
        return {
          outcome: null,
          removed: 0,
          error: `Loeschen: ${msg1} / Stornieren: Clockodo hat den Antrag nicht storniert.`,
        };
      }
    } catch (e2) {
      return {
        outcome: null,
        removed: 0,
        error: `Loeschen: ${msg1} / Stornieren: ${errorMessage(e2)}`,
      };
    }
  }

  const removed = await removeVacationDaysOfAbsence(employmentId, absenceId);
  return { outcome, removed, error: null };
}

/** Rueckfrage vor dem Zurueckziehen: Zeitraum und Zahl der Tage des Antrags. */
export function vacationWithdrawQuestion(
  days: readonly VacationDay[],
  employmentId: string,
  absenceId: number,
): string {
  const dates = daysOfAbsence(days, employmentId, absenceId).map((d) => d.date);
  const range = spanne(toDateInput(Math.min(...dates)), toDateInput(Math.max(...dates)));
  return `Antrag ${range} (${dates.length} Urlaubstag(e)) in Clockodo zurueckziehen? Die Tage werden danach aus Klarzeit entfernt.`;
}

const WITHDRAW_SUMMARY_OUTCOME: Record<'deleted' | 'cancelled' | 'gone', string> = {
  deleted: 'Antrag in Clockodo geloescht',
  cancelled: 'Antrag in Clockodo storniert',
  gone: 'Antrag war in Clockodo nicht mehr vorhanden',
};

/** Text fuer das Ergebnis eines Zurueckziehens. */
export function vacationWithdrawSummary(r: VacationWithdrawResult): string {
  if (r.outcome === null) {
    return `Zurueckziehen fehlgeschlagen: ${r.error ?? ''}`;
  }
  return `${WITHDRAW_SUMMARY_OUTCOME[r.outcome]}, ${r.removed} Urlaubstag(e) entfernt.`;
}
