import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prefStore = new Map<string, string>();

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({
      value: prefStore.has(key) ? prefStore.get(key)! : null,
    }),
    set: async ({ key, value }: { key: string; value: string }) => {
      prefStore.set(key, value);
    },
    remove: async ({ key }: { key: string }) => {
      prefStore.delete(key);
    },
  },
}));

import { addEntry, getAllEntries, getEntry, updateEntryWithClockodo } from './entries';
import { buildBackup, entriesToCsv, restoreBackup } from './backup';
import { db } from './db';
import { defaultEmployment } from '../domain/employment';
import type { EntrySource } from '../domain/types';

const H = 3_600_000;
const tag = new Date(2026, 10, 9).getTime();
const neu = (source: EntrySource) => ({
  employmentId: 'emp-1',
  start: tag + 8 * H,
  end: tag + 16 * H,
  breakMinutes: 0,
  activity: 'Montage',
  note: '',
  source,
});

describe('Stoppuhr-Zeiten speichern und sichern (AUF-035)', () => {
  beforeEach(async () => {
    prefStore.clear();
    await Dexie.delete('zeiterfassung');
    db.close();
    await db.open();
    prefStore.set(
      'employments',
      JSON.stringify([{ ...defaultEmployment, id: 'emp-1', weeklyHours: 40 }]),
    );
  });

  it('Bearbeiten merkt die Stoppuhr-Zeiten einmal; Notiz allein und nachgetragene Eintraege nicht', async () => {
    const id = await addEntry(neu('tracked'));
    await updateEntryWithClockodo((await getEntry(id))!, { note: 'nur Notiz' });
    expect((await getEntry(id))!.trackedTimes).toBeUndefined();
    await updateEntryWithClockodo((await getEntry(id))!, { start: tag + 7 * H });
    await updateEntryWithClockodo((await getEntry(id))!, { end: tag + 18 * H });
    const e = (await getEntry(id))!;
    expect([e.start, e.end]).toEqual([tag + 7 * H, tag + 18 * H]);
    expect(e.trackedTimes).toEqual({ start: tag + 8 * H, end: tag + 16 * H });
    const m = await addEntry(neu('manual'));
    await updateEntryWithClockodo((await getEntry(m))!, { start: tag + 7 * H });
    expect((await getEntry(m))!.trackedTimes).toBeUndefined();
  });

  it('Backup traegt die Stoppuhr-Zeiten, die CSV nennt sie bei geaenderten Eintraegen', async () => {
    const id = await addEntry(neu('tracked'));
    await updateEntryWithClockodo((await getEntry(id))!, { start: tag + 7 * H });
    const backup = await buildBackup();
    const kaputt = { ...backup.entries[0], id: 99, trackedTimes: { start: 5, end: 3 } };
    await restoreBackup(
      JSON.stringify({ ...backup, entries: [...backup.entries, kaputt] }),
      'replace',
    );
    const alle = await getAllEntries();
    expect(alle.find((x) => x.id === id)!.trackedTimes).toEqual({
      start: tag + 8 * H,
      end: tag + 16 * H,
    });
    expect('trackedTimes' in alle.find((x) => x.id === 99)!).toBe(false);
    expect(entriesToCsv(alle)).toContain('erfasst, geaendert (Stoppuhr 08:00-16:00)');
  });
});
