import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClockodoHttp, ClockodoRequest } from './client';
import { defaultEmployment, type VacationDay } from '../domain/employment';

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
  getVacationDays,
  saveVacationDays,
  updateEmployment,
  INITIAL_EMPLOYMENT_ID,
} from '../db/employment';
import { setClockodoKey } from './key-store';
import {
  transferVacations,
  vacationTransferSummary,
  vacationWithdrawQuestion,
  vacationWithdrawSummary,
  withdrawVacationRequest,
  type VacationTransferResult,
} from './vacation-transfer';

const EMP = INITIAL_EMPLOYMENT_ID;
const CFG = {
  apiUser: 'testnutzer',
  syncFrom: new Date(2026, 9, 1).getTime(),
  defaultCustomersId: null,
  defaultProjectsId: null,
  defaultServicesId: null,
  billable: null,
};
const NOW = 1_800_000_000_000;
const ab = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();
const tag = (y: number, m: number, d: number, over: Partial<VacationDay> = {}): VacationDay => ({
  employmentId: EMP,
  date: ab(y, m, d),
  note: '',
  ...over,
});

let calls: ClockodoRequest[] = [];
let absencesByYear: Record<string, unknown[]> = {};
let absencesStatus = 200;
let postSeq = 0;
let postHandler: ((n: number) => { status: number; data: unknown }) | null = null;

function absence(
  id: number,
  since: string,
  until: string,
  status: number,
  countDays: number | null = null,
) {
  return { id, users_id: 7, date_since: since, date_until: until, status, count_days: countDays };
}

const http: ClockodoHttp = async (req) => {
  calls.push(req);
  if (req.method === 'GET' && req.url.endsWith('/v4/users/me')) {
    return { status: 200, data: { data: { id: 7, name: 'Test Person' } } };
  }
  if (req.method === 'GET' && req.url.endsWith('/v4/absences')) {
    if (absencesStatus !== 200) {
      return { status: absencesStatus, data: { errors: [{ type: 'General', message: 'x' }] } };
    }
    const year = req.params?.['filter[year]'] ?? '';
    return { status: 200, data: { data: absencesByYear[year] ?? [] } };
  }
  if (req.method === 'POST' && req.url.endsWith('/v4/absences')) {
    postSeq++;
    if (postHandler) return postHandler(postSeq);
    const body = req.data as { date_since: string; date_until: string };
    return {
      status: 200,
      data: { data: absence(900 + postSeq, body.date_since, body.date_until, 0) },
    };
  }
  return { status: 404, data: {} };
};

const posts = () => calls.filter((c) => c.method === 'POST');
const ids = async () => (await getVacationDays()).map((d) => d.clockodoAbsence?.id);

async function seed(days: VacationDay[]) {
  prefStore.set(
    'employments',
    JSON.stringify([
      { ...defaultEmployment, id: EMP, name: 'Testjob', workdaysPerWeek: 5, clockodo: CFG },
    ]),
  );
  await setClockodoKey(EMP, 'KEY123');
  await saveVacationDays(days);
}

describe('Urlaubsantraege an Clockodo (AUF-020)', () => {
  beforeEach(() => {
    prefStore.clear();
    secureStore.clear();
    calls = [];
    absencesByYear = {};
    absencesStatus = 200;
    postSeq = 0;
    postHandler = null;
  });

  it('ohne Zugang wird nichts angefragt', async () => {
    prefStore.set(
      'employments',
      JSON.stringify([{ ...defaultEmployment, id: EMP, clockodo: null }]),
    );
    await saveVacationDays([tag(2026, 10, 5)]);
    let r = await transferVacations(EMP, { http, now: () => NOW });
    expect(r.stopped).toBe('Clockodo ist fuer diese Beschaeftigung nicht eingeschaltet.');
    await seed([tag(2026, 10, 5)]);
    await updateEmployment(EMP, { clockodo: { ...CFG, apiUser: '   ' } });
    r = await transferVacations(EMP, { http, now: () => NOW });
    expect(r.stopped).toBe('Clockodo-Login fehlt.');
    await updateEmployment(EMP, { clockodo: CFG });
    secureStore.delete(`clockodo-key-${EMP}`);
    r = await transferVacations(EMP, { http, now: () => NOW });
    expect(r.stopped).toBe('API-Schluessel fehlt.');
    expect(calls).toHaveLength(0);
  });

  it('ohne offene Tage und ohne Antraege wird nichts angefragt', async () => {
    await seed([tag(2026, 9, 30)]);
    const r = await transferVacations(EMP, { http, now: () => NOW });
    expect(r.stopped).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('je offenem Zeitraum ein Antrag: erst gelesen, dann gesendet und vermerkt', async () => {
    await seed([5, 6, 7, 8, 9, 14].map((d) => tag(2026, 10, d)));
    const r = await transferVacations(EMP, { http, now: () => NOW });
    expect(r).toMatchObject({ requested: 2, adopted: 0, updated: 0, missing: 0, errors: [], stopped: null });
    expect(calls.map((c) => `${c.method} ${c.url.replace(/.*\/api/, '')}`)).toEqual([
      'GET /v4/users/me',
      'GET /v4/absences',
      'POST /v4/absences',
      'POST /v4/absences',
    ]);
    expect(calls[1].params).toEqual({
      'filter[users_id]': '7',
      'filter[year]': '2026',
      'filter[type]': '1',
    });
    expect(posts().map((c) => c.data)).toEqual([
      { users_id: 7, date_since: '2026-10-05', date_until: '2026-10-09', type: 1, status: 0 },
      { users_id: 7, date_since: '2026-10-14', date_until: '2026-10-14', type: 1, status: 0 },
    ]);
    expect(await ids()).toEqual([901, 901, 901, 901, 901, 902]);
    expect((await getVacationDays())[0].clockodoAbsence).toEqual({ id: 901, status: 0, at: NOW });
  });

  it('gleicher Zeitraum in Clockodo wird uebernommen statt neu gesendet', async () => {
    await seed([5, 6, 7, 8, 9].map((d) => tag(2026, 10, d)));
    absencesByYear['2026'] = [absence(55, '2026-10-05', '2026-10-09', 1, 5)];
    const r = await transferVacations(EMP, { http, now: () => NOW });
    expect(r).toMatchObject({ requested: 0, adopted: 1, stopped: null });
    expect(posts()).toHaveLength(0);
    expect((await getVacationDays()).map((d) => d.clockodoAbsence)).toEqual(
      Array(5).fill({ id: 55, status: 1, at: NOW }),
    );
  });

  it('Status bekannter Antraege wird nachgezogen, ein verschwundener bleibt vermerkt', async () => {
    await seed([
      tag(2026, 10, 5, { clockodoAbsence: { id: 55, status: 0, at: 1 } }),
      tag(2026, 10, 6, { clockodoAbsence: { id: 55, status: 0, at: 1 } }),
      tag(2026, 10, 12, { clockodoAbsence: { id: 56, status: 1, at: 1 } }),
      tag(2026, 10, 14, { clockodoAbsence: { id: 77, status: 0, at: 1 } }),
    ]);
    absencesByYear['2026'] = [
      absence(55, '2026-10-05', '2026-10-06', 2),
      absence(56, '2026-10-12', '2026-10-12', 1),
    ];
    const r = await transferVacations(EMP, { http, now: () => NOW });
    expect(r).toMatchObject({ requested: 0, adopted: 0, updated: 2, missing: 1, stopped: null });
    expect(posts()).toHaveLength(0);
    expect((await getVacationDays()).map((d) => d.clockodoAbsence)).toEqual([
      { id: 55, status: 2, at: NOW },
      { id: 55, status: 2, at: NOW },
      { id: 56, status: 1, at: 1 },
      { id: 77, status: 0, at: 1 },
    ]);
  });

  it('Ueberschneidung trifft nur ihren Zeitraum, der naechste wird gesendet', async () => {
    await seed([5, 6, 14].map((d) => tag(2026, 10, d)));
    postHandler = (n) =>
      n === 1
        ? { status: 422, data: { errors: [{ error: { type: 'AbsenceCollision' } }] } }
        : { status: 200, data: { data: absence(902, '2026-10-14', '2026-10-14', 0) } };
    const r = await transferVacations(EMP, { http, now: () => NOW });
    expect(r.requested).toBe(1);
    expect(r.stopped).toBeNull();
    expect(r.errors).toEqual([
      {
        dateSince: '2026-10-05',
        dateUntil: '2026-10-06',
        message: 'Der Zeitraum ueberschneidet sich mit einer Abwesenheit in Clockodo.',
      },
    ]);
    expect(await ids()).toEqual([undefined, undefined, 902]);
  });

  it('401 beim Senden bricht ab, schon Gesendetes bleibt vermerkt', async () => {
    await seed([5, 6, 14].map((d) => tag(2026, 10, d)));
    postHandler = (n) =>
      n === 1
        ? { status: 200, data: { data: absence(901, '2026-10-05', '2026-10-06', 0) } }
        : { status: 401, data: 'nein' };
    const r = await transferVacations(EMP, { http, now: () => NOW });
    expect(r.requested).toBe(1);
    expect(r.stopped).toBe(
      'Anmeldung bei Clockodo fehlgeschlagen: E-Mail oder API-Schluessel pruefen.',
    );
    expect(await ids()).toEqual([901, 901, undefined]);
  });

  it('ohne gelesene Liste wird nichts gesendet', async () => {
    await seed([tag(2026, 10, 5)]);
    absencesStatus = 500;
    const r = await transferVacations(EMP, { http, now: () => NOW });
    expect(r.stopped).toBe('Clockodo meldet einen Fehler (Status 500).');
    expect(posts()).toHaveLength(0);
    expect(await ids()).toEqual([undefined]);
  });

  it('vermerkt nur Tage dieser Beschaeftigung, derselbe Tag einer anderen bleibt offen', async () => {
    await seed([tag(2026, 10, 5), tag(2026, 10, 5, { employmentId: 'emp-2' })]);
    const r = await transferVacations(EMP, { http, now: () => NOW });
    expect(r.requested).toBe(1);
    const days = await getVacationDays();
    expect(days.find((d) => d.employmentId === EMP)?.clockodoAbsence?.id).toBe(901);
    expect(days.find((d) => d.employmentId === 'emp-2')?.clockodoAbsence).toBeUndefined();
  });

  it('abweichende Tageszahl aus Clockodo wird gemeldet', async () => {
    await seed([5, 6, 7, 8, 9].map((d) => tag(2026, 10, d)));
    postHandler = () => ({
      status: 200,
      data: { data: absence(901, '2026-10-05', '2026-10-09', 0, 4) },
    });
    const r = await transferVacations(EMP, { http, now: () => NOW });
    expect(r.mismatches).toEqual([
      { dateSince: '2026-10-05', dateUntil: '2026-10-09', klarzeitDays: 5, clockodoDays: 4 },
    ]);
  });

  it('abweichende Tageszahl wird auch bei einem uebernommenen Antrag gemeldet', async () => {
    await seed([5, 6, 7, 8, 9].map((d) => tag(2026, 10, d)));
    absencesByYear['2026'] = [absence(55, '2026-10-05', '2026-10-09', 1, 4)];
    const r = await transferVacations(EMP, { http, now: () => NOW });
    expect(r.adopted).toBe(1);
    expect(r.mismatches).toEqual([
      { dateSince: '2026-10-05', dateUntil: '2026-10-09', klarzeitDays: 5, clockodoDays: 4 },
    ]);
  });

  it('ueber den Jahreswechsel werden beide Jahre gelesen, bevor gesendet wird', async () => {
    await seed([tag(2026, 12, 30), tag(2026, 12, 31), tag(2027, 1, 4)]);
    const r = await transferVacations(EMP, { http, now: () => NOW });
    expect(r.requested).toBe(2);
    const reads = calls.filter((c) => c.method === 'GET' && c.url.endsWith('/v4/absences'));
    expect(reads.map((c) => c.params?.['filter[year]'])).toEqual(['2026', '2027']);
    const firstPost = calls.findIndex((c) => c.method === 'POST');
    const lastGet = calls.map((c) => c.method).lastIndexOf('GET');
    expect(lastGet).toBeLessThan(firstPost);
  });
});

describe('Abgleich: Anzeige (AUF-021)', () => {
  const leer: VacationTransferResult = {
    requested: 0,
    adopted: 0,
    updated: 0,
    missing: 0,
    mismatches: [],
    errors: [],
    stopped: null,
  };

  it('vacationTransferSummary nennt Zahlen, Fehlende, Abweichungen und Fehler', () => {
    expect(
      vacationTransferSummary({
        ...leer,
        requested: 2,
        adopted: 1,
        updated: 3,
        missing: 1,
        mismatches: [
          { dateSince: '2026-10-05', dateUntil: '2026-10-09', klarzeitDays: 5, clockodoDays: 4 },
        ],
        errors: [
          {
            dateSince: '2026-10-14',
            dateUntil: '2026-10-14',
            message: 'Der Zeitraum ueberschneidet sich mit einer Abwesenheit in Clockodo.',
          },
        ],
      }),
    ).toEqual({
      info: ['2 beantragt, 1 uebernommen, 3 Status aktualisiert.'],
      problems: [
        '1 Urlaubstag(e): Antrag in Clockodo nicht gefunden.',
        '05.10.2026–09.10.2026: Clockodo zaehlt 4 Tag(e), Klarzeit 5.',
        '14.10.2026: Der Zeitraum ueberschneidet sich mit einer Abwesenheit in Clockodo.',
      ],
    });
  });

  it('vacationTransferSummary meldet den Abbruch', () => {
    expect(vacationTransferSummary({ ...leer, stopped: 'Clockodo-Login fehlt.' })).toEqual({
      info: ['0 beantragt, 0 uebernommen, 0 Status aktualisiert.'],
      problems: ['Abgebrochen: Clockodo-Login fehlt.'],
    });
  });
});

describe('Urlaubsantrag zurueckziehen (AUF-023)', () => {
  type Antwort = () => { status: number; data: unknown };
  let loeschen: Antwort;
  let stornieren: Antwort;
  const httpZ: ClockodoHttp = async (req) => {
    calls.push(req);
    if (req.method === 'DELETE') return loeschen();
    if (req.method === 'PUT') return stornieren();
    return { status: 500, data: {} };
  };
  const wege = () => calls.map((c) => `${c.method} ${c.url.replace(/.*\/api/, '')}`);
  const antrag = (status: number) => ({ clockodoAbsence: { id: 55, status: status as 0 | 1, at: 1 } });
  const tage = () => [
    tag(2026, 10, 5, antrag(0)),
    tag(2026, 10, 6, antrag(0)),
    tag(2026, 10, 6, { employmentId: 'emp-2', clockodoAbsence: { id: 77, status: 0, at: 1 } }),
    tag(2026, 10, 12, { clockodoAbsence: { id: 56, status: 1, at: 1 } }),
    tag(2026, 10, 14),
  ];
  const fehler = (status: number, type: string): Antwort => () => ({
    status,
    data: { errors: [{ error: { type } }] },
  });

  beforeEach(() => {
    prefStore.clear();
    secureStore.clear();
    calls = [];
    loeschen = () => ({ status: 200, data: { success: true } });
    stornieren = () => ({
      status: 200,
      data: { data: absence(55, '2026-10-05', '2026-10-06', 4) },
    });
  });

  it('Zurueckziehen loescht den Antrag und entfernt nur seine Tage', async () => {
    await seed(tage());
    const r = await withdrawVacationRequest(EMP, 55, { http: httpZ });
    expect(r).toEqual({ outcome: 'deleted', removed: 2, error: null });
    expect(wege()).toEqual(['DELETE /v4/absences/55']);
    expect((await getVacationDays()).map((d) => [d.employmentId, d.date])).toEqual([
      ['emp-2', ab(2026, 10, 6)],
      [EMP, ab(2026, 10, 12)],
      [EMP, ab(2026, 10, 14)],
    ]);
  });

  it('Darf Klarzeit den Antrag nicht loeschen, wird er storniert', async () => {
    await seed(tage());
    loeschen = fehler(403, 'CannotManageAbsencesOfUser');
    const r = await withdrawVacationRequest(EMP, 55, { http: httpZ });
    expect(r).toEqual({ outcome: 'cancelled', removed: 2, error: null });
    expect(wege()).toEqual(['DELETE /v4/absences/55', 'PUT /v4/absences/55']);
    expect(calls[1].data).toEqual({ status: 4 });
    expect(await getVacationDays()).toHaveLength(3);
  });

  it('Antrag in Clockodo verschwunden: die Tage werden entfernt', async () => {
    await seed(tage());
    loeschen = () => ({ status: 404, data: {} });
    stornieren = () => ({ status: 404, data: {} });
    const r = await withdrawVacationRequest(EMP, 55, { http: httpZ });
    expect(r).toEqual({ outcome: 'gone', removed: 2, error: null });
    expect(wege()).toEqual(['DELETE /v4/absences/55']);
    expect(await getVacationDays()).toHaveLength(3);
  });

  it('Lehnt Clockodo beides ab, bleibt alles stehen und beide Gruende werden genannt', async () => {
    await seed(tage());
    loeschen = fehler(422, 'AbsenceHasToBeDeclined');
    stornieren = fehler(422, 'StatusIsForbidden');
    const r = await withdrawVacationRequest(EMP, 55, { http: httpZ });
    expect(r).toEqual({
      outcome: null,
      removed: 0,
      error:
        'Loeschen: Der Antrag muss in Clockodo erst abgelehnt werden. / Stornieren: Clockodo laesst einen Urlaubsantrag fuer diesen Zugang nicht zu.',
    });
    expect(await getVacationDays()).toEqual(tage());
  });

  it('Ohne Netz wird nicht storniert und nichts entfernt', async () => {
    await seed(tage());
    loeschen = () => {
      throw new Error('offline');
    };
    const r = await withdrawVacationRequest(EMP, 55, { http: httpZ });
    expect(r).toEqual({ outcome: null, removed: 0, error: 'Keine Verbindung zu Clockodo.' });
    expect(wege()).toEqual(['DELETE /v4/absences/55']);
    expect(await getVacationDays()).toEqual(tage());
  });

  it('Storniert Clockodo nicht, bleibt alles stehen', async () => {
    await seed(tage());
    loeschen = () => ({ status: 403, data: {} });
    stornieren = () => ({
      status: 200,
      data: { data: absence(55, '2026-10-05', '2026-10-06', 0) },
    });
    const r = await withdrawVacationRequest(EMP, 55, { http: httpZ });
    expect(r).toEqual({
      outcome: null,
      removed: 0,
      error:
        'Loeschen: Keine Berechtigung bei Clockodo. / Stornieren: Clockodo hat den Antrag nicht storniert.',
    });
    expect(await getVacationDays()).toEqual(tage());
  });

  it('Zurueckziehen ohne Zugang fragt nichts an', async () => {
    prefStore.set(
      'employments',
      JSON.stringify([{ ...defaultEmployment, id: EMP, clockodo: null }]),
    );
    await saveVacationDays(tage());
    const r = await withdrawVacationRequest(EMP, 55, { http: httpZ });
    expect(r).toEqual({
      outcome: null,
      removed: 0,
      error: 'Clockodo ist fuer diese Beschaeftigung nicht eingeschaltet.',
    });
    expect(calls).toHaveLength(0);
    expect(await getVacationDays()).toEqual(tage());
  });

  it('vacationWithdrawQuestion nennt Zeitraum und Zahl der Tage', () => {
    const days = [
      ...[5, 6, 7, 8, 9].map((d) => tag(2026, 10, d, antrag(0))),
      tag(2026, 10, 12, { clockodoAbsence: { id: 56, status: 1, at: 1 } }),
    ];
    expect(vacationWithdrawQuestion(days, EMP, 55)).toBe(
      'Antrag 05.10.2026–09.10.2026 (5 Urlaubstag(e)) in Clockodo zurueckziehen? Die Tage werden danach aus Klarzeit entfernt.',
    );
    expect(vacationWithdrawQuestion(days, EMP, 56)).toBe(
      'Antrag 12.10.2026 (1 Urlaubstag(e)) in Clockodo zurueckziehen? Die Tage werden danach aus Klarzeit entfernt.',
    );
  });

  it('vacationWithdrawSummary nennt den Ausgang', () => {
    expect(
      [
        { outcome: 'deleted' as const, removed: 2, error: null },
        { outcome: 'cancelled' as const, removed: 1, error: null },
        { outcome: 'gone' as const, removed: 3, error: null },
        { outcome: null, removed: 0, error: 'Clockodo-Login fehlt.' },
      ].map(vacationWithdrawSummary),
    ).toEqual([
      'Antrag in Clockodo geloescht, 2 Urlaubstag(e) entfernt.',
      'Antrag in Clockodo storniert, 1 Urlaubstag(e) entfernt.',
      'Antrag war in Clockodo nicht mehr vorhanden, 3 Urlaubstag(e) entfernt.',
      'Zurueckziehen fehlgeschlagen: Clockodo-Login fehlt.',
    ]);
  });
});

describe('Urlaubsantrag zurueckziehen: Nacharbeit (AUF-023)', () => {
  it('vacationWithdrawQuestion nimmt den fruehesten und den spaetesten Tag, auch unsortiert', () => {
    const ref = { clockodoAbsence: { id: 55, status: 0 as const, at: 1 } };
    const days = [tag(2026, 10, 9, ref), tag(2026, 10, 5, ref), tag(2026, 10, 7, ref)];
    expect(vacationWithdrawQuestion(days, EMP, 55)).toBe(
      'Antrag 05.10.2026–09.10.2026 (3 Urlaubstag(e)) in Clockodo zurueckziehen? Die Tage werden danach aus Klarzeit entfernt.',
    );
  });
});
