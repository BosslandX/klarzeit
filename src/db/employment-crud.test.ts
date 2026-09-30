import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prefStore = new Map<string, string>();
const secureStore = new Map<string, string>();
const MISSING_KEY = 'Item with given key does not exist';

vi.mock('capacitor-secure-storage-plugin', () => ({
  SecureStoragePlugin: {
    get: async ({ key }: { key: string }) => {
      if (!secureStore.has(key)) throw new Error(MISSING_KEY);
      return { value: secureStore.get(key)! };
    },
    set: async ({ key, value }: { key: string; value: string }) => {
      secureStore.set(key, value);
    },
    remove: async ({ key }: { key: string }) => {
      if (!secureStore.has(key)) throw new Error(MISSING_KEY);
      secureStore.delete(key);
    },
  },
}));



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
  addEmployment,
  countEntriesOfEmployment,
  getEmployments,
  getVacationDays,
  INITIAL_EMPLOYMENT_ID,
  removeEmployment,
  saveVacationDays,
  updateEmployment,
  cleanEmployment,
} from './employment';
import { db } from './db';
import { addEntry } from './entries';
import { defaultEmployment } from '../domain/employment';

function seedOneEmployment() {
  prefStore.set(
    'employments',
    JSON.stringify([
      {
        ...defaultEmployment,
        id: INITIAL_EMPLOYMENT_ID,
        name: 'Hauptjob',
        weeklyHours: 40,
      },
    ]),
  );
}

describe('Beschaeftigungs-Verwaltung', () => {
  beforeEach(async () => {
    prefStore.clear();
    await Dexie.delete('zeiterfassung');
    db.close();
    await db.open();
    seedOneEmployment();
  });

  it('addEmployment haengt an: aus 1 wird 2, neue ID ist nicht emp-1', async () => {
    const list = await addEmployment({ name: 'Nebenjob', weeklyHours: 10 });
    expect(list).toHaveLength(2);
    expect(list[1].name).toBe('Nebenjob');
    expect(list[1].id).not.toBe('emp-1');
    const again = await getEmployments();
    expect(again).toHaveLength(2);
  });

  it('updateEmployment aendert nur die gemeinte und laesst id unangetastet', async () => {
    const list = await addEmployment({ name: 'Zweit', weeklyHours: 8 });
    const secondId = list[1].id;
    await updateEmployment(secondId, { name: 'Geaendert', weeklyHours: 12 });
    const after = await getEmployments();
    expect(after[0].weeklyHours).toBe(40);
    expect(after[1].id).toBe(secondId);
    expect(after[1].name).toBe('Geaendert');
    expect(after[1].weeklyHours).toBe(12);
  });


  it('cleanEmployment traegt clockodo', () => {
    const CFG = {
      apiUser: 'testnutzer',
      syncFrom: new Date(2026, 8, 1).getTime(),
      defaultCustomersId: 11,
      defaultProjectsId: null,
      defaultServicesId: 31,
      billable: 1 as const,
    };
    expect(cleanEmployment({ ...defaultEmployment, clockodo: CFG }).clockodo).toEqual(
      CFG,
    );
    expect(cleanEmployment({ ...defaultEmployment }).clockodo).toBeNull();
  });

  it('cleanEmployment normalisiert contractVacationDays', () => {
    const base = { ...defaultEmployment, id: 'x' };
    expect(cleanEmployment(base).contractVacationDays).toBeNull();
    expect(cleanEmployment({ ...base, contractVacationDays: null }).contractVacationDays).toBeNull();
    expect(cleanEmployment({ ...base, contractVacationDays: 0 }).contractVacationDays).toBeNull();
    expect(cleanEmployment({ ...base, contractVacationDays: -5 }).contractVacationDays).toBeNull();
    expect(cleanEmployment({ ...base, contractVacationDays: Number.NaN }).contractVacationDays).toBeNull();
    expect(cleanEmployment({ ...base, contractVacationDays: '30' }).contractVacationDays).toBeNull();
    expect(cleanEmployment({ ...base, contractVacationDays: 30 }).contractVacationDays).toBe(30);
    expect(cleanEmployment({ ...base, contractVacationDays: 22.5 }).contractVacationDays).toBe(22.5);
  });

  it('cleanEmployment normalisiert includedOvertimeHoursPerMonth', () => {
    // defaultEmployment traegt das Feld mit null; "fehlt" heisst hier: Schluessel weg.
    const { includedOvertimeHoursPerMonth: _weg, ...ohneFeld } = defaultEmployment;
    expect('includedOvertimeHoursPerMonth' in ohneFeld).toBe(false);
    expect(cleanEmployment(ohneFeld).includedOvertimeHoursPerMonth).toBeNull();
    const base = { ...defaultEmployment, id: 'x' };
    expect(cleanEmployment({ ...base, includedOvertimeHoursPerMonth: null }).includedOvertimeHoursPerMonth).toBeNull();
    expect(cleanEmployment({ ...base, includedOvertimeHoursPerMonth: 0 }).includedOvertimeHoursPerMonth).toBeNull();
    expect(cleanEmployment({ ...base, includedOvertimeHoursPerMonth: -5 }).includedOvertimeHoursPerMonth).toBeNull();
    expect(cleanEmployment({ ...base, includedOvertimeHoursPerMonth: Number.NaN }).includedOvertimeHoursPerMonth).toBeNull();
    expect(cleanEmployment({ ...base, includedOvertimeHoursPerMonth: '10' }).includedOvertimeHoursPerMonth).toBeNull();
    expect(cleanEmployment({ ...base, includedOvertimeHoursPerMonth: 10 }).includedOvertimeHoursPerMonth).toBe(10);
    expect(cleanEmployment({ ...base, includedOvertimeHoursPerMonth: 7.5 }).includedOvertimeHoursPerMonth).toBe(7.5);
  });

  it('removeEmployment verweigert Loeschen solange Zeiteintrag haengt, Meldung nennt Anzahl', async () => {
    await addEntry({
      start: 1_700_000_000_000,
      end: 1_700_000_360_000,
      breakMinutes: 0,
      activity: 'a',
      note: '',
      source: 'manual',
      employmentId: INITIAL_EMPLOYMENT_ID,
    });
    await expect(removeEmployment(INITIAL_EMPLOYMENT_ID)).rejects.toThrow(
      'Loeschen nicht moeglich: 1 Zeiteintrag(e) haengen an dieser Beschaeftigung.',
    );
  });

  it('removeEmployment verweigert Loeschen der letzten Beschaeftigung', async () => {
    await expect(removeEmployment(INITIAL_EMPLOYMENT_ID)).rejects.toThrow(
      'Die letzte Beschaeftigung kann nicht geloescht werden.',
    );
  });

  it('removeEmployment loescht wenn nichts haengt, uebrige unveraendert', async () => {
    const list = await addEmployment({ name: 'Zweit', weeklyHours: 5 });
    const secondId = list[1].id;
    const after = await removeEmployment(secondId);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(INITIAL_EMPLOYMENT_ID);
    expect(after[0].weeklyHours).toBe(40);
  });

  it('countEntriesOfEmployment zaehlt nur Eintraege der gemeinten Beschaeftigung', async () => {
    const list = await addEmployment({ name: 'B', weeklyHours: 10 });
    const secondId = list[1].id;
    const base = {
      start: 1_700_000_000_000,
      end: 1_700_000_360_000,
      breakMinutes: 0,
      activity: 'a',
      note: '',
      source: 'manual' as const,
    };
    await addEntry({ ...base, employmentId: INITIAL_EMPLOYMENT_ID });
    await addEntry({ ...base, start: 2, employmentId: INITIAL_EMPLOYMENT_ID });
    await addEntry({ ...base, start: 3, employmentId: secondId });
    expect(await countEntriesOfEmployment(INITIAL_EMPLOYMENT_ID)).toBe(2);
    expect(await countEntriesOfEmployment(secondId)).toBe(1);
  });


  it('cleanEmployment: fehlender Kontohinweis wird der bisherige Satz, sonst nur Text', () => {
    const { balanceNote: _weg, ...ohneFeld } = defaultEmployment;
    expect('balanceNote' in ohneFeld).toBe(false);
    expect(cleanEmployment(ohneFeld).balanceNote).toBe(
      'Ausgleich n. § 2 (4) Arbeitsvertrag.',
    );
    const base = { ...defaultEmployment, id: 'x' };
    expect(cleanEmployment({ ...base, balanceNote: null }).balanceNote).toBe('');
    expect(cleanEmployment({ ...base, balanceNote: 123 }).balanceNote).toBe('');
    expect(cleanEmployment({ ...base, balanceNote: '' }).balanceNote).toBe('');
    expect(cleanEmployment({ ...base, balanceNote: 'Testhinweis' }).balanceNote).toBe(
      'Testhinweis',
    );
    expect(
      cleanEmployment({ ...base, balanceNote: '  Testhinweis  ' }).balanceNote,
    ).toBe('  Testhinweis  ');
  });

  it('neue Beschaeftigung beginnt ohne Kontohinweis', async () => {
    expect(defaultEmployment.balanceNote).toBe('');
    const list = await addEmployment({ name: 'Neu', weeklyHours: 10 });
    expect(list[1].balanceNote).toBe('');
  });

  it('gespeicherte Beschaeftigung ohne Kontohinweis behaelt den bisherigen Satz', async () => {
    const { balanceNote: _weg, ...stored } = {
      ...defaultEmployment,
      id: INITIAL_EMPLOYMENT_ID,
      weeklyHours: 40,
    };
    prefStore.set('employments', JSON.stringify([stored]));
    const list = await getEmployments();
    expect(list[0].balanceNote).toBe('Ausgleich n. § 2 (4) Arbeitsvertrag.');
  });

  it('Urlaubstag wird mit employmentId gespeichert und gelesen', async () => {
    const list = await addEmployment({ name: 'Zweit', weeklyHours: 5 });
    const secondId = list[1].id;
    await saveVacationDays([
      { date: 1_700_100_000_000, note: '', employmentId: secondId },
    ]);
    const days = await getVacationDays();
    expect(days[0].employmentId).toBe(secondId);
  });
});
