import { describe, expect, it } from 'vitest';
import type { ClockodoConfig } from './clockodo';
import type { TimeEntry } from './types';
import {
  buildEntryPayloads,
  entrySyncHash,
  entryText,
  toClockodoTime,
  transferStatus,
  workSegments,
} from './clockodo-transfer';

const REF = { customersId: 11, projectsId: 21, servicesId: 31 };

const E = {
  start: new Date(2026, 6, 6, 8, 0).getTime(),
  end: new Date(2026, 6, 6, 16, 30).getTime(),
};

function P(h1: number, m1: number, h2: number, m2: number) {
  return {
    start: new Date(2026, 6, 6, h1, m1).getTime(),
    end: new Date(2026, 6, 6, h2, m2).getTime(),
  };
}

const CFG: ClockodoConfig = {
  apiUser: 'testnutzer',
  syncFrom: new Date(2026, 8, 1).getTime(),
  defaultCustomersId: 11,
  defaultProjectsId: null,
  defaultServicesId: 31,
  billable: 1,
};

const AFTER_SYNC = {
  start: new Date(2026, 9, 15, 8, 0).getTime(),
  end: new Date(2026, 9, 15, 16, 30).getTime(),
};

function baseEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    employmentId: 'emp-1',
    start: AFTER_SYNC.start,
    end: AFTER_SYNC.end,
    breakMinutes: 0,
    activity: 'Doku',
    note: '',
    source: 'manual',
    createdAt: 1,
    updatedAt: 1,
    clockodo: REF,
    ...overrides,
  };
}

describe('clockodo-transfer', () => {
  it('workSegments ohne Pausen', () => {
    expect(workSegments(E)).toEqual([{ start: E.start, end: E.end }]);
  });

  it('workSegments mit zwei Pausen', () => {
    const breaks = [P(12, 0, 12, 30), P(10, 0, 10, 15)];
    const segs = workSegments({ ...E, breaks });
    expect(segs).toEqual([
      {
        start: new Date(2026, 6, 6, 8, 0).getTime(),
        end: new Date(2026, 6, 6, 10, 0).getTime(),
      },
      {
        start: new Date(2026, 6, 6, 10, 15).getTime(),
        end: new Date(2026, 6, 6, 12, 0).getTime(),
      },
      {
        start: new Date(2026, 6, 6, 12, 30).getTime(),
        end: E.end,
      },
    ]);
  });

  it('workSegments mit Pause am Rand', () => {
    const breaks = [P(8, 0, 8, 30)];
    expect(workSegments({ ...E, breaks })).toEqual([
      {
        start: new Date(2026, 6, 6, 8, 30).getTime(),
        end: E.end,
      },
    ]);
  });

  it('toClockodoTime in UTC ohne Millisekunden', () => {
    expect(toClockodoTime(Date.UTC(2026, 6, 6, 6, 0, 0, 123))).toBe(
      '2026-07-06T06:00:00Z',
    );
  });

  it('entryText verbindet Taetigkeit und Notiz', () => {
    expect(entryText({ activity: 'Doku', note: ' Ticket 12 ' })).toBe(
      'Doku – Ticket 12',
    );
    expect(entryText({ activity: 'Doku', note: '' })).toBe('Doku');
    expect(entryText({ activity: '', note: '' })).toBeNull();
  });

  it('buildEntryPayloads je Abschnitt', () => {
    const entry = {
      ...E,
      breaks: [P(12, 0, 12, 30), P(10, 0, 10, 15)],
      activity: 'Doku',
      note: '',
    };
    const payloads = buildEntryPayloads(entry, REF, 1);
    expect(payloads).toHaveLength(3);
    const segs = workSegments(entry);
    for (let i = 0; i < 3; i++) {
      expect(payloads[i]).toEqual({
        customers_id: 11,
        services_id: 31,
        projects_id: 21,
        billable: 1,
        text: 'Doku',
        time_since: toClockodoTime(segs[i].start),
        time_until: toClockodoTime(segs[i].end),
      });
    }
  });

  it('buildEntryPayloads laesst Leeres weg', () => {
    const ref = { customersId: 11, projectsId: null, servicesId: 31 };
    const entry = {
      ...E,
      activity: '',
      note: '',
    };
    const payloads = buildEntryPayloads(entry, ref, null);
    expect(payloads).toHaveLength(1);
    expect(Object.keys(payloads[0]).sort()).toEqual(
      ['customers_id', 'services_id', 'time_since', 'time_until'].sort(),
    );
  });

  it('entrySyncHash haengt nur am Gesendeten', () => {
    const entry = {
      ...E,
      breaks: [P(12, 0, 12, 30), P(10, 0, 10, 15)],
      activity: 'Doku',
      note: '',
    };
    const h1 = entrySyncHash(entry, REF, 1);
    const h2 = entrySyncHash(
      {
        ...entry,
        id: 99,
        updatedAt: 999,
        clockodoSync: { ids: [1], hash: 'x', at: 1 },
      } as TimeEntry,
      REF,
      1,
    );
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{8}$/);
  });

  it('entrySyncHash aendert sich mit dem Inhalt', () => {
    const base = {
      ...E,
      breaks: [P(12, 0, 12, 30), P(10, 0, 10, 15)],
      activity: 'Doku',
      note: '',
    };
    const orig = entrySyncHash(base, REF, 1);
    expect(
      entrySyncHash({ ...base, start: base.start + 60_000 }, REF, 1),
    ).not.toBe(orig);
    expect(
      entrySyncHash(
        {
          ...base,
          breaks: [P(12, 0, 12, 30), P(10, 5, 10, 20)],
        },
        REF,
        1,
      ),
    ).not.toBe(orig);
    expect(
      entrySyncHash(base, { ...REF, servicesId: 32 }, 1),
    ).not.toBe(orig);
    expect(
      entrySyncHash({ ...base, note: 'x' }, REF, 1),
    ).not.toBe(orig);
    expect(entrySyncHash(base, REF, 0)).not.toBe(orig);
  });

  it('transferStatus in fester Reihenfolge', () => {
    const full = baseEntry();
    expect(transferStatus(full, null)).toBe('none');
    expect(
      transferStatus(
        baseEntry({ start: CFG.syncFrom - 1 }),
        CFG,
      ),
    ).toBe('before-start');
    expect(
      transferStatus(
        baseEntry({ breakMinutes: 30, breaks: undefined }),
        CFG,
      ),
    ).toBe('untimed-break');
    expect(
      transferStatus(baseEntry({ clockodo: undefined }), CFG),
    ).toBe('incomplete');
    expect(
      transferStatus(
        baseEntry({
          breakMinutes: 30,
          breaks: undefined,
          clockodo: undefined,
        }),
        CFG,
      ),
    ).toBe('untimed-break');
    expect(transferStatus(full, CFG)).toBe('pending');
    const hash = entrySyncHash(full, REF, CFG.billable);
    expect(
      transferStatus(
        baseEntry({ clockodoSync: { ids: [1], hash, at: 2 } }),
        CFG,
      ),
    ).toBe('synced');
    expect(
      transferStatus(
        baseEntry({
          clockodoSync: { ids: [1], hash: 'deadbeef', at: 2 },
        }),
        CFG,
      ),
    ).toBe('changed');
  });
});
