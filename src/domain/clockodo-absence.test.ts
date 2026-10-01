import { describe, expect, it } from 'vitest';
import { vacationRequestRanges } from './clockodo-absence';
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
