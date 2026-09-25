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
  getActiveEmploymentId,
  getEmployments,
  INITIAL_EMPLOYMENT_ID,
  removeEmployment,
  setActiveEmployment,
} from './employment';
import { db } from './db';
import { addEntry, getEntry, updateEntry } from './entries';
import { defaultEmployment } from '../domain/employment';

function seedTwoEmployments() {
  prefStore.set(
    'employments',
    JSON.stringify([
      {
        ...defaultEmployment,
        id: INITIAL_EMPLOYMENT_ID,
        name: 'Hauptjob',
        weeklyHours: 40,
      },
      {
        ...defaultEmployment,
        id: 'emp-second',
        name: 'Nebenjob',
        weeklyHours: 10,
      },
    ]),
  );
}

describe('Aktive Beschaeftigung (AUF-006)', () => {
  beforeEach(async () => {
    prefStore.clear();
    await Dexie.delete('zeiterfassung');
    db.close();
    await db.open();
    seedTwoEmployments();
  });

  it('setActiveEmployment speichert und getActiveEmploymentId liest denselben Wert', async () => {
    await setActiveEmployment('emp-second');
    expect(await getActiveEmploymentId()).toBe('emp-second');
  });

  it('setActiveEmployment mit unbekannter ID wird abgelehnt und aendert den Wert nicht', async () => {
    await setActiveEmployment('emp-second');
    await expect(setActiveEmployment('emp-ghost')).rejects.toThrow(
      'Unbekannte Beschaeftigung',
    );
    expect(await getActiveEmploymentId()).toBe('emp-second');
  });

  it('getActiveEmploymentId faellt auf erste Beschaeftigung zurueck wenn activeEmployment tot ist', async () => {
    prefStore.set('activeEmployment', 'emp-second');
    await removeEmployment('emp-second');
    expect(await getActiveEmploymentId()).toBe(INITIAL_EMPLOYMENT_ID);
  });

  it('getActiveEmploymentId liefert erste Beschaeftigung ohne gesetzten activeEmployment-Schluessel', async () => {
    expect(prefStore.has('activeEmployment')).toBe(false);
    expect(await getActiveEmploymentId()).toBe(INITIAL_EMPLOYMENT_ID);
  });

  it('addEntry ohne employmentId nutzt die aktive Beschaeftigung', async () => {
    await setActiveEmployment('emp-second');
    const id = await addEntry({
      start: 1_700_000_000_000,
      end: 1_700_000_360_000,
      breakMinutes: 0,
      activity: 'a',
      note: '',
      source: 'manual',
    });
    const entry = await getEntry(id);
    expect(entry?.employmentId).toBe('emp-second');
  });

  it('updateEntry kann die Beschaeftigung eines Eintrags aendern', async () => {
    const id = await addEntry({
      start: 1_700_000_000_000,
      end: 1_700_000_360_000,
      breakMinutes: 0,
      activity: 'a',
      note: '',
      source: 'manual',
      employmentId: INITIAL_EMPLOYMENT_ID,
    });
    await updateEntry(id, { employmentId: 'emp-second' });
    const entry = await getEntry(id);
    expect(entry?.employmentId).toBe('emp-second');
  });
});
