import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prefStore = new Map<string, string>();
const secureStore = new Map<string, string>();
const MISSING_KEY = 'Item with given key does not exist';

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

import {
  getActiveEmploymentId,
  cleanEmployment,
  getEmployments,
  getVacationDays,
  saveVacationDays,
  updateEmployment,
  INITIAL_EMPLOYMENT_ID,
} from './employment';
import { db } from './db';
import { getAllEntries } from './entries';
import { getProfile } from './profile';
import {
  buildBackup,
  entriesToCsv,
  restoreBackup,
  fillEmptyEmployment,
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

  it('ersetzen: Urlaubstage am selben Datum in zwei Beschaeftigungen bleiben beide', async () => {
    const tag = new Date(2026, 6, 6).getTime();
    const beide = [emp('emp-1', 'Hauptjob', 30), emp('emp-b', 'Nebenjob', 10)];
    const backup: BackupData = {
      app: 'zeiterfassung',
      version: 3,
      exportedAt: 1,
      profile: zeiterfassungV2.profile,
      entries: [],
      employments: beide,
      vacations: [
        { date: tag, note: '', employmentId: 'emp-1' },
        { date: tag, note: '', employmentId: 'emp-b' },
      ],
    };
    await restoreBackup(JSON.stringify(backup), 'replace');
    const vacations = await getVacationDays();
    expect(vacations.map((v) => v.employmentId).sort()).toEqual(['emp-1', 'emp-b']);
    expect(vacations.every((v) => v.date === tag)).toBe(true);
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


  it('Version-2-Backup employment ohne contractVacationDays: nach replace null', async () => {
    const legacyEmp = {
      id: INITIAL_EMPLOYMENT_ID,
      name: 'Legacy',
      arbeitgeber: '',
      personalnummer: '',
      abteilung: '',
      startDate: defaultEmployment.startDate,
      endDate: null,
      weeklyHours: 20,
      workdaysPerWeek: 5,
      vacationYearMode: 'both' as const,
      openingBalanceMs: 0,
    };
    const backup = {
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
      employment: legacyEmp,
      entries: [],
    };
    await restoreBackup(JSON.stringify(backup), 'replace');
    const list = await getEmployments();
    expect(list[0].contractVacationDays).toBeNull();
  });

  it('Rundreise contractVacationDays 26 ueber Backup', async () => {
    prefStore.set(
      'employments',
      JSON.stringify([emp(INITIAL_EMPLOYMENT_ID, 'H', 20)]),
    );
    await updateEmployment(INITIAL_EMPLOYMENT_ID, { contractVacationDays: 26 });
    const json = JSON.stringify(await buildBackup());
    prefStore.clear();
    await Dexie.delete('zeiterfassung');
    db.close();
    await db.open();
    await restoreBackup(json, 'replace');
    const list = await getEmployments();
    expect(list[0].contractVacationDays).toBe(26);
  });

  it('Rundreise clockodoAbsence am Urlaubstag ueber Backup', async () => {
    const tag = new Date(2026, 9, 5).getTime();
    await saveVacationDays([
      {
        employmentId: INITIAL_EMPLOYMENT_ID,
        date: tag,
        note: '',
        clockodoAbsence: { id: 42, status: 1, at: 1_700_000_000_000 },
      },
    ]);
    const json = JSON.stringify(await buildBackup());
    prefStore.clear();
    await Dexie.delete('zeiterfassung');
    db.close();
    await db.open();
    await restoreBackup(json, 'replace');
    const days = await getVacationDays();
    expect(days).toHaveLength(1);
    expect(days[0].clockodoAbsence).toEqual({ id: 42, status: 1, at: 1_700_000_000_000 });
  });

  it('Rundreise includedOvertimeHoursPerMonth 12 ueber Backup', async () => {
    prefStore.set(
      'employments',
      JSON.stringify([emp(INITIAL_EMPLOYMENT_ID, 'H', 20)]),
    );
    await updateEmployment(INITIAL_EMPLOYMENT_ID, { includedOvertimeHoursPerMonth: 12 });
    const json = JSON.stringify(await buildBackup());
    prefStore.clear();
    await Dexie.delete('zeiterfassung');
    db.close();
    await db.open();
    await restoreBackup(json, 'replace');
    const list = await getEmployments();
    expect(list[0].includedOvertimeHoursPerMonth).toBe(12);
  });

  it('fillEmptyEmployment uebernimmt die Abgeltung nur mit dem Vertrag', () => {
    const local = cleanEmployment({ id: 'emp-1' });
    const incoming = cleanEmployment({
      id: 'emp-1',
      weeklyHours: 30,
      includedOvertimeHoursPerMonth: 12,
    });
    expect(fillEmptyEmployment(local, incoming).includedOvertimeHoursPerMonth).toBe(12);
    const localMitStd = cleanEmployment({ id: 'emp-1', weeklyHours: 20 });
    expect(fillEmptyEmployment(localMitStd, incoming).includedOvertimeHoursPerMonth).toBeNull();
  });

  it('Rundreise balanceNote ueber Backup', async () => {
    prefStore.set(
      'employments',
      JSON.stringify([emp(INITIAL_EMPLOYMENT_ID, 'H', 20)]),
    );
    await updateEmployment(INITIAL_EMPLOYMENT_ID, { balanceNote: 'Testhinweis' });
    const json = JSON.stringify(await buildBackup());
    prefStore.clear();
    await Dexie.delete('zeiterfassung');
    db.close();
    await db.open();
    await restoreBackup(json, 'replace');
    const list = await getEmployments();
    expect(list[0].balanceNote).toBe('Testhinweis');
  });

  it('fillEmptyEmployment uebernimmt den Kontohinweis nur mit dem Vertrag', () => {
    const local = cleanEmployment({ id: 'emp-1', balanceNote: 'lokal' });
    const incoming = cleanEmployment({
      id: 'emp-1',
      weeklyHours: 30,
      balanceNote: 'Testhinweis',
    });
    expect(fillEmptyEmployment(local, incoming).balanceNote).toBe('Testhinweis');
    const localMitStd = cleanEmployment({
      id: 'emp-1',
      weeklyHours: 20,
      balanceNote: 'lokal',
    });
    expect(fillEmptyEmployment(localMitStd, incoming).balanceNote).toBe('lokal');
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

const zeiterfassungV2 = {
  app: 'zeiterfassung' as const,
  version: 2 as const,
  exportedAt: 1,
  profile: {
    vorname: 'Erika',
    nachname: 'Mustermann',
    personalnummer: 'P-77',
    arbeitgeber: 'Alt AG',
    abteilung: 'Lager',
  },
  entries: [
    baseEntry({ activity: 'E1' }),
    baseEntry({
      activity: 'E2',
      start: 1_700_001_000_000,
      end: 1_700_001_360_000,
    }),
  ],
  employment: {
    startDate: new Date(2025, 2, 1).getTime(),
    endDate: null,
    weeklyHours: 30,
    workdaysPerWeek: 4,
    vacationYearMode: 'prorata' as const,
    openingBalanceMs: 3_600_000,
  },
  vacations: [
    { date: new Date(2026, 6, 6).getTime(), note: '' },
    { date: new Date(2026, 6, 7).getTime(), note: '' },
  ],
};

const erwartetAusV2 = {
  id: 'emp-1',
  name: 'Alt AG',
  arbeitgeber: 'Alt AG',
  personalnummer: 'P-77',
  abteilung: 'Lager',
  startDate: new Date(2025, 2, 1).getTime(),
  endDate: null,
  weeklyHours: 30,
  workdaysPerWeek: 4,
  vacationYearMode: 'prorata' as const,
  openingBalanceMs: 3_600_000,
  contractVacationDays: null,
  includedOvertimeHoursPerMonth: null,
  balanceNote: 'Ausgleich n. § 2 (4) Arbeitsvertrag.',
  clockodo: null,
};

describe('Zusammenfuehren in eine vorhandene Beschaeftigung', () => {
  beforeEach(async () => {
    prefStore.clear();
    await Dexie.delete('zeiterfassung');
    db.close();
    await db.open();
  });

  it('v2 zusammenfuehren nach erstem Oeffnen: Beschaeftigung vollstaendig', async () => {
    await getEmployments();
    // Vorbedingung am Speicher, nicht am Rueckgabewert: ohne gespeicherte Liste liefe
    // der Import ueber den Zweig "lokal nichts vorhanden" und saehe immer richtig aus.
    const gespeichert = JSON.parse(prefStore.get('employments') ?? '[]');
    expect(gespeichert).toHaveLength(1);
    expect(gespeichert[0].id).toBe('emp-1');
    expect(gespeichert[0].weeklyHours).toBe(0);

    const n = await restoreBackup(JSON.stringify(zeiterfassungV2), 'merge');
    expect(n).toBe(2);

    const list = await getEmployments();
    expect(list).toEqual([erwartetAusV2]);

    const entries = await getAllEntries();
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.employmentId === 'emp-1')).toBe(true);

    const vacations = await getVacationDays();
    expect(vacations).toHaveLength(2);
    expect(vacations.every((v) => v.employmentId === 'emp-1')).toBe(true);

    expect(await getProfile()).toEqual(zeiterfassungV2.profile);
  });

  it('v2 ersetzen nach erstem Oeffnen: dieselbe Beschaeftigung', async () => {
    await getEmployments();
    await restoreBackup(JSON.stringify(zeiterfassungV2), 'replace');
    const list = await getEmployments();
    expect(list).toEqual([erwartetAusV2]);
  });

  it('v1 zusammenfuehren: Stammdaten kommen, Vertrag ohne Wochenstunden bleibt', async () => {
    prefStore.set(
      'employments',
      JSON.stringify([
        {
          ...defaultEmployment,
          workdaysPerWeek: 3,
          vacationYearMode: 'full',
        },
      ]),
    );
    const backup = {
      app: 'zeiterfassung' as const,
      version: 1 as const,
      exportedAt: 1,
      profile: zeiterfassungV2.profile,
      entries: [baseEntry()],
    };
    await restoreBackup(JSON.stringify(backup), 'merge');
    const list = await getEmployments();
    expect(list).toHaveLength(1);
    const e = list[0];
    expect(e.name).toBe('Alt AG');
    expect(e.arbeitgeber).toBe('Alt AG');
    expect(e.personalnummer).toBe('P-77');
    expect(e.abteilung).toBe('Lager');
    expect(e.weeklyHours).toBe(0);
    expect(e.workdaysPerWeek).toBe(3);
    expect(e.vacationYearMode).toBe('full');
  });

  it('zusammenfuehren: eingerichtete Beschaeftigung bleibt unveraendert', async () => {
    const local = {
      ...defaultEmployment,
      name: 'Mein Job',
      arbeitgeber: 'Neu GmbH',
      personalnummer: 'N-1',
      abteilung: 'Kasse',
      weeklyHours: 12,
      workdaysPerWeek: 3,
    };
    prefStore.set('employments', JSON.stringify([local]));
    await restoreBackup(JSON.stringify(zeiterfassungV2), 'merge');
    const list = await getEmployments();
    expect(list[0].name).toBe('Mein Job');
    expect(list[0].arbeitgeber).toBe('Neu GmbH');
    expect(list[0].personalnummer).toBe('N-1');
    expect(list[0].abteilung).toBe('Kasse');
    expect(list[0].weeklyHours).toBe(12);
    expect(list[0].workdaysPerWeek).toBe(3);
  });

  it('zusammenfuehren: leerer Vertrag wird gefuellt, lokale Stammdaten bleiben', async () => {
    prefStore.set(
      'employments',
      JSON.stringify([
        {
          ...defaultEmployment,
          name: 'Mein Job',
          arbeitgeber: 'Neu GmbH',
        },
      ]),
    );
    await restoreBackup(JSON.stringify(zeiterfassungV2), 'merge');
    const e = (await getEmployments())[0];
    expect(e.weeklyHours).toBe(30);
    expect(e.workdaysPerWeek).toBe(4);
    expect(e.vacationYearMode).toBe('prorata');
    expect(e.name).toBe('Mein Job');
    expect(e.arbeitgeber).toBe('Neu GmbH');
    expect(e.personalnummer).toBe('');
    expect(e.abteilung).toBe('');
  });

  it('zusammenfuehren: leere Stammdaten werden gefuellt, Vertrag und Name bleiben', async () => {
    prefStore.set(
      'employments',
      JSON.stringify([
        {
          ...defaultEmployment,
          name: 'Nebenjob',
          weeklyHours: 12,
          workdaysPerWeek: 3,
        },
      ]),
    );
    await restoreBackup(JSON.stringify(zeiterfassungV2), 'merge');
    const e = (await getEmployments())[0];
    expect(e.weeklyHours).toBe(12);
    expect(e.workdaysPerWeek).toBe(3);
    expect(e.arbeitgeber).toBe('Alt AG');
    expect(e.personalnummer).toBe('P-77');
    expect(e.abteilung).toBe('Lager');
    expect(e.name).toBe('Nebenjob');
  });

  it('zusammenfuehren ohne lokale emp-1: Beschaeftigung aus dem Backup kommt hinzu', async () => {
    prefStore.set(
      'employments',
      JSON.stringify([
        {
          ...defaultEmployment,
          id: 'emp-x',
          name: 'Nebenjob',
          weeklyHours: 10,
        },
      ]),
    );
    await restoreBackup(JSON.stringify(zeiterfassungV2), 'merge');
    const list = await getEmployments();
    expect(list).toHaveLength(2);
    const empX = list.find((e) => e.id === 'emp-x');
    expect(empX?.name).toBe('Nebenjob');
    expect(empX?.weeklyHours).toBe(10);
    const emp1 = list.find((e) => e.id === 'emp-1');
    expect(emp1).toEqual(erwartetAusV2);

    const ids = new Set(list.map((e) => e.id));
    const entries = await getAllEntries();
    expect(entries.every((e) => ids.has(e.employmentId))).toBe(true);
    const vacations = await getVacationDays();
    expect(vacations.every((v) => ids.has(v.employmentId))).toBe(true);
  });

  it('v3 zusammenfuehren nach erstem Oeffnen: leere emp-1 wird aus dem Backup gefuellt', async () => {
    await getEmployments();
    const backup: BackupData = {
      app: 'zeiterfassung',
      version: 3,
      exportedAt: 1,
      profile: zeiterfassungV2.profile,
      entries: [],
      employments: [
        {
          ...defaultEmployment,
          name: 'Hauptjob',
          arbeitgeber: 'Alt AG',
          personalnummer: 'P-77',
          abteilung: 'Lager',
          weeklyHours: 30,
          workdaysPerWeek: 4,
        },
        {
          ...defaultEmployment,
          id: 'emp-b',
          name: 'Nebenjob',
          weeklyHours: 10,
        },
      ],
    };
    await restoreBackup(JSON.stringify(backup), 'merge');
    const list = await getEmployments();
    expect(list).toHaveLength(2);
    const emp1 = list.find((e) => e.id === 'emp-1');
    expect(emp1?.name).toBe('Hauptjob');
    expect(emp1?.arbeitgeber).toBe('Alt AG');
    expect(emp1?.personalnummer).toBe('P-77');
    expect(emp1?.abteilung).toBe('Lager');
    expect(emp1?.weeklyHours).toBe(30);
    expect(emp1?.workdaysPerWeek).toBe(4);
    const empB = list.find((e) => e.id === 'emp-b');
    expect(empB?.weeklyHours).toBe(10);
  });

  it('zusammenfuehren: Urlaubstag am selben Datum in anderer Beschaeftigung kommt hinzu', async () => {
    const tag = new Date(2026, 6, 6).getTime();
    const beide = [emp('emp-1', 'Hauptjob', 30), emp('emp-b', 'Nebenjob', 10)];
    prefStore.set('employments', JSON.stringify(beide));
    prefStore.set(
      'vacations',
      JSON.stringify([{ date: tag, note: '', employmentId: 'emp-1' }]),
    );
    const backup: BackupData = {
      app: 'zeiterfassung',
      version: 3,
      exportedAt: 1,
      profile: zeiterfassungV2.profile,
      entries: [],
      employments: beide,
      vacations: [{ date: tag, note: '', employmentId: 'emp-b' }],
    };
    await restoreBackup(JSON.stringify(backup), 'merge');
    const vacations = await getVacationDays();
    expect(vacations.map((v) => v.employmentId).sort()).toEqual(['emp-1', 'emp-b']);
    expect(vacations.every((v) => v.date === tag)).toBe(true);
  });

});

describe('Pausen mit Uhrzeit im Backup', () => {
  beforeEach(async () => {
    prefStore.clear();
    await Dexie.delete('zeiterfassung');
    db.close();
    await db.open();
  });

  function pauseDay(h1: number, m1: number, h2: number, m2: number) {
    return {
      start: new Date(2026, 6, 6, h1, m1).getTime(),
      end: new Date(2026, 6, 6, h2, m2).getTime(),
    };
  }

  it('Pausen mit Uhrzeit ueberstehen die Backup-Rundreise', async () => {
    const { addEntry } = await import('./entries');
    const start = new Date(2026, 6, 6, 8, 0).getTime();
    const end = new Date(2026, 6, 6, 16, 30).getTime();
    await addEntry({
      start,
      end,
      breakMinutes: 45,
      breaks: [pauseDay(12, 0, 12, 30), pauseDay(10, 0, 10, 15)],
      activity: 'a',
      note: '',
      source: 'manual',
    });
    const json = JSON.stringify(await buildBackup());
    prefStore.clear();
    await Dexie.delete('zeiterfassung');
    db.close();
    await db.open();
    await restoreBackup(json, 'replace');
    const imported = await getAllEntries();
    expect(imported).toHaveLength(1);
    expect(imported[0].breaks).toEqual([
      pauseDay(10, 0, 10, 15),
      pauseDay(12, 0, 12, 30),
    ]);
    expect(imported[0].breakMinutes).toBe(45);
  });

  it('ungueltige Pausen fallen beim Import weg, gueltige bleiben', async () => {
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
      entries: [
        {
          ...baseEntry(),
          breakMinutes: 0,
          breaks: [
            { start: 'x' as unknown as number, end: 5 },
            pauseDay(12, 30, 12, 0),
            pauseDay(12, 0, 12, 30),
          ],
        } as import('../domain/types').TimeEntry,
      ],
    };
    const n = await restoreBackup(JSON.stringify(backup), 'replace');
    expect(n).toBe(1);
    const imported = await getAllEntries();
    expect(imported[0].breaks).toEqual([pauseDay(12, 0, 12, 30)]);
  });

  it('aelterer Eintrag ohne Pausenzeiten bleibt wie er ist', async () => {
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
      entries: [baseEntry({ breakMinutes: 30 }) as import('../domain/types').TimeEntry],
    };
    await restoreBackup(JSON.stringify(backup), 'replace');
    const imported = await getAllEntries();
    expect(imported[0].breaks).toBeUndefined();
    expect(imported[0].breakMinutes).toBe(30);
  });

  it('Backup traegt clockodo, aber nie den Schluessel', async () => {
    const CFG = {
      apiUser: 'testnutzer',
      syncFrom: new Date(2026, 8, 1).getTime(),
      defaultCustomersId: 11,
      defaultProjectsId: null,
      defaultServicesId: 31,
      billable: 1 as const,
    };
    prefStore.set(
      'employments',
      JSON.stringify([{ ...defaultEmployment, clockodo: CFG }]),
    );
    const { setClockodoKey } = await import('../clockodo/key-store');
    await setClockodoKey('emp-1', 'KEY123');
    const json = JSON.stringify(await buildBackup());
    expect(json).toContain('testnutzer');
    expect(json).not.toContain('KEY123');
    prefStore.clear();
    secureStore.clear();
    await Dexie.delete('zeiterfassung');
    db.close();
    await db.open();
    await restoreBackup(json, 'replace');
    const list = await getEmployments();
    expect(list[0].clockodo).toEqual(CFG);
  });

});

describe('Clockodo-Auswahl im Backup', () => {
  beforeEach(async () => {
    prefStore.clear();
    await Dexie.delete('zeiterfassung');
    db.close();
    await db.open();
  });

  const REF = { customersId: 11, projectsId: 21, servicesId: 31 };

  function pauseDay(h1: number, m1: number, h2: number, m2: number) {
    return {
      start: new Date(2026, 6, 6, h1, m1).getTime(),
      end: new Date(2026, 6, 6, h2, m2).getTime(),
    };
  }

  it('Clockodo-Auswahl uebersteht die Backup-Rundreise', async () => {
    const { addEntry } = await import('./entries');
    const start = new Date(2026, 6, 6, 8, 0).getTime();
    const end = new Date(2026, 6, 6, 16, 30).getTime();
    await addEntry({
      start,
      end,
      breakMinutes: 45,
      breaks: [pauseDay(12, 0, 12, 30), pauseDay(10, 0, 10, 15)],
      activity: 'a',
      note: '',
      source: 'manual',
      clockodo: REF,
    });
    const json = JSON.stringify(await buildBackup());
    prefStore.clear();
    await Dexie.delete('zeiterfassung');
    db.close();
    await db.open();
    await restoreBackup(json, 'replace');
    const imported = await getAllEntries();
    expect(imported).toHaveLength(1);
    expect(imported[0].clockodo).toEqual(REF);
  });

  it('ungueltige Clockodo-Auswahl faellt beim Import weg', async () => {
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
      entries: [
        {
          ...baseEntry(),
          clockodo: { customersId: 'x', servicesId: 31 },
        } as unknown as import('../domain/types').TimeEntry,
      ],
    };
    const n = await restoreBackup(JSON.stringify(backup), 'replace');
    expect(n).toBe(1);
    const imported = await getAllEntries();
    expect(imported[0].clockodo).toBeUndefined();
  });

  it('Eintrag ohne Clockodo-Auswahl bleibt ohne', async () => {
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
      entries: [baseEntry() as import('../domain/types').TimeEntry],
    };
    await restoreBackup(JSON.stringify(backup), 'replace');
    const imported = await getAllEntries();
    expect(imported[0].clockodo).toBeUndefined();
  });
});

describe('Uebertragungsstand im Backup', () => {
  beforeEach(async () => {
    prefStore.clear();
    await Dexie.delete('zeiterfassung');
    db.close();
    await db.open();
  });

  const REF = { customersId: 11, projectsId: 21, servicesId: 31 };

  it('Uebertragungsstand uebersteht die Backup-Rundreise', async () => {
    const { addEntry } = await import('./entries');
    const sync = { ids: [101, 102], hash: 'abcd1234', at: 5 };
    const start = new Date(2026, 6, 6, 8, 0).getTime();
    const end = new Date(2026, 6, 6, 16, 30).getTime();
    await addEntry({
      start,
      end,
      breakMinutes: 0,
      activity: 'a',
      note: '',
      source: 'manual',
      clockodo: REF,
      clockodoSync: sync,
    });
    const json = JSON.stringify(await buildBackup());
    prefStore.clear();
    await Dexie.delete('zeiterfassung');
    db.close();
    await db.open();
    await restoreBackup(json, 'replace');
    const imported = await getAllEntries();
    expect(imported).toHaveLength(1);
    expect(imported[0].clockodoSync).toEqual(sync);
  });

  it('ungueltiger Uebertragungsstand faellt beim Import weg', async () => {
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
      entries: [
        {
          ...baseEntry(),
          clockodoSync: { ids: [], hash: 'x', at: 1 },
        } as unknown as import('../domain/types').TimeEntry,
      ],
    };
    await restoreBackup(JSON.stringify(backup), 'replace');
    const imported = await getAllEntries();
    expect(imported[0].clockodoSync).toBeUndefined();
  });
});

describe('Arbeitstage als Wochentage (AUF-027)', () => {
  beforeEach(async () => {
    prefStore.clear();
    await Dexie.delete('zeiterfassung');
    db.close();
    await db.open();
  });

  it('cleanEmployment traegt gueltige Wochentage, workdaysPerWeek folgt ihrer Zahl', () => {
    const base = { ...defaultEmployment, id: 'x', workdaysPerWeek: 5 };
    const e = cleanEmployment({ ...base, workWeekdays: [4, 1, 3, 2] });
    expect(e.workWeekdays).toEqual([1, 2, 3, 4]);
    expect(e.workdaysPerWeek).toBe(4);
    const kaputt = cleanEmployment({ ...base, workWeekdays: [1, 2, 3, 4, 5, 6, 0] });
    expect('workWeekdays' in kaputt).toBe(false);
    expect(kaputt.workdaysPerWeek).toBe(5);
    expect('workWeekdays' in cleanEmployment(base)).toBe(false);
  });

  it('Rundreise workWeekdays ueber Backup', async () => {
    prefStore.set(
      'employments',
      JSON.stringify([emp(INITIAL_EMPLOYMENT_ID, 'H', 20)]),
    );
    await updateEmployment(INITIAL_EMPLOYMENT_ID, {
      workWeekdays: [1, 2, 3, 4],
      workdaysPerWeek: 4,
    });
    const json = JSON.stringify(await buildBackup());
    prefStore.clear();
    await Dexie.delete('zeiterfassung');
    db.close();
    await db.open();
    await restoreBackup(json, 'replace');
    const list = await getEmployments();
    expect(list[0].workWeekdays).toEqual([1, 2, 3, 4]);
    expect(list[0].workdaysPerWeek).toBe(4);
  });

  it('fillEmptyEmployment uebernimmt die Wochentage nur mit dem Vertrag', () => {
    const local = cleanEmployment({ id: 'emp-1', workWeekdays: [1, 2] });
    const incoming = cleanEmployment({
      id: 'emp-1',
      weeklyHours: 30,
      workWeekdays: [2, 3, 4],
    });
    expect(fillEmptyEmployment(local, incoming).workWeekdays).toEqual([2, 3, 4]);
    const localMitStd = cleanEmployment({
      id: 'emp-1',
      weeklyHours: 20,
      workWeekdays: [1, 2],
    });
    expect(fillEmptyEmployment(localMitStd, incoming).workWeekdays).toEqual([1, 2]);
  });
});

describe('Feiertage einer Beschaeftigung im Backup (AUF-029)', () => {
  beforeEach(async () => {
    prefStore.clear();
    await Dexie.delete('zeiterfassung');
    db.close();
    await db.open();
  });

  const bayern = {
    land: 'BY',
    regional: ['mariaehimmelfahrt'],
    extra: [new Date(2026, 11, 24).getTime()],
    skip: [],
  };

  it('cleanEmployment traegt die Feiertage, ein ungueltiges Land faellt weg', () => {
    const base = { ...defaultEmployment, id: 'x' };
    expect(cleanEmployment({ ...base, publicHolidays: bayern }).publicHolidays).toEqual(bayern);
    expect('publicHolidays' in cleanEmployment({ ...base, publicHolidays: { land: 'XX' } })).toBe(
      false,
    );
    expect('publicHolidays' in cleanEmployment(base)).toBe(false);
  });

  it('Rundreise publicHolidays ueber Backup', async () => {
    prefStore.set('employments', JSON.stringify([emp(INITIAL_EMPLOYMENT_ID, 'H', 20)]));
    await updateEmployment(INITIAL_EMPLOYMENT_ID, {
      publicHolidays: { land: 'BY', regional: ['mariaehimmelfahrt'], extra: [], skip: [] },
    });
    const json = JSON.stringify(await buildBackup());
    prefStore.clear();
    await Dexie.delete('zeiterfassung');
    db.close();
    await db.open();
    await restoreBackup(json, 'replace');
    const list = await getEmployments();
    expect(list[0].publicHolidays).toEqual({
      land: 'BY',
      regional: ['mariaehimmelfahrt'],
      extra: [],
      skip: [],
    });
  });

  it('fillEmptyEmployment uebernimmt die Feiertage nur mit dem Vertrag', () => {
    const local = cleanEmployment({ id: 'emp-1' });
    const incoming = cleanEmployment({ id: 'emp-1', weeklyHours: 30, publicHolidays: bayern });
    expect(fillEmptyEmployment(local, incoming).publicHolidays).toEqual(bayern);
    const localMitStd = cleanEmployment({ id: 'emp-1', weeklyHours: 20 });
    expect(fillEmptyEmployment(localMitStd, incoming).publicHolidays).toBeUndefined();
  });
});
