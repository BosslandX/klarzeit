import { describe, expect, it } from 'vitest';
import {
  CLOCKODO_API,
  ClockodoError,
  clockodoHeaders,
  fetchLists,
  fetchMe,
  createAbsence,
  fetchAbsences,
  type ClockodoHttp,
  type ClockodoRequest,
} from './client';

const AUTH = { apiUser: 'testnutzer', apiKey: 'KEY123' };

describe('clockodo client', () => {
  it('clockodoHeaders nach Spezifikation', () => {
    expect(clockodoHeaders(AUTH)).toEqual({
      'X-ClockodoApiUser': 'testnutzer',
      'X-ClockodoApiKey': 'KEY123',
      'X-Clockodo-External-Application': 'Klarzeit;testnutzer',
      Accept: 'application/json',
    });
  });

  it('fetchMe liest id und name', async () => {
    const calls: ClockodoRequest[] = [];
    const http: ClockodoHttp = async (req) => {
      calls.push(req);
      return {
        status: 200,
        data: { data: { id: 7, name: 'Test Person' } },
      };
    };
    const me = await fetchMe(AUTH, http);
    expect(me).toEqual({ id: 7, name: 'Test Person' });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toBe(`${CLOCKODO_API}/v4/users/me`);
    expect(calls[0].headers).toEqual(clockodoHeaders(AUTH));
  });

  it('fetchMe versteht eine Text-Antwort', async () => {
    const http: ClockodoHttp = async () => ({
      status: 200,
      data: JSON.stringify({ data: { id: 7, name: 'Test Person' } }),
    });
    const me = await fetchMe(AUTH, http);
    expect(me).toEqual({ id: 7, name: 'Test Person' });
  });

  it('fetchLists holt alle Seiten', async () => {
    const calls: ClockodoRequest[] = [];
    const http: ClockodoHttp = async (req) => {
      calls.push(req);
      if (req.url.endsWith('/v3/customers')) {
        return {
          status: 200,
          data: {
            data: [{ id: 11, name: 'Kunde A', active: true }],
            paging: { count_pages: 1 },
          },
        };
      }
      if (req.url.endsWith('/v4/projects')) {
        const page = req.params?.page ?? '1';
        if (page === '1') {
          return {
            status: 200,
            data: {
              data: [
                {
                  id: 21,
                  name: 'Projekt X',
                  customers_id: 11,
                  active: true,
                },
              ],
              paging: { count_pages: 2 },
            },
          };
        }
        return {
          status: 200,
          data: {
            data: [
              {
                id: 22,
                name: 'Projekt Y',
                customers_id: 11,
                active: true,
              },
            ],
            paging: { count_pages: 2 },
          },
        };
      }
      if (req.url.endsWith('/v4/services')) {
        return {
          status: 200,
          data: {
            data: [{ id: 31, name: 'Leistung Eins', active: true }],
            paging: { count_pages: 1 },
          },
        };
      }
      throw new Error('unexpected url ' + req.url);
    };
    const now = 1_700_000_000_000;
    const lists = await fetchLists(AUTH, http, now);
    expect(lists.fetchedAt).toBe(now);
    expect(lists.projects).toEqual([
      { id: 21, name: 'Projekt X', customersId: 11 },
      { id: 22, name: 'Projekt Y', customersId: 11 },
    ]);
    const projectCalls = calls.filter((c) => c.url.endsWith('/v4/projects'));
    expect(projectCalls.some((c) => c.params?.page === '2')).toBe(true);
    expect(
      projectCalls.find((c) => c.params?.page === '2')?.params?.items_per_page,
    ).toBe('1000');
  });

  it('fetchLists nimmt nur aktive', async () => {
    const http: ClockodoHttp = async (req) => {
      if (req.url.endsWith('/v3/customers')) {
        return {
          status: 200,
          data: {
            data: [
              { id: 11, name: 'Kunde A', active: true },
              { id: 12, name: 'Kunde B', active: false },
            ],
          },
        };
      }
      if (req.url.endsWith('/v4/projects')) {
        return { status: 200, data: { data: [] } };
      }
      if (req.url.endsWith('/v4/services')) {
        return {
          status: 200,
          data: {
            data: [
              { id: 31, name: 'Leistung Eins', active: true },
              { id: 32, name: 'Leistung Zwei', active: false },
            ],
          },
        };
      }
      throw new Error('unexpected');
    };
    const lists = await fetchLists(AUTH, http, 0);
    expect(lists.customers).toEqual([{ id: 11, name: 'Kunde A' }]);
    expect(lists.services).toEqual([{ id: 31, name: 'Leistung Eins' }]);
  });

  it('Fehlerarten nach Status', async () => {
    const mk =
      (status: number): ClockodoHttp =>
      async () => ({ status, data: {} });

    const cases: { status: number; kind: string }[] = [
      { status: 401, kind: 'auth' },
      { status: 403, kind: 'forbidden' },
      { status: 429, kind: 'rate' },
      { status: 422, kind: 'validation' },
      { status: 500, kind: 'server' },
    ];
    for (const c of cases) {
      await expect(fetchMe(AUTH, mk(c.status))).rejects.toMatchObject({
        kind: c.kind,
      });
    }
    const throwing: ClockodoHttp = async () => {
      throw new Error('net down');
    };
    await expect(fetchMe(AUTH, throwing)).rejects.toMatchObject({
      kind: 'network',
    });
    const messages: string[] = [];
    for (const c of cases) {
      try {
        await fetchMe(AUTH, mk(c.status));
      } catch (e) {
        if (e instanceof ClockodoError) messages.push(e.message);
      }
    }
    try {
      await fetchMe(AUTH, throwing);
    } catch (e) {
      if (e instanceof ClockodoError) messages.push(e.message);
    }
    for (const m of messages) {
      expect(m).not.toContain('KEY123');
    }
  });
  it('Fehlerstatus kommt vor der Formpruefung bei POST und DELETE', async () => {
    const { createEntry, deleteClockodoEntry } = await import('./client');
    const payload = {
      customers_id: 11,
      services_id: 31,
      time_since: '2026-07-06T06:00:00Z',
      time_until: '2026-07-06T08:00:00Z',
    };
    const keinJson = (status: number): ClockodoHttp => async () => ({
      status,
      data: '<html>kein JSON</html>',
    });
    await expect(createEntry(AUTH, payload, keinJson(401))).rejects.toMatchObject({
      kind: 'auth',
    });
    await expect(deleteClockodoEntry(AUTH, 501, keinJson(500))).rejects.toMatchObject({
      kind: 'server',
    });
  });

  it('createAbsence sendet POST mit Typ 1 und Status 0 und liest die Abwesenheit', async () => {
    const calls: ClockodoRequest[] = [];
    const http: ClockodoHttp = async (req) => {
      calls.push(req);
      return {
        status: 200,
        data: {
          data: {
            id: 99,
            users_id: 7,
            date_since: '2026-10-05',
            date_until: '2026-10-09',
            status: 0,
            count_days: 5,
            note: null,
            public_note: null,
          },
        },
      };
    };
    const a = await createAbsence(
      AUTH,
      { usersId: 7, dateSince: '2026-10-05', dateUntil: '2026-10-09' },
      http,
    );
    expect(a).toEqual({
      id: 99,
      dateSince: '2026-10-05',
      dateUntil: '2026-10-09',
      status: 0,
      countDays: 5,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe(`${CLOCKODO_API}/v4/absences`);
    expect(calls[0].data).toEqual({
      users_id: 7,
      date_since: '2026-10-05',
      date_until: '2026-10-09',
      type: 1,
      status: 0,
    });
    expect(calls[0].headers['Content-Type']).toBe('application/json');
  });

  it('createAbsence: Ueberschneidung wird collision, aus 409 und aus dem Fehlertyp', async () => {
    const mit = (status: number, data: unknown): ClockodoHttp => async () => ({ status, data });
    const req = { usersId: 7, dateSince: '2026-10-05', dateUntil: '2026-10-09' };
    await expect(
      createAbsence(AUTH, req, mit(409, { errors: [{ type: 'General', message: 'x' }] })),
    ).rejects.toMatchObject({ kind: 'collision', status: 409 });
    await expect(
      createAbsence(
        AUTH,
        req,
        mit(422, {
          errors: [{ error: { type: 'AbsenceCollision', details: { colliding_absences: [3] } } }],
        }),
      ),
    ).rejects.toMatchObject({ kind: 'collision', status: 422 });
  });

  it('createAbsence: verbotener Status wird forbidden, 401 bleibt auth', async () => {
    const mit = (status: number, data: unknown): ClockodoHttp => async () => ({ status, data });
    const req = { usersId: 7, dateSince: '2026-10-05', dateUntil: '2026-10-09' };
    await expect(
      createAbsence(AUTH, req, mit(403, { errors: [{ type: 'StatusIsForbidden' }] })),
    ).rejects.toMatchObject({ kind: 'forbidden', status: 403 });
    await expect(
      createAbsence(AUTH, req, mit(422, { errors: [{ error: { type: 'StatusIsForbidden' } }] })),
    ).rejects.toMatchObject({ kind: 'forbidden', status: 422 });
    await expect(createAbsence(AUTH, req, mit(401, 'nicht erlaubt'))).rejects.toMatchObject({
      kind: 'auth',
      status: 401,
    });
  });

  it('createAbsence: Fehlertyp auch aus einer Text-Antwort', async () => {
    const http: ClockodoHttp = async () => ({
      status: 422,
      data: JSON.stringify({ errors: [{ error: { type: 'AbsenceCollision' } }] }),
    });
    await expect(
      createAbsence(AUTH, { usersId: 7, dateSince: '2026-10-05', dateUntil: '2026-10-09' }, http),
    ).rejects.toMatchObject({ kind: 'collision', status: 422 });
  });

  it('fetchAbsences fragt Person, Jahr und Typ 1 ab und liest die Liste', async () => {
    const calls: ClockodoRequest[] = [];
    const http: ClockodoHttp = async (req) => {
      calls.push(req);
      return {
        status: 200,
        data: {
          data: [
            {
              id: 3,
              users_id: 7,
              date_since: '2026-10-05',
              date_until: '2026-10-06',
              status: 1,
              count_days: 2,
            },
            {
              id: 4,
              users_id: 7,
              date_since: '2026-12-30',
              date_until: '2026-12-31',
              status: 0,
              count_days: null,
            },
          ],
        },
      };
    };
    const list = await fetchAbsences(AUTH, { usersId: 7, year: 2026 }, http);
    expect(list).toEqual([
      { id: 3, dateSince: '2026-10-05', dateUntil: '2026-10-06', status: 1, countDays: 2 },
      { id: 4, dateSince: '2026-12-30', dateUntil: '2026-12-31', status: 0, countDays: null },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toBe(`${CLOCKODO_API}/v4/absences`);
    expect(calls[0].params).toEqual({
      'filter[users_id]': '7',
      'filter[year]': '2026',
      'filter[type]': '1',
    });
  });

  it('fetchAbsences: kaputter Eintrag oder fehlende Liste ist ein Formatfehler', async () => {
    const mit = (data: unknown): ClockodoHttp => async () => ({ status: 200, data });
    const req = { usersId: 7, year: 2026 };
    const gut = { id: 3, date_since: '2026-10-05', date_until: '2026-10-06', status: 1 };
    await expect(fetchAbsences(AUTH, req, mit({ data: [{ ...gut, status: 9 }] }))).rejects.toMatchObject({ kind: 'format' });
    await expect(fetchAbsences(AUTH, req, mit({ data: [{ ...gut, date_since: '05.10.2026' }] }))).rejects.toMatchObject({ kind: 'format' });
    await expect(fetchAbsences(AUTH, req, mit({ data: {} }))).rejects.toMatchObject({ kind: 'format' });
  });

});
  it('createEntry sendet POST und liefert die id', async () => {
    const calls: ClockodoRequest[] = [];
    const payload = {
      customers_id: 11,
      services_id: 31,
      time_since: '2026-07-06T06:00:00Z',
      time_until: '2026-07-06T07:00:00Z',
    };
    const http: ClockodoHttp = async (req) => {
      calls.push(req);
      return {
        status: 200,
        data: { entry: { id: 501 }, stopped: null },
      };
    };
    const { createEntry } = await import('./client');
    const id = await createEntry(AUTH, payload, http);
    expect(id).toBe(501);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe(`${CLOCKODO_API}/v2/entries`);
    expect(calls[0].headers).toEqual({
      ...clockodoHeaders(AUTH),
      'Content-Type': 'application/json',
    });
    expect(calls[0].data).toEqual(payload);
  });

  it('createEntry ohne id ist ein Formatfehler', async () => {
    const http: ClockodoHttp = async () => ({
      status: 200,
      data: { entry: {} },
    });
    const { createEntry } = await import('./client');
    await expect(
      createEntry(
        AUTH,
        {
          customers_id: 11,
          services_id: 31,
          time_since: '2026-07-06T06:00:00Z',
          time_until: '2026-07-06T08:00:00Z',
        },
        http,
      ),
    ).rejects.toMatchObject({ kind: 'format' });
  });

  it('deleteClockodoEntry: 404 heisst schon geloescht', async () => {
    const { deleteClockodoEntry } = await import('./client');
    const mk = (status: number): ClockodoHttp => async (req) => {
      expect(req.method).toBe('DELETE');
      expect(req.url).toBe(`${CLOCKODO_API}/v2/entries/501`);
      return { status, data: { success: true } };
    };
    await deleteClockodoEntry(AUTH, 501, mk(200));
    await deleteClockodoEntry(AUTH, 501, mk(404));
    await expect(deleteClockodoEntry(AUTH, 501, mk(403))).rejects.toMatchObject({
      kind: 'forbidden',
    });
  });
