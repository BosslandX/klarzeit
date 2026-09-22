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
  cleanVacationDays,
  createEmploymentId,
  getEmployments,
  getVacationDays,
  INITIAL_EMPLOYMENT_ID,
} from './employment';
import { MIGRATION_EMPLOYMENT_ID, db } from './db';
import { restoreBackup } from './backup';
import { getAllEntries } from './entries';

function setPref(key: string, value: unknown) {
  prefStore.set(key, JSON.stringify(value));
}

describe('Beschäftigungs-Migration', () => {
  beforeEach(async () => {
    prefStore.clear();
    await Dexie.delete('zeiterfassung');
    db.close();
  });

  it('Migration ohne Altdaten ergibt genau eine Beschaeftigung mit id emp-1', async () => {
    const list = await getEmployments();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('emp-1');
  });

  it('Migration aus altem employment behält Vertragswerte', async () => {
    const legacy = {
      startDate: new Date(2024, 2, 15).getTime(),
      endDate: null,
      weeklyHours: 30,
      workdaysPerWeek: 5,
      vacationYearMode: 'prorata',
      openingBalanceMs: 3_600_000,
    };
    setPref('employment', legacy);
    const list = await getEmployments();
    expect(list[0].weeklyHours).toBe(30);
    expect(list[0].workdaysPerWeek).toBe(5);
    expect(list[0].vacationYearMode).toBe('prorata');
    expect(list[0].openingBalanceMs).toBe(3_600_000);
    expect(list[0].startDate).toBe(legacy.startDate);
  });

  it('Migration übernimmt arbeitgeber personalnummer abteilung aus dem Profil', async () => {
    setPref('profile', {
      vorname: '',
      nachname: '',
      arbeitgeber: 'Firma GmbH',
      personalnummer: '42',
      abteilung: 'IT',
    });
    const list = await getEmployments();
    expect(list[0].arbeitgeber).toBe('Firma GmbH');
    expect(list[0].personalnummer).toBe('42');
    expect(list[0].abteilung).toBe('IT');
    expect(list[0].name).toBe('Firma GmbH');
  });

  it('Liegt employments bereits vor, wird nicht erneut migriert', async () => {
    setPref('employments', [
      {
        id: 'emp-99',
        name: 'Bestehend',
        arbeitgeber: 'X',
        personalnummer: '',
        abteilung: '',
        startDate: 1,
        endDate: null,
        weeklyHours: 10,
        // Der Wert ist fuer diesen Test beliebig -- geprueft wird, dass eine vorhandene
        // Liste NICHT ueberschrieben wird, nicht welche Zahl darin steht.
        workdaysPerWeek: 4,
        vacationYearMode: 'full',
        openingBalanceMs: 0,
      },
    ]);
    setPref('employment', { weeklyHours: 99, workdaysPerWeek: 6 });
    const list = await getEmployments();
    expect(list[0].id).toBe('emp-99');
    expect(list[0].name).toBe('Bestehend');
    expect(list[0].weeklyHours).toBe(10);
  });

  it('Dexie-Upgrade v1 auf v2 setzt employmentId emp-1 ohne Eintragsverlust', async () => {
    const legacy = new Dexie('zeiterfassung');
    legacy.version(1).stores({ entries: '++id, start, end, source' });
    await legacy.open();
    const base = {
      start: 1_700_000_000_000,
      end: 1_700_000_360_000,
      breakMinutes: 0,
      activity: 'a',
      note: '',
      source: 'manual' as const,
      createdAt: 1,
      updatedAt: 1,
    };
    await legacy.table('entries').bulkAdd([base, { ...base, start: 2 }, { ...base, start: 3 }]);
    const beforeCount = await legacy.table('entries').count();
    await legacy.close();

    await db.open();
    const after = await db.entries.toArray();
    expect(after.length).toBe(beforeCount);
    expect(after.every((e) => e.employmentId === MIGRATION_EMPLOYMENT_ID)).toBe(true);
  });

  it('Urlaubstag ohne employmentId wird beim Lesen emp-1 zugeordnet', async () => {
    setPref('vacations', [{ date: 1_700_000_000_000, note: 'u' }]);
    const days = await getVacationDays();
    expect(days[0].employmentId).toBe(INITIAL_EMPLOYMENT_ID);
  });

  it('Neue Beschaeftigungs-IDs sind unter 100 Vergaben alle verschieden', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(createEmploymentId());
    expect(ids.size).toBe(100);
  });

  it('restoreBackup importiert altes Backup ohne employmentId und setzt emp-1', async () => {
    const json = JSON.stringify({
      app: 'zeiterfassung',
      version: 1,
      exportedAt: Date.now(),
      profile: {
        vorname: '',
        nachname: '',
        personalnummer: '',
        arbeitgeber: '',
        abteilung: '',
      },
      entries: [
        {
          start: 1_700_000_000_000,
          end: 1_700_000_360_000,
          breakMinutes: 0,
          activity: 'Alt',
          note: '',
          source: 'manual',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    await db.open();
    const n = await restoreBackup(json, 'replace');
    expect(n).toBe(1);
    const entries = await getAllEntries();
    expect(entries[0].employmentId).toBe('emp-1');
  });
});
