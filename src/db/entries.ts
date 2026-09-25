import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { getActiveEmploymentId } from './employment';
import type { ClockodoSync } from '../domain/clockodo';
import type { TimeEntry } from '../domain/types';
import { addClockodoDeletes } from './clockodo-deletes';

export type NewEntry = Omit<TimeEntry, 'id' | 'createdAt' | 'updatedAt'>;

export async function addEntry(
  data: Omit<NewEntry, 'employmentId'> & { employmentId?: string },
): Promise<number> {
  const now = Date.now();
  const employmentId = data.employmentId ?? (await getActiveEmploymentId());
  return db.entries.add({
    ...data,
    employmentId,
    createdAt: now,
    updatedAt: now,
  });
}

export async function updateEntry(
  id: number,
  patch: Partial<TimeEntry>,
): Promise<void> {
  await db.entries.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteEntry(id: number): Promise<void> {
  await db.entries.delete(id);
}

export async function getEntry(id: number): Promise<TimeEntry | undefined> {
  return db.entries.get(id);
}

/**
 * Eintraege eines Zeitraums. Geschaeftsregel: Ein Eintrag gehoert zu dem
 * Zeitraum, in dem er BEGINNT (Auswahl nach 'start'). Das ist die uebliche
 * Stundenzettel-Konvention, ist konsistent (jeder Eintrag zaehlt in genau eine
 * Periode) und vermeidet Doppelzaehlung ueber Mitternacht/Periodengrenzen.
 */
export async function getEntriesInRange(
  from: number,
  to: number,
): Promise<TimeEntry[]> {
  return db.entries.where('start').between(from, to, true, true).sortBy('start');
}

/** Eintraege eines Zeitraums fuer eine Beschaeftigung (Index employmentId). */
export async function getEntriesInRangeForEmployment(
  from: number,
  to: number,
  employmentId: string,
): Promise<TimeEntry[]> {
  return db.entries
    .where('employmentId')
    .equals(employmentId)
    .filter((e) => e.start >= from && e.start <= to)
    .sortBy('start');
}

export async function getAllEntries(): Promise<TimeEntry[]> {
  return db.entries.orderBy('start').toArray();
}

export async function bulkPutEntries(entries: TimeEntry[]): Promise<void> {
  await db.entries.bulkPut(entries);
}

export async function clearAllEntries(): Promise<void> {
  await db.entries.clear();
}

export async function countEntries(): Promise<number> {
  return db.entries.count();
}



export async function setEntryClockodoSync(
  id: number,
  sync: ClockodoSync | null,
): Promise<void> {
  if (sync === null) {
    await db.entries.update(id, { clockodoSync: undefined });
  } else {
    await db.entries.update(id, { clockodoSync: sync });
  }
}

export async function deleteEntryWithClockodo(entry: TimeEntry): Promise<void> {
  if (entry.id == null) return;
  const sync = entry.clockodoSync;
  if (sync && sync.ids.length > 0) {
    await addClockodoDeletes(entry.employmentId, sync.ids);
  }
  await db.entries.delete(entry.id);
}

// --- React-Hooks (reaktiv via Dexie liveQuery) ---

/** Eintraege eines Zeitraums, aufsteigend nach Start. */
export function useEntriesInRange(
  from: number,
  to: number,
): TimeEntry[] | undefined {
  return useLiveQuery(
    () => db.entries.where('start').between(from, to, true, true).sortBy('start'),
    [from, to],
  );
}

/** Wie useEntriesInRange, aber nur Eintraege der gewaehlten Beschaeftigung. */
export function useEntriesInRangeForEmployment(
  from: number,
  to: number,
  employmentId: string,
): TimeEntry[] | undefined {
  return useLiveQuery(
    () => getEntriesInRangeForEmployment(from, to, employmentId),
    [from, to, employmentId],
  );
}

/** Alle Eintraege, neueste zuerst (fuer die Listenansicht). */
export function useAllEntriesDesc(): TimeEntry[] | undefined {
  return useLiveQuery(
    () => db.entries.orderBy('start').reverse().toArray(),
    [],
  );
}
