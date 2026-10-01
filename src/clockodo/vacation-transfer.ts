import { getYear } from 'date-fns';
import {
  ClockodoError,
  createAbsence,
  fetchAbsences,
  fetchMe,
  type ClockodoAbsence,
  type ClockodoHttp,
} from './client';
import { getClockodoKey } from './key-store';
import {
  syncAbsenceStatus,
  vacationRequestRanges,
} from '../domain/clockodo-absence';
import type { VacationDay } from '../domain/employment';
import {
  getEmployments,
  getVacationDays,
  saveVacationDays,
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

  const list = await getEmployments();
  const employment = list.find((e) => e.id === employmentId);
  if (!employment) {
    result.stopped = 'Clockodo ist fuer diese Beschaeftigung nicht eingeschaltet.';
    return result;
  }
  const config = employment.clockodo;
  if (config === null) {
    result.stopped = 'Clockodo ist fuer diese Beschaeftigung nicht eingeschaltet.';
    return result;
  }
  if (!config.apiUser.trim()) {
    result.stopped = 'Clockodo-Login fehlt.';
    return result;
  }
  const apiKey = await getClockodoKey(employmentId);
  if (!apiKey) {
    result.stopped = 'API-Schluessel fehlt.';
    return result;
  }
  const auth = { apiUser: config.apiUser.trim(), apiKey };

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
