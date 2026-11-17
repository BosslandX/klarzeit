import type { TimeEntry } from './types';

/** Hoechstlaenge der Veranlassung in Zeichen (Formular und Backup). */
export const VERANLASSUNG_MAX = 300;

/** Veranlassung aus Formular oder Backup: getrimmt, hoechstens 300 Zeichen; leer = keine. */
export function cleanOvertimeAuthorization(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const text = raw.trim().slice(0, VERANLASSUNG_MAX);
  return text === '' ? undefined : text;
}

/** Zeile unter dem Eintrag, z. B. "Veranlassung: angeordnet per E-Mail"; ohne Angabe undefined. */
export function overtimeAuthorizationLine(entry: TimeEntry): string | undefined {
  const text = cleanOvertimeAuthorization(entry.overtimeAuthorization);
  return text === undefined ? undefined : `Veranlassung: ${text}`;
}
