import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCKODO_API, type ClockodoHttp, type ClockodoRequest } from './client';
import { defaultEmployment, type Employment } from '../domain/employment';
import type { TimeEntry } from '../domain/types';

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

import { db } from '../db/db';
import { addEntry, getEntry } from '../db/entries';
import { getClockodoLock } from '../db/clockodo-lock';
import { setClockodoKey } from './key-store';
import type { TransferResult } from './transfer';
import {
  autoTransferEmploymentIds,
  autoTransferHint,
  lastAutoTransferResults,
  onAutoTransferResults,
  runAutoTransfer,
} from './auto-transfer';

const CFG = {
  apiUser: 'testnutzer',
  syncFrom: new Date(2026, 6, 1).getTime(),
  defaultCustomersId: 11,
  defaultProjectsId: null,
  defaultServicesId: 31,
  billable: null,
};
const REF = { customersId: 11, projectsId: null, servicesId: 31 };
/** Dienstag, 07.07.2026, 12:00 */
const NOW = new Date(2026, 6, 7, 12).getTime();

function eintrag(employmentId: string, day: number): Omit<TimeEntry, 'id'> {
  return {
    employmentId,
    start: new Date(2026, 6, day, 8, 0).getTime(),
    end: new Date(2026, 6, day, 16, 0).getTime(),
    breaks: [],
    breakMinutes: 0,
    clockodo: REF,
    activity: 'Doku',
    note: '',
    source: 'manual',
    createdAt: 1,
    updatedAt: 1,
  };
}

function beschaeftigung(id: string, clockodo: Record<string, unknown> | null): Employment {
  return { ...defaultEmployment, id, name: id, clockodo } as Employment;
}

let calls: ClockodoRequest[] = [];
let postSeq = 0;
const http: ClockodoHttp = async (req) => {
  calls.push(req);
  if (req.method === 'GET' && req.url.endsWith('/v4/users/me')) {
    return { status: 200, data: { data: { id: 7, name: 'Test Person', edit_lock_dyn: 3 } } };
  }
  if (req.method === 'POST') {
    postSeq++;
    return { status: 200, data: { entry: { id: 900 + postSeq } } };
  }
  return { status: 500, data: {} };
};
const wege = () => calls.map((c) => `${c.method} ${c.url.replace(CLOCKODO_API, '')}`);

describe('Automatisch uebertragen (AUF-025)', () => {
  beforeEach(async () => {
    prefStore.clear();
    secureStore.clear();
    calls = [];
    postSeq = 0;
    db.close();
    await Dexie.delete('zeiterfassung');
    await db.open();
  });

  it('autoTransferEmploymentIds nimmt nur Beschaeftigungen mit eingeschaltetem Schalter', () => {
    expect(
      autoTransferEmploymentIds([
        beschaeftigung('emp-a', null),
        beschaeftigung('emp-b', CFG),
        beschaeftigung('emp-c', { ...CFG, autoTransfer: false }),
        beschaeftigung('emp-d', { ...CFG, autoTransfer: true }),
      ]),
    ).toEqual(['emp-d']);
  });

  it('runAutoTransfer frischt die Sperrfrist auf und uebertraegt nur, wo der Schalter an ist', async () => {
    prefStore.set(
      'employments',
      JSON.stringify([
        beschaeftigung('emp-1', { ...CFG, autoTransfer: true }),
        beschaeftigung('emp-2', CFG),
      ]),
    );
    await setClockodoKey('emp-1', 'KEY1');
    await setClockodoKey('emp-2', 'KEY2');
    const e1 = await addEntry(eintrag('emp-1', 6));
    const e2 = await addEntry(eintrag('emp-2', 6));
    let gemeldet = 0;
    const abmelden = onAutoTransferResults(() => {
      gemeldet++;
    });
    const r = await runAutoTransfer({ http, now: () => NOW });
    abmelden();
    expect(wege()).toEqual(['GET /v4/users/me', 'POST /v2/entries']);
    expect(Object.keys(r)).toEqual(['emp-1']);
    expect(r['emp-1']).toMatchObject({ sent: 1, stopped: null, errors: [] });
    expect(lastAutoTransferResults()['emp-1']).toEqual(r['emp-1']);
    expect(gemeldet).toBe(1);
    expect(await getClockodoLock('emp-1')).toEqual({ days: 3, at: NOW });
    expect((await getEntry(e1))?.clockodoSync?.ids).toEqual([901]);
    expect((await getEntry(e2))?.clockodoSync).toBeUndefined();
  });

  it('der automatische Lauf laesst gesperrte Eintraege aus', async () => {
    prefStore.set(
      'employments',
      JSON.stringify([beschaeftigung('emp-1', { ...CFG, autoTransfer: true })]),
    );
    await setClockodoKey('emp-1', 'KEY1');
    const alt = await addEntry(eintrag('emp-1', 3));
    const neu = await addEntry(eintrag('emp-1', 6));
    const r = await runAutoTransfer({ http, now: () => NOW });
    expect(r['emp-1'].sent).toBe(1);
    expect((await getEntry(alt))?.clockodoSync).toBeUndefined();
    expect((await getEntry(neu))?.clockodoSync?.ids).toEqual([901]);
  });

  it('eine Beschaeftigung ohne Schluessel haelt die naechste nicht auf', async () => {
    prefStore.set(
      'employments',
      JSON.stringify([
        beschaeftigung('emp-1', { ...CFG, autoTransfer: true }),
        beschaeftigung('emp-2', { ...CFG, autoTransfer: true }),
      ]),
    );
    await setClockodoKey('emp-2', 'KEY2');
    const e2 = await addEntry(eintrag('emp-2', 6));
    const r = await runAutoTransfer({ http, now: () => NOW });
    expect(r['emp-1'].stopped).toBe('API-Schluessel fehlt.');
    expect(r['emp-2']).toMatchObject({ sent: 1, stopped: null });
    expect((await getEntry(e2))?.clockodoSync?.ids).toEqual([901]);
  });

  it('autoTransferHint nennt Abbruch und Fehler, sonst nichts', () => {
    const leer: TransferResult = {
      sent: 0,
      deleted: 0,
      skipped: { beforeStart: 0, untimedBreak: 0, incomplete: 0 },
      errors: [],
      stopped: null,
    };
    expect(autoTransferHint(undefined)).toBeNull();
    expect(autoTransferHint({ ...leer, sent: 3 })).toBeNull();
    expect(autoTransferHint({ ...leer, stopped: 'Keine Verbindung zu Clockodo.' })).toBe(
      'Automatisches Uebertragen abgebrochen: Keine Verbindung zu Clockodo.',
    );
    expect(autoTransferHint({ ...leer, errors: [{ entryId: 1, message: 'x' }] })).toBe(
      'Automatisches Uebertragen: 1 Fehler – „An Clockodo uebertragen" unter „Eintraege" zeigt die Gruende.',
    );
    expect(
      autoTransferHint({
        ...leer,
        errors: [
          { entryId: 1, message: 'x' },
          { clockodoId: 5, message: 'y' },
        ],
      }),
    ).toBe(
      'Automatisches Uebertragen: 2 Fehler – „An Clockodo uebertragen" unter „Eintraege" zeigt die Gruende.',
    );
  });
});
