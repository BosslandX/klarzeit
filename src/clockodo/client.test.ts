import { describe, expect, it } from 'vitest';
import {
  CLOCKODO_API,
  ClockodoError,
  clockodoHeaders,
  fetchLists,
  fetchMe,
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
      createEntry(AUTH, { customers_id: 11, services_id: 31 }, http),
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
