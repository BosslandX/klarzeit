import { describe, expect, it } from 'vitest';
import type { ClockodoConfig } from './clockodo';
import type { TimeEntry } from './types';
import {
  buildEntryPayloads,
  canMarkClockodoDone,
  clockodoDoneQuestion,
  countTransferBuckets,
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

describe('Zaehlung im Clockodo-Kasten (AUF-039)', () => {
  it('countTransferBuckets zaehlt Eintraege vor Uebertragen ab mit', () => {
    // „Uebertragen ab“ ist der 01.09.2026 (CFG), der 31.08.2026 liegt davor.
    const vorher = {
      start: new Date(2026, 7, 31, 8, 0).getTime(),
      end: new Date(2026, 7, 31, 16, 0).getTime(),
    };
    const fertig = baseEntry({ note: 'fertig' });
    const liste: TimeEntry[] = [
      baseEntry(),
      baseEntry({ clockodoSync: { ids: [5], hash: 'alt', at: 1 } }),
      baseEntry({ breakMinutes: 30 }),
      baseEntry({ clockodo: undefined }),
      { ...fertig, clockodoSync: { ids: [6], hash: entrySyncHash(fertig, REF, CFG.billable), at: 1 } },
      baseEntry(vorher),
      baseEntry({ ...vorher, clockodo: undefined }),
      baseEntry({ employmentId: 'emp-2' }),
      baseEntry({ ...vorher, employmentId: 'emp-2' }),
    ];
    expect(countTransferBuckets(liste, 'emp-1', CFG)).toEqual({
      open: 2,
      untimed: 1,
      incomplete: 1,
      beforeStart: 2,
    });
    expect(countTransferBuckets(liste, 'emp-2', CFG)).toEqual({
      open: 1,
      untimed: 0,
      incomplete: 0,
      beforeStart: 1,
    });
  });
});

describe('Von Hand erledigt (AUF-040)', () => {
  const ALT = { ids: [5], hash: 'alt', at: 1 };

  it('transferStatus: von Hand erledigt bleibt erledigt, auch nach einer Aenderung', () => {
    expect(transferStatus(baseEntry({ clockodoDone: 5 }), CFG)).toBe('done');
    expect(transferStatus(baseEntry({ clockodoDone: 5, clockodo: undefined }), CFG)).toBe('done');
    expect(transferStatus(baseEntry({ clockodoDone: 5, breakMinutes: 30 }), CFG)).toBe('done');
    expect(transferStatus(baseEntry({ clockodoDone: 5 }), null)).toBe('none');
  });

  it('canMarkClockodoDone: nur offene, nie uebertragene Eintraege', () => {
    const fertig = baseEntry({ note: 'fertig' });
    const vorher = baseEntry({
      start: new Date(2026, 7, 31, 8, 0).getTime(),
      end: new Date(2026, 7, 31, 16, 0).getTime(),
    });
    expect(canMarkClockodoDone(baseEntry(), CFG)).toBe(true);
    expect(canMarkClockodoDone(baseEntry({ clockodo: undefined }), CFG)).toBe(true);
    expect(canMarkClockodoDone(baseEntry({ breakMinutes: 30 }), CFG)).toBe(true);
    expect(canMarkClockodoDone(baseEntry({ clockodoSync: ALT }), CFG)).toBe(false);
    expect(canMarkClockodoDone(baseEntry({ breakMinutes: 30, clockodoSync: ALT }), CFG)).toBe(false);
    expect(canMarkClockodoDone(baseEntry({ clockodo: undefined, clockodoSync: ALT }), CFG)).toBe(false);
    expect(
      canMarkClockodoDone(
        { ...fertig, clockodoSync: { ids: [6], hash: entrySyncHash(fertig, REF, CFG.billable), at: 1 } },
        CFG,
      ),
    ).toBe(false);
    expect(canMarkClockodoDone(vorher, CFG)).toBe(false);
    expect(canMarkClockodoDone(baseEntry({ clockodoDone: 5 }), CFG)).toBe(false);
    expect(canMarkClockodoDone(baseEntry(), null)).toBe(false);
  });

  it('clockodoDoneQuestion nennt den Eintrag und die Folge', () => {
    const e = { start: new Date(2026, 9, 15, 8, 0).getTime() };
    expect(clockodoDoneQuestion(e, true)).toBe(
      'Eintrag vom 15.10.2026 08:00 als in Clockodo erledigt markieren?\n' +
        'Klarzeit sendet ihn danach nie mehr, auch nicht nach einer Aenderung.',
    );
    expect(clockodoDoneQuestion(e, false)).toBe(
      'Eintrag vom 15.10.2026 08:00 wieder als offen fuehren?\n' +
        'Ist er vollstaendig, sendet Klarzeit ihn beim naechsten Uebertragen.',
    );
  });
});
