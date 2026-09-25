import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClockodoHttp, ClockodoRequest } from './client';
import type { TimeEntry } from '../domain/types';
import { buildEntryPayloads, entrySyncHash } from '../domain/clockodo-transfer';
import { defaultEmployment } from '../domain/employment';
import { INITIAL_EMPLOYMENT_ID } from '../db/employment';

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
import { addEntry, getEntry, updateEntry, setEntryClockodoSync, deleteEntryWithClockodo } from '../db/entries';
import { updateEmployment } from '../db/employment';
import { setClockodoKey } from './key-store';
import { addClockodoDeletes, getClockodoDeletes } from '../db/clockodo-deletes';
import { transferEmployment } from './transfer';

const EMP = INITIAL_EMPLOYMENT_ID;
const CFG_T = {
  apiUser: 'testnutzer',
  syncFrom: new Date(2026, 6, 1).getTime(),
  defaultCustomersId: 11,
  defaultProjectsId: null,
  defaultServicesId: 31,
  billable: 1 as const,
};
const REF = { customersId: 11, projectsId: null, servicesId: 31 };
const NOW = 1_800_000_000_000;

function pause(day: number) {
  return {
    start: new Date(2026, 6, day, 12, 0).getTime(),
    end: new Date(2026, 6, day, 12, 30).getTime(),
  };
}

function baseEntry(day: number, extra: Partial<TimeEntry> = {}): Omit<TimeEntry, 'id'> {
  return {
    employmentId: EMP,
    start: new Date(2026, 6, day, 8, 0).getTime(),
    end: new Date(2026, 6, day, 16, 30).getTime(),
    breaks: [pause(day)],
    breakMinutes: 30,
    clockodo: REF,
    activity: 'Doku',
    note: '',
    source: 'manual',
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

const E_DAY = 6;
const E2_DAY = 7;

let httpCalls: ClockodoRequest[] = [];
let postSeq = 0;
let postHandler: ((n: number) => { status: number; data: unknown }) | null = null;
let delHandler: ((id: number) => { status: number; data: unknown }) | null = null;

const http: ClockodoHttp = async (req) => {
  httpCalls.push(req);
  if (req.method === 'DELETE') {
    const id = Number(req.url.replace(/.*\//, ''));
    if (delHandler) return delHandler(id);
    return { status: 200, data: { success: true } };
  }
  if (req.method === 'POST') {
    postSeq++;
    if (postHandler) return postHandler(postSeq);
    const id = 500 + postSeq;
    return { status: 200, data: { entry: { id } } };
  }
  return { status: 200, data: {} };
};

async function seedClockodo() {
  prefStore.set(
    'employments',
    JSON.stringify([
      {
        ...defaultEmployment,
        id: EMP,
        name: 'Testjob',
        clockodo: CFG_T,
      },
    ]),
  );
  await setClockodoKey(EMP, 'KEY123');
}

describe('clockodo transfer', () => {
  beforeEach(async () => {
    prefStore.clear();
    secureStore.clear();
    httpCalls = [];
    postSeq = 0;
    postHandler = null;
    delHandler = null;
    db.close();
    await Dexie.delete('zeiterfassung');
    await db.open();
    await seedClockodo();
  });

  it('ohne Zugang wird nichts angefragt', async () => {
    prefStore.set(
      'employments',
      JSON.stringify([{ ...defaultEmployment, id: EMP, clockodo: null }]),
    );
    let r = await transferEmployment(EMP, { http, now: () => NOW });
    expect(r.stopped).toBe(
      'Clockodo ist fuer diese Beschaeftigung nicht eingeschaltet.',
    );
    await seedClockodo();
    await updateEmployment(EMP, {
      clockodo: { ...CFG_T, apiUser: '   ' },
    });
    r = await transferEmployment(EMP, { http, now: () => NOW });
    expect(r.stopped).toBe('Clockodo-Login fehlt.');
    await updateEmployment(EMP, { clockodo: CFG_T });
    await secureStore.delete(`clockodo-key-${EMP}`);
    r = await transferEmployment(EMP, { http, now: () => NOW });
    expect(r.stopped).toBe('API-Schluessel fehlt.');
    expect(httpCalls).toHaveLength(0);
  });

  it('offener Eintrag mit Pause wird zu zwei Clockodo-Eintraegen', async () => {
    const id = await addEntry(baseEntry(E_DAY));
    const E = { ...baseEntry(E_DAY), id } as TimeEntry;
    const r = await transferEmployment(EMP, { http, now: () => NOW });
    const posts = httpCalls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[0].data).toEqual(buildEntryPayloads(E, REF, 1)[0]);
    expect(posts[1].data).toEqual(buildEntryPayloads(E, REF, 1)[1]);
    const stored = await getEntry(id);
    expect(stored?.clockodoSync).toEqual({
      ids: [501, 502],
      hash: entrySyncHash(E, REF, 1),
      at: NOW,
    });
    expect(r).toMatchObject({ sent: 1, stopped: null, errors: [] });
  });

  it('uebertragener Eintrag wird nicht erneut gesendet', async () => {
    const id = await addEntry(baseEntry(E_DAY));
    await transferEmployment(EMP, { http, now: () => NOW });
    httpCalls = [];
    const r = await transferEmployment(EMP, { http, now: () => NOW });
    expect(httpCalls).toHaveLength(0);
    expect(r.sent).toBe(0);
  });

  it('geaenderter Eintrag loescht erst die alten und sendet dann neu', async () => {
    const id = await addEntry(baseEntry(E_DAY));
    await transferEmployment(EMP, { http, now: () => NOW });
    httpCalls = [];
    postSeq = 2;
    await updateEntry(id, { note: 'neu' });
    const r = await transferEmployment(EMP, { http, now: () => NOW });
    expect(httpCalls.map((c) => c.method)).toEqual([
      'DELETE',
      'DELETE',
      'POST',
      'POST',
    ]);
    const stored = await getEntry(id);
    expect(stored?.clockodoSync?.ids).toEqual([503, 504]);
    expect(r).toMatchObject({ deleted: 2, sent: 1 });
  });

  it('Loeschvermerke werden abgearbeitet', async () => {
    await addClockodoDeletes(EMP, [701, 702]);
    const r = await transferEmployment(EMP, { http, now: () => NOW });
    expect(httpCalls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual([
      'https://my.clockodo.com/api/v2/entries/701',
      'https://my.clockodo.com/api/v2/entries/702',
    ]);
    expect(await getClockodoDeletes(EMP)).toEqual([]);
    expect(r.deleted).toBe(2);
  });

  it('uebersprungene Eintraege werden gezaehlt und nicht gesendet', async () => {
    await addEntry({
      ...baseEntry(15),
      start: new Date(2026, 5, 15, 8, 0).getTime(),
      end: new Date(2026, 5, 15, 16, 0).getTime(),
      breaks: [pause(15)],
    });
    await addEntry({
      ...baseEntry(E_DAY),
      breaks: undefined,
      breakMinutes: 30,
    });
    await addEntry({
      ...baseEntry(E2_DAY),
      clockodo: null,
    });
    const r = await transferEmployment(EMP, { http, now: () => NOW });
    expect(httpCalls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(r.skipped).toEqual({
      beforeStart: 1,
      untimedBreak: 1,
      incomplete: 1,
    });
  });

  it('401 bricht den ganzen Lauf ab', async () => {
    const id1 = await addEntry(baseEntry(E_DAY));
    const id2 = await addEntry(baseEntry(E2_DAY));
    postHandler = () => ({
      status: 401,
      data: { message: 'unauthorized' },
    });
    const r = await transferEmployment(EMP, { http, now: () => NOW });
    expect(httpCalls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(r.stopped).toBe(
      'Anmeldung bei Clockodo fehlgeschlagen: E-Mail oder API-Schluessel pruefen.',
    );
    expect((await getEntry(id1))?.clockodoSync).toBeUndefined();
    expect((await getEntry(id2))?.clockodoSync).toBeUndefined();
  });

  it('422 trifft nur den Eintrag, der naechste wird gesendet', async () => {
    const idE = await addEntry(baseEntry(E_DAY));
    const idE2 = await addEntry(baseEntry(E2_DAY));
    postHandler = (n) => {
      if (n === 1) return { status: 422, data: {} };
      const id = 500 + n;
      return { status: 200, data: { entry: { id } } };
    };
    const r = await transferEmployment(EMP, { http, now: () => NOW });
    expect(r.errors).toEqual([
      {
        entryId: idE,
        message: 'Clockodo hat die Anfrage abgelehnt (Status 422).',
      },
    ]);
    expect((await getEntry(idE2))?.clockodoSync?.ids).toEqual([502, 503]);
    expect(r).toMatchObject({ sent: 1, stopped: null });
  });

  it('scheitert der zweite Abschnitt, wird der erste wieder geloescht', async () => {
    const id = await addEntry(baseEntry(E_DAY));
    postHandler = (n) => {
      if (n === 1) return { status: 200, data: { entry: { id: 501 } } };
      return { status: 422, data: {} };
    };
    const r = await transferEmployment(EMP, { http, now: () => NOW });
    expect(httpCalls.some((c) => c.method === 'DELETE' && c.url.endsWith('/501'))).toBe(
      true,
    );
    expect((await getEntry(id))?.clockodoSync).toBeUndefined();
    expect(r.errors).toHaveLength(1);
    expect(r.sent).toBe(0);
  });

  it('scheitert das Loeschen alter Abschnitte, wird nicht neu gesendet', async () => {
    const id = await addEntry(baseEntry(E_DAY));
    await transferEmployment(EMP, { http, now: () => NOW });
    await updateEntry(id, { note: 'neu' });
    httpCalls = [];
    postSeq = 2;
    delHandler = (cid) => {
      if (cid === 501) return { status: 403, data: {} };
      return { status: 200, data: { success: true } };
    };
    const r = await transferEmployment(EMP, { http, now: () => NOW });
    expect(httpCalls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect((await getEntry(id))?.clockodoSync?.ids).toEqual([501, 502]);
    expect(r.errors).toHaveLength(1);
  });

  it('teilweise geloeschte alte Abschnitte bleiben am Eintrag vermerkt', async () => {
    const id = await addEntry(baseEntry(E_DAY));
    await transferEmployment(EMP, { http, now: () => NOW });
    const first = (await getEntry(id))!.clockodoSync!;
    const hash = first.hash;
    const at = first.at;
    await updateEntry(id, { note: 'neu' });
    httpCalls = [];
    postSeq = 2;
    delHandler = (cid) => {
      if (cid === 502) return { status: 403, data: {} };
      return { status: 200, data: { success: true } };
    };
    const r = await transferEmployment(EMP, { http, now: () => NOW });
    const stored = await getEntry(id);
    expect(stored?.clockodoSync).toEqual({ ids: [502], hash, at });
    expect(httpCalls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(r.deleted).toBe(1);
  });

  it('deleteEntryWithClockodo vermerkt die IDs eines uebertragenen Eintrags', async () => {
    const id = await addEntry(baseEntry(E_DAY));
    await setEntryClockodoSync(id, { ids: [501, 502], hash: 'abc', at: 1 });
    const entry = await getEntry(id);
    await deleteEntryWithClockodo(entry!);
    expect(await getClockodoDeletes(EMP)).toEqual([501, 502]);
    expect(await getEntry(id)).toBeUndefined();
    const id2 = await addEntry(baseEntry(E2_DAY));
    const e2 = await getEntry(id2);
    await deleteEntryWithClockodo(e2!);
    expect(await getClockodoDeletes(EMP)).toEqual([501, 502]);
  });

  it('setEntryClockodoSync laesst updatedAt stehen und entfernt bei null', async () => {
    const id = await addEntry(baseEntry(E_DAY));
    const before = (await getEntry(id))!.updatedAt;
    await setEntryClockodoSync(id, { ids: [1], hash: 'h', at: 2 });
    let row = await getEntry(id);
    expect(row?.clockodoSync).toEqual({ ids: [1], hash: 'h', at: 2 });
    expect(row?.updatedAt).toBe(before);
    await setEntryClockodoSync(id, null);
    row = await getEntry(id);
    expect(row && 'clockodoSync' in row && row.clockodoSync !== undefined).toBe(false);
    expect(row?.updatedAt).toBe(before);
  });
});
