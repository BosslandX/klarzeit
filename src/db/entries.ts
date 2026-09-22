import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { getActiveEmploymentId } from './employment';
import type { TimeEntry } from '../domain/types';

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

/** Alle Eintraege, neueste zuerst (fuer die Listenansicht). */
export function useAllEntriesDesc(): TimeEntry[] | undefined {
  return useLiveQuery(
    () => db.entries.orderBy('start').reverse().toArray(),
    [],
  );
}
