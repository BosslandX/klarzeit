import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCKODO_API, type ClockodoHttp, type ClockodoRequest } from './client';
import { defaultEmployment } from '../domain/employment';

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

import { INITIAL_EMPLOYMENT_ID } from '../db/employment';
import { getClockodoLock } from '../db/clockodo-lock';
import { setClockodoKey } from './key-store';
import { refreshClockodoLock } from './lock';

const EMP = INITIAL_EMPLOYMENT_ID;
const CFG = {
  apiUser: 'testnutzer',
  syncFrom: new Date(2026, 9, 1).getTime(),
  defaultCustomersId: null,
  defaultProjectsId: null,
  defaultServicesId: null,
  billable: null,
};
const ALT = '{"days":5,"at":1}';

let calls: ClockodoRequest[] = [];
let antwort: () => { status: number; data: unknown };
const http: ClockodoHttp = async (req) => {
  calls.push(req);
  return antwort();
};

function seed(clockodo: typeof CFG | null) {
  prefStore.set(
    'employments',
    JSON.stringify([{ ...defaultEmployment, id: EMP, name: 'Testjob', clockodo }]),
  );
}

describe('Sperrfrist aus Clockodo auffrischen (AUF-024)', () => {
  beforeEach(() => {
    prefStore.clear();
    secureStore.clear();
    calls = [];
    antwort = () => ({
      status: 200,
      data: { data: { id: 7, name: 'Test Person', edit_lock_dyn: 3 } },
    });
  });

  it('liest edit_lock_dyn und merkt es sich je Beschaeftigung', async () => {
    seed(CFG);
    await setClockodoKey(EMP, 'KEY123');
    expect(await refreshClockodoLock(EMP, { http, now: () => 1234 })).toEqual({
      days: 3,
      at: 1234,
    });
    expect(await getClockodoLock(EMP)).toEqual({ days: 3, at: 1234 });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${CLOCKODO_API}/v4/users/me`,
    ]);
  });

  it('meldet Clockodo keine Sperrfrist, wird das gemerkt', async () => {
    seed(CFG);
    await setClockodoKey(EMP, 'KEY123');
    antwort = () => ({
      status: 200,
      data: { data: { id: 7, name: 'Test Person', edit_lock_dyn: null } },
    });
    expect(await refreshClockodoLock(EMP, { http, now: () => 1234 })).toEqual({
      days: null,
      at: 1234,
    });
    expect(await getClockodoLock(EMP)).toEqual({ days: null, at: 1234 });
  });

  it('ohne Zugang wird nichts angefragt und die gemerkte bleibt', async () => {
    prefStore.set(`clockodoLock:${EMP}`, ALT);
    seed(null);
    await setClockodoKey(EMP, 'KEY123');
    expect(await refreshClockodoLock(EMP, { http })).toBeNull();
    seed(CFG);
    secureStore.clear();
    expect(await refreshClockodoLock(EMP, { http })).toBeNull();
    expect(calls).toHaveLength(0);
    expect(prefStore.get(`clockodoLock:${EMP}`)).toBe(ALT);
  });

  it('scheitert die Abfrage, bleibt die gemerkte Sperrfrist', async () => {
    prefStore.set(`clockodoLock:${EMP}`, ALT);
    seed(CFG);
    await setClockodoKey(EMP, 'KEY123');
    antwort = () => ({ status: 500, data: '<html>' });
    expect(await refreshClockodoLock(EMP, { http })).toBeNull();
    antwort = () => {
      throw new Error('offline');
    };
    expect(await refreshClockodoLock(EMP, { http })).toBeNull();
    antwort = () => ({ status: 200, data: { data: { name: 'ohne id' } } });
    expect(await refreshClockodoLock(EMP, { http })).toBeNull();
    expect(calls).toHaveLength(3);
    expect(prefStore.get(`clockodoLock:${EMP}`)).toBe(ALT);
  });
});
