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

import { addSickPeriod, getSickPeriods, removeSickPeriod, saveSickPeriods } from './sickness';
import { buildBackup, restoreBackup } from './backup';
import { removeEmployment } from './employment';
import { db } from './db';
import { defaultEmployment } from '../domain/employment';
import type { SickPeriod } from '../domain/sickness';

const d = (y: number, mo: number, dd: number) => new Date(y, mo - 1, dd).getTime();
const p = (from: number, to: number, certificate = true, employmentId = 'emp-1'): SickPeriod => ({
  employmentId,
  from,
  to,
  certificate,
});

describe('Krankheitszeitraeume speichern und sichern (AUF-033)', () => {
  beforeEach(async () => {
    prefStore.clear();
    await Dexie.delete('zeiterfassung');
    db.close();
    await db.open();
    prefStore.set(
      'employments',
      JSON.stringify([
        { ...defaultEmployment, id: 'emp-1', name: 'Hauptjob', weeklyHours: 40 },
        { ...defaultEmployment, id: 'emp-b', name: 'Nebenjob', weeklyHours: 10 },
      ]),
    );
  });

  it('eintragen, Ueberschneidung abweisen, entfernen; kaputter Speicher ergibt eine leere Liste', async () => {
    expect(await addSickPeriod(p(d(2026, 3, 10), d(2026, 3, 12)))).toEqual([
      p(d(2026, 3, 10), d(2026, 3, 12)),
    ]);
    expect(await addSickPeriod(p(d(2026, 3, 12), d(2026, 3, 14), false))).toBeNull();
    expect(await addSickPeriod(p(d(2026, 3, 20), d(2026, 3, 19)))).toBeNull();
    expect(await addSickPeriod(p(d(2026, 3, 12), d(2026, 3, 14), false, 'emp-b'))).toHaveLength(2);
    expect(await removeSickPeriod('emp-1', d(2026, 3, 10))).toEqual([
      p(d(2026, 3, 12), d(2026, 3, 14), false, 'emp-b'),
    ]);
    expect(await getSickPeriods()).toEqual([p(d(2026, 3, 12), d(2026, 3, 14), false, 'emp-b')]);
    prefStore.set('sickPeriods', '{kaputt');
    expect(await getSickPeriods()).toEqual([]);
  });

  it('Backup traegt die Zeitraeume; Ersetzen uebernimmt sie, Zusammenfuehren nur ueberschneidungsfreie', async () => {
    await saveSickPeriods([p(d(2026, 3, 10), d(2026, 3, 12))]);
    const backup = await buildBackup();
    expect(backup.sickPeriods).toEqual([p(d(2026, 3, 10), d(2026, 3, 12))]);
    const fremd = [p(d(2026, 3, 11), d(2026, 3, 13), false), p(d(2026, 4, 1), d(2026, 4, 2))];
    await restoreBackup(JSON.stringify({ ...backup, sickPeriods: fremd }), 'merge');
    expect(await getSickPeriods()).toEqual([
      p(d(2026, 3, 10), d(2026, 3, 12)),
      p(d(2026, 4, 1), d(2026, 4, 2)),
    ]);
    await restoreBackup(JSON.stringify({ ...backup, sickPeriods: fremd }), 'replace');
    expect(await getSickPeriods()).toEqual(fremd);
    // Ein aelteres Backup ohne das Feld laesst die Zeitraeume stehen.
    await restoreBackup(JSON.stringify({ ...backup, sickPeriods: undefined }), 'replace');
    expect(await getSickPeriods()).toEqual(fremd);
  });

  it('eine Beschaeftigung mit Krankheitszeitraum laesst sich nicht loeschen', async () => {
    await saveSickPeriods([p(d(2026, 3, 10), d(2026, 3, 12), true, 'emp-b')]);
    await expect(removeEmployment('emp-b')).rejects.toThrow(
      'Loeschen nicht moeglich: 1 Krankheitszeit(en) haengen an dieser Beschaeftigung.',
    );
  });
});
