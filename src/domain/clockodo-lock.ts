import { addDays, differenceInCalendarDays, startOfDay } from 'date-fns';
import type { ClockodoConfig, ClockodoLock } from './clockodo';
import { transferStatus, type TransferStatus } from './clockodo-transfer';
import type { TimeEntry } from './types';
import { formatDays } from './time';

/** Frist eines offenen Eintrags gegenueber der Clockodo-Sperrfrist */
export type LockState = 'ok' | 'due-tomorrow' | 'due-today' | 'locked';

export interface LockCounts {
  open: number;
  dueTomorrow: number;
  dueToday: number;
  locked: number;
}

const OPEN_STATUSES: ReadonlySet<TransferStatus> = new Set([
  'pending',
  'changed',
  'incomplete',
  'untimed-break',
]);

const STATUS_LABEL: Record<TransferStatus, string | null> = {
  synced: 'in Clockodo',
  changed: 'geaendert',
  pending: 'noch nicht uebertragen',
  'untimed-break': 'Pause ohne Uhrzeit',
  incomplete: 'Clockodo-Auswahl fehlt',
  none: null,
  done: 'von Hand erledigt – wird nicht uebertragen',
  'before-start': 'vor „Uebertragen ab“ – wird nicht uebertragen',
};

/**
 * Letzter Tag (lokale Mitternacht), an dem Clockodo einen Eintrag noch annimmt: Eintragstag plus
 * Sperrtage minus 1, in Kalendertagen. Beobachtet mit 3 Tagen: am Freitag lehnte Clockodo die
 * Eintraege von Montag und Dienstag ab und nahm die ab Mittwoch an. Ob Clockodo Kalender- oder
 * Arbeitstage zaehlt, zeigt das nicht; Kalendertage warnen frueher.
 */
export function lastSendDay(entryStart: number, lockDays: number): number {
  return addDays(startOfDay(entryStart), lockDays - 1).getTime();
}

export function lockState(entryStart: number, lockDays: number, now: number): LockState {
  const diff = differenceInCalendarDays(lastSendDay(entryStart, lockDays), now);
  if (diff < 0) return 'locked';
  if (diff === 0) return 'due-today';
  if (diff === 1) return 'due-tomorrow';
  return 'ok';
}

function isOpen(entry: TimeEntry, config: ClockodoConfig): boolean {
  return OPEN_STATUSES.has(transferStatus(entry, config));
}

/** Offene Eintraege einer Beschaeftigung (weder uebertragen noch vor „Uebertragen ab") nach ihrer Frist. */
export function countLockStates(
  entries: readonly TimeEntry[],
  employmentId: string,
  config: ClockodoConfig,
  lockDays: number | null,
  now: number,
): LockCounts {
  const counts: LockCounts = {
    open: 0,
    dueTomorrow: 0,
    dueToday: 0,
    locked: 0,
  };
  for (const entry of entries) {
    if (entry.employmentId !== employmentId) continue;
    if (!isOpen(entry, config)) continue;
    counts.open++;
    if (lockDays === null) continue;
    const state = lockState(entry.start, lockDays, now);
    if (state === 'due-tomorrow') counts.dueTomorrow++;
    else if (state === 'due-today') counts.dueToday++;
    else if (state === 'locked') counts.locked++;
  }
  return counts;
}

function entryWord(n: number): string {
  return n === 1 ? '1 Eintrag' : `${n} Eintraege`;
}

/** Hinweis zur Sperrfrist; null, wenn es nichts zu sagen gibt. */
export function lockHint(counts: LockCounts, lock: ClockodoLock | null): string | null {
  if (counts.open === 0) return null;
  if (lock === null) {
    return 'Clockodo-Sperrfrist unbekannt: einmal uebertragen oder die Verbindung testen.';
  }
  if (lock.days === null) return null;
  const parts: string[] = [];
  if (counts.locked > 0) {
    parts.push(
      `${entryWord(counts.locked)} in Clockodo gesperrt – Vorgesetzten fragen.`,
    );
  }
  if (counts.dueToday > 0) {
    parts.push(
      `Heute letzter Tag fuer ${entryWord(counts.dueToday)} – jetzt uebertragen.`,
    );
  }
  if (counts.dueTomorrow > 0) {
    parts.push(`Morgen letzter Tag fuer ${entryWord(counts.dueTomorrow)}.`);
  }
  if (parts.length === 0) return null;
  return parts.join(' ');
}

/** Stand eines Eintrags in der Liste, bei offenen Eintraegen mit Frist. */
export function clockodoEntryLabel(
  entry: TimeEntry,
  config: ClockodoConfig | null,
  lock: ClockodoLock | null,
  now: number,
): string | null {
  if (!config) return null;
  const status = transferStatus(entry, config);
  const text = STATUS_LABEL[status];
  if (lock === null || lock.days === null) {
    return text;
  }
  if (!OPEN_STATUSES.has(status)) {
    return text;
  }
  const state = lockState(entry.start, lock.days, now);
  if (state === 'locked') return 'in Clockodo gesperrt';
  if (state === 'due-today' && text) return `${text} – heute letzter Tag`;
  if (state === 'due-tomorrow' && text) return `${text} – morgen letzter Tag`;
  return text;
}

/** Meldung fuer ein 403 an einem Eintrag jenseits der Frist; sonst null. */
export function lockedEntryMessage(
  status: number | undefined,
  entryStart: number,
  lock: ClockodoLock | null,
  now: number,
): string | null {
  if (status !== 403) return null;
  if (lock === null || lock.days === null) return null;
  if (lockState(entryStart, lock.days, now) !== 'locked') return null;
  return `In Clockodo gesperrt (Sperrfrist ${formatDays(lock.days)}) – Vorgesetzten fragen.`;
}

/** Satz zur Sperrfrist fuer „Verbindung testen". */
export function lockDaysText(days: number | null): string {
  if (days === null) return 'Clockodo meldet keine Sperrfrist.';
  return `Sperrfrist in Clockodo: ${formatDays(days)}.`;
}
