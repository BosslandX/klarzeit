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

import { addEntry, getAllEntries } from './entries';
import { buildBackup, entriesToCsv, restoreBackup } from './backup';
import { db } from './db';
import { defaultEmployment } from '../domain/employment';

const H = 3_600_000;
const tag = new Date(2026, 10, 9).getTime();
const neu = () => ({
  employmentId: 'emp-1',
  start: tag + 8 * H,
  end: tag + 18 * H,
  breakMinutes: 30,
  activity: 'Montage',
  note: '',
  source: 'manual' as const,
});

describe('Veranlassung speichern und sichern (AUF-036)', () => {
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

  it('Backup traegt die Veranlassung, die CSV hat eine Spalte dafuer', async () => {
    await addEntry({ ...neu(), overtimeAuthorization: '  angeordnet von der Teamleitung  ' });
    await addEntry({ ...neu(), start: tag + 20 * H, end: tag + 21 * H, overtimeAuthorization: 'x'.repeat(400) });
    await restoreBackup(JSON.stringify(await buildBackup()), 'replace');
    const alle = await getAllEntries();
    expect(alle.map((e) => e.overtimeAuthorization)).toEqual([
      'angeordnet von der Teamleitung',
      'x'.repeat(300),
    ]);
    const csv = entriesToCsv(alle);
    expect(csv.split('\r\n')[0].endsWith(';Veranlassung')).toBe(true);
    expect(csv).toContain(';angeordnet von der Teamleitung');
  });
});
