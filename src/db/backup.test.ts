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

import {
  getActiveEmploymentId,
  getEmployments,
  INITIAL_EMPLOYMENT_ID,
} from './employment';
import { db } from './db';
import { getAllEntries } from './entries';
import {
  buildBackup,
  entriesToCsv,
  restoreBackup,
  type BackupData,
} from './backup';
import { defaultEmployment } from '../domain/employment';

function baseEntry(overrides: Record<string, unknown> = {}) {
  return {
    start: 1_700_000_000_000,
    end: 1_700_000_360_000,
    breakMinutes: 0,
    activity: 'a',
    note: '',
    source: 'manual' as const,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function emp(
  id: string,
  name: string,
  weeklyHours: number,
): typeof defaultEmployment {
  return {
    ...defaultEmployment,
    id,
    name,
    weeklyHours,
    workdaysPerWeek: 5,
  };
}

describe('Backup Version 3 und Beschaeftigungen', () => {
  beforeEach(async () => {
    prefStore.clear();
    await Dexie.delete('zeiterfassung');
    db.close();
    await db.open();
  });

  it('Version-2-Backup ohne employmentId: Eintraege erhalten emp-1, Anzahl gleich', async () => {
    const entries = [baseEntry({ activity: 'E1' }), baseEntry({ activity: 'E2', start: 1_700_001_000_000, end: 1_700_001_360_000 })];
    const backup: BackupData = {
      app: 'zeiterfassung',
      version: 2,
      exportedAt: 1,
      profile: {
        vorname: '',
        nachname: '',
        personalnummer: '',
        arbeitgeber: '',
        abteilung: '',
      },
      entries: entries as import('../domain/types').TimeEntry[],
    };
    const countBefore = backup.entries.length;
    const n = await restoreBackup(JSON.stringify(backup), 'replace');
    expect(n).toBe(countBefore);
    const imported = await getAllEntries();
    expect(imported.length).toBe(countBefore);
    expect(imported.every((e) => e.employmentId === INITIAL_EMPLOYMENT_ID)).toBe(
      true,
    );
  });

  it('Profilfelder erzeugen Beschaeftigung wenn lokal keine vorliegt', async () => {
    const backup = {
      app: 'zeiterfassung',
      version: 2,
      exportedAt: 1,
      profile: {
        vorname: '',
        nachname: '',
        personalnummer: '77',
        arbeitgeber: 'Alt AG',
        abteilung: 'Buch',
      },
      entries: [baseEntry()],
    };
    await restoreBackup(JSON.stringify(backup), 'merge');
    const list = await getEmployments();
    expect(list).toHaveLength(1);
    expect(list[0].arbeitgeber).toBe('Alt AG');
    expect(list[0].personalnummer).toBe('77');
    expect(list[0].abteilung).toBe('Buch');
  });

  it('Version-3-Backup bringt zwei Beschaeftigungen mit Vertragsdaten', async () => {
    const e1 = emp('emp-a', 'A', 20);
    const e2 = emp('emp-b', 'B', 30);
    const backup: BackupData = {
      app: 'zeiterfassung',
      version: 3,
      exportedAt: 1,
      profile: {
        vorname: '',
        nachname: '',
        personalnummer: '',
        arbeitgeber: '',
        abteilung: '',
      },
      entries: [],
      employments: [e1, e2],
      activeEmployment: 'emp-b',
    };
    await restoreBackup(JSON.stringify(backup), 'replace');
    const list = await getEmployments();
    expect(list).toHaveLength(2);
    expect(list.find((e) => e.id === 'emp-a')?.weeklyHours).toBe(20);
    expect(list.find((e) => e.id === 'emp-b')?.weeklyHours).toBe(30);
    expect(await getActiveEmploymentId()).toBe('emp-b');
  });

  it('merge: gleiche ID bleibt lokal, unbekannte kommt hinzu', async () => {
    prefStore.set(
      'employments',
      JSON.stringify([emp(INITIAL_EMPLOYMENT_ID, 'Lokal', 40)]),
    );
    const backup: BackupData = {
      app: 'zeiterfassung',
      version: 3,
      exportedAt: 1,
      profile: {
        vorname: '',
        nachname: '',
        personalnummer: '',
        arbeitgeber: '',
        abteilung: '',
      },
      entries: [],
      employments: [
        emp(INITIAL_EMPLOYMENT_ID, 'Backup', 5),
        emp('emp-neu', 'Neu', 12),
      ],
    };
    await restoreBackup(JSON.stringify(backup), 'merge');
    const list = await getEmployments();
    expect(list).toHaveLength(2);
    const local = list.find((e) => e.id === INITIAL_EMPLOYMENT_ID);
    expect(local?.weeklyHours).toBe(40);
    expect(local?.name).toBe('Lokal');
    expect(list.some((e) => e.id === 'emp-neu')).toBe(true);
  });

  it('replace: lokale Beschaeftigungen werden durch Backup ersetzt', async () => {
    prefStore.set(
      'employments',
      JSON.stringify([
        emp(INITIAL_EMPLOYMENT_ID, 'Alt', 40),
        emp('emp-x', 'X', 10),
      ]),
    );
    const backup: BackupData = {
      app: 'zeiterfassung',
      version: 3,
      exportedAt: 1,
      profile: {
        vorname: '',
        nachname: '',
        personalnummer: '',
        arbeitgeber: '',
        abteilung: '',
      },
      entries: [],
      employments: [emp('emp-y', 'Neu', 15)],
      activeEmployment: 'emp-y',
    };
    await restoreBackup(JSON.stringify(backup), 'replace');
    const list = await getEmployments();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('emp-y');
    expect(list[0].weeklyHours).toBe(15);
  });

  it('buildBackup schreibt version 3 und app zeiterfassung', async () => {
    prefStore.set(
      'employments',
      JSON.stringify([emp(INITIAL_EMPLOYMENT_ID, 'H', 8)]),
    );
    const data = await buildBackup();
    expect(data.version).toBe(3);
    expect(data.app).toBe('zeiterfassung');
  });

  it('CSV enthaelt Beschaeftigungsname und entschaerft Formel-Prefix', () => {
    const employments = [emp(INITIAL_EMPLOYMENT_ID, '=Firma', 1)];
    const csv = entriesToCsv(
      [
        {
          ...baseEntry(),
          employmentId: INITIAL_EMPLOYMENT_ID,
          activity: 'x',
        } as import('../domain/types').TimeEntry,
      ],
      employments,
    );
    expect(csv).toContain('Beschaeftigung');
    expect(csv).toContain("'=Firma");
  });
});
