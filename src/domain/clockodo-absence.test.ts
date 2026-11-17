import { describe, expect, it } from 'vitest';
import {
  absenceStatusLabel,
  applyAbsenceRef,
  daysOfAbsence,
  isVacationDayRemovable,
  openVacationDayCount,
  syncAbsenceStatus,
  vacationRequestRanges,
} from './clockodo-absence';
import {
  defaultEmployment,
  type Employment,
  type VacationDay,
} from './employment';

const ab = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

function empMit(
  over: Partial<Employment> = {},
  syncFrom: number = ab(2026, 1, 1),
): Employment {
  return {
    ...defaultEmployment,
    id: 'emp-1',
    workdaysPerWeek: 5,
    clockodo: {
      apiUser: 'testnutzer',
      syncFrom,
      defaultCustomersId: null,
      defaultProjectsId: null,
      defaultServicesId: null,
      billable: null,
    },
    ...over,
  };
}

function tag(
  y: number,
  m: number,
  d: number,
  over: Partial<VacationDay> = {},
): VacationDay {
  return { employmentId: 'emp-1', date: ab(y, m, d), note: '', ...over };
}

const spannen = (days: VacationDay[], emp: Employment) =>
  vacationRequestRanges(days, emp).map((r) => [r.dateSince, r.dateUntil]);

describe('Urlaubsantraege: Zeitraeume (AUF-019)', () => {
  it('vacationRequestRanges: Mo bis Fr am Stueck ist ein Zeitraum', () => {
    const days = [5, 6, 7, 8, 9].map((d) => tag(2026, 10, d));
    expect(vacationRequestRanges(days, empMit())).toEqual([
      {
        dateSince: '2026-10-05',
        dateUntil: '2026-10-09',
        dates: [5, 6, 7, 8, 9].map((d) => ab(2026, 10, d)),
      },
    ]);
  });

  it('vacationRequestRanges: Wochenende dazwischen trennt nicht, ein freier Arbeitstag schon', () => {
    const days = [tag(2026, 10, 9), tag(2026, 10, 12), tag(2026, 10, 14)];
    expect(spannen(days, empMit())).toEqual([
      ['2026-10-09', '2026-10-12'],
      ['2026-10-14', '2026-10-14'],
    ]);
  });

  it('vacationRequestRanges: bei sechs Arbeitstagen trennt der Samstag', () => {
    const days = [tag(2026, 10, 9), tag(2026, 10, 12)];
    expect(spannen(days, empMit({ workdaysPerWeek: 6 }))).toEqual([
      ['2026-10-09', '2026-10-09'],
      ['2026-10-12', '2026-10-12'],
    ]);
  });

  it('vacationRequestRanges: der Jahreswechsel trennt', () => {
    const days = [
      tag(2026, 12, 30),
      tag(2026, 12, 31),
      tag(2027, 1, 1),
      tag(2027, 1, 4),
    ];
    expect(spannen(days, empMit())).toEqual([
      ['2026-12-30', '2026-12-31'],
      ['2027-01-01', '2027-01-04'],
    ]);
  });

  it('vacationRequestRanges: nur offene Tage der Beschaeftigung ab Uebertragen ab', () => {
    const days = [
      tag(2026, 10, 7),
      tag(2026, 10, 5, { employmentId: 'emp-2' }),
      tag(2026, 10, 2),
      tag(2026, 10, 6, { clockodoAbsence: { id: 3, status: 0, at: 1 } }),
      tag(2026, 10, 5),
    ];
    expect(vacationRequestRanges(days, empMit({}, ab(2026, 10, 5)))).toEqual([
      { dateSince: '2026-10-05', dateUntil: '2026-10-05', dates: [ab(2026, 10, 5)] },
      { dateSince: '2026-10-07', dateUntil: '2026-10-07', dates: [ab(2026, 10, 7)] },
    ]);
  });

  it('vacationRequestRanges: ohne Clockodo-Zugang leer', () => {
    expect(vacationRequestRanges([tag(2026, 10, 5)], empMit({ clockodo: null }))).toEqual([]);
  });
});

describe('Urlaubsantraege: Verweise (AUF-020)', () => {
  it('applyAbsenceRef setzt den Verweis nur an den genannten Tagen der Beschaeftigung', () => {
    const days = [
      tag(2026, 10, 5),
      tag(2026, 10, 5, { employmentId: 'emp-2' }),
      tag(2026, 10, 6),
      tag(2026, 10, 7),
    ];
    const vorher = JSON.stringify(days);
    const ref = { id: 9, status: 0 as const, at: 1 };
    const out = applyAbsenceRef(days, 'emp-1', [ab(2026, 10, 5), ab(2026, 10, 6)], ref);
    expect(out.map((d) => d.clockodoAbsence)).toEqual([ref, undefined, ref, undefined]);
    expect(JSON.stringify(days)).toBe(vorher);
  });

  it('syncAbsenceStatus zieht geaenderten Status nach und zaehlt verschwundene', () => {
    const days = [
      tag(2026, 10, 5, { clockodoAbsence: { id: 1, status: 0, at: 1 } }),
      tag(2026, 10, 6, { clockodoAbsence: { id: 2, status: 1, at: 1 } }),
      tag(2026, 10, 7, { clockodoAbsence: { id: 3, status: 0, at: 1 } }),
      tag(2026, 10, 8, { employmentId: 'emp-2', clockodoAbsence: { id: 1, status: 0, at: 1 } }),
      tag(2026, 10, 9),
    ];
    const r = syncAbsenceStatus(
      days,
      'emp-1',
      [
        { id: 1, status: 2 },
        { id: 2, status: 1 },
      ],
      99,
    );
    expect(r.updated).toBe(1);
    expect(r.missing).toBe(1);
    expect(r.days.map((d) => d.clockodoAbsence)).toEqual([
      { id: 1, status: 2, at: 99 },
      { id: 2, status: 1, at: 1 },
      { id: 3, status: 0, at: 1 },
      { id: 1, status: 0, at: 1 },
      undefined,
    ]);
  });
});

describe('Urlaubsantraege: Anzeige (AUF-021)', () => {
  it('absenceStatusLabel nennt den Clockodo-Stand', () => {
    expect(absenceStatusLabel(undefined)).toBe('nicht beantragt');
    expect([0, 1, 2, 3, 4].map((status) =>
      absenceStatusLabel({ id: 1, status: status as 0 | 1 | 2 | 3 | 4, at: 1 }),
    )).toEqual(['beantragt', 'genehmigt', 'abgelehnt', 'Genehmigung zurueckgenommen', 'storniert']);
  });

  it('isVacationDayRemovable: beantragt und genehmigt bleiben, der Rest darf weg', () => {
    expect(isVacationDayRemovable(tag(2026, 10, 5))).toBe(true);
    expect([0, 1, 2, 3, 4].map((status) =>
      isVacationDayRemovable(
        tag(2026, 10, 5, { clockodoAbsence: { id: 1, status: status as 0 | 1 | 2 | 3 | 4, at: 1 } }),
      ),
    )).toEqual([false, false, true, true, true]);
  });

  it('openVacationDayCount zaehlt offene Tage, nicht Zeitraeume', () => {
    const days = [
      ...[5, 6, 7, 8, 9, 14].map((d) => tag(2026, 10, d)),
      tag(2026, 10, 12, { clockodoAbsence: { id: 3, status: 0, at: 1 } }),
    ];
    expect(openVacationDayCount(days, empMit())).toBe(6);
    expect(openVacationDayCount(days, empMit({ clockodo: null }))).toBe(0);
  });
});

describe('Urlaubsantrag zurueckziehen: Tage eines Antrags (AUF-023)', () => {
  it('daysOfAbsence nimmt nur die Tage dieses Antrags in dieser Beschaeftigung', () => {
    const days = [
      tag(2026, 10, 5, { clockodoAbsence: { id: 55, status: 0, at: 1 } }),
      tag(2026, 10, 6, { clockodoAbsence: { id: 55, status: 0, at: 1 } }),
      tag(2026, 10, 6, { employmentId: 'emp-2', clockodoAbsence: { id: 55, status: 0, at: 1 } }),
      tag(2026, 10, 12, { clockodoAbsence: { id: 56, status: 1, at: 1 } }),
      tag(2026, 10, 14),
    ];
    expect(daysOfAbsence(days, 'emp-1', 55).map((d) => d.date)).toEqual([
      ab(2026, 10, 5),
      ab(2026, 10, 6),
    ]);
    expect(daysOfAbsence(days, 'emp-2', 55)).toEqual([days[2]]);
    expect(daysOfAbsence(days, 'emp-1', 99)).toEqual([]);
  });
});

describe('Urlaubsantraege bei festen Wochentagen (AUF-027)', () => {
  it('vacationRequestRanges: bei Montag bis Donnerstag trennt der freie Freitag nicht', () => {
    // 08.10.2026 ist ein Donnerstag, 12.10.2026 ein Montag.
    const days = [tag(2026, 10, 8), tag(2026, 10, 12)];
    expect(spannen(days, empMit({ workdaysPerWeek: 4, workWeekdays: [1, 2, 3, 4] }))).toEqual([
      ['2026-10-08', '2026-10-12'],
    ]);
    expect(spannen(days, empMit())).toEqual([
      ['2026-10-08', '2026-10-08'],
      ['2026-10-12', '2026-10-12'],
    ]);
  });
});
