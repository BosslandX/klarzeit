import { describe, expect, it } from 'vitest';
import {
  absenceStatusLabel,
  applyAbsenceRef,
  daysOfAbsence,
  isSickInClockodoVacation,
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
import type { SickPeriod } from './sickness';

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

describe('Urlaubsantraege ueber einen Feiertag (AUF-029)', () => {
  it('vacationRequestRanges: Himmelfahrt dazwischen trennt nicht', () => {
    // 13.05.2026 Mittwoch, 14.05. Christi Himmelfahrt (Bayern), 15.05. Freitag.
    const days = [tag(2026, 5, 13), tag(2026, 5, 15)];
    const bayern = { land: 'BY' as const, regional: [], extra: [], skip: [] };
    expect(spannen(days, empMit({ publicHolidays: bayern }))).toEqual([
      ['2026-05-13', '2026-05-15'],
    ]);
    expect(spannen(days, empMit())).toEqual([
      ['2026-05-13', '2026-05-13'],
      ['2026-05-15', '2026-05-15'],
    ]);
  });
});

describe('Urlaubsantraege und Krankheit (AUF-038)', () => {
  // 05.10.2026 ist ein Montag, 09.10.2026 ein Freitag.
  const woche = () => [5, 6, 7, 8, 9].map((d) => tag(2026, 10, d));
  const krank = (
    von: number,
    bis: number,
    certificate: boolean,
    employmentId = 'emp-1',
  ): SickPeriod => ({
    employmentId,
    from: ab(2026, 10, von),
    to: ab(2026, 10, bis),
    certificate,
  });
  const spannenK = (periods: SickPeriod[]) =>
    vacationRequestRanges(woche(), empMit(), periods).map((r) => [r.dateSince, r.dateUntil]);
  const antrag = (status: 0 | 1 | 2 | 3 | 4) =>
    tag(2026, 10, 7, { clockodoAbsence: { id: 9, status, at: 1 } });

  it('vacationRequestRanges: Krankheit mit Bescheinigung wird nicht beantragt, ohne schon', () => {
    expect(spannenK([krank(7, 7, true)])).toEqual([
      ['2026-10-05', '2026-10-06'],
      ['2026-10-08', '2026-10-09'],
    ]);
    expect(spannenK([krank(7, 7, false)])).toEqual([['2026-10-05', '2026-10-09']]);
    expect(spannenK([krank(5, 9, true)])).toEqual([]);
  });

  it('vacationRequestRanges: Krankheit einer anderen Beschaeftigung zaehlt nicht', () => {
    expect(spannenK([krank(7, 7, true, 'emp-2'), krank(8, 8, true)])).toEqual([
      ['2026-10-05', '2026-10-07'],
      ['2026-10-09', '2026-10-09'],
    ]);
  });

  it('openVacationDayCount zaehlt Krankheitstage mit Bescheinigung nicht mit', () => {
    expect(openVacationDayCount(woche(), empMit(), [krank(7, 8, true)])).toBe(3);
    expect(openVacationDayCount(woche(), empMit(), [krank(7, 8, false)])).toBe(5);
  });

  it('isSickInClockodoVacation: nur beantragte und genehmigte Tage', () => {
    const k = [krank(7, 7, true)];
    expect([0, 1, 2, 3, 4].map((status) =>
      isSickInClockodoVacation(antrag(status as 0 | 1 | 2 | 3 | 4), k),
    )).toEqual([true, true, false, false, false]);
  });

  it('isSickInClockodoVacation: nur mit Bescheinigung, am Tag, in der Beschaeftigung', () => {
    expect(isSickInClockodoVacation(tag(2026, 10, 7), [krank(7, 7, true)])).toBe(false);
    expect(isSickInClockodoVacation(antrag(1), [krank(7, 7, false)])).toBe(false);
    expect(isSickInClockodoVacation(antrag(1), [krank(8, 9, true)])).toBe(false);
    expect(isSickInClockodoVacation(antrag(1), [krank(7, 7, true, 'emp-2')])).toBe(false);
  });
});

describe('Halbe Urlaubstage an Clockodo (AUF-047)', () => {
  it('vacationRequestRanges: ein halber Tag ist ein eigener Zeitraum mit halfDay', () => {
    const days = [tag(2026, 11, 3), tag(2026, 11, 4, { halfDay: true }), tag(2026, 11, 5)];
    expect(vacationRequestRanges(days, empMit())).toEqual([
      { dateSince: '2026-11-03', dateUntil: '2026-11-03', dates: [ab(2026, 11, 3)] },
      { dateSince: '2026-11-04', dateUntil: '2026-11-04', dates: [ab(2026, 11, 4)], halfDay: true },
      { dateSince: '2026-11-05', dateUntil: '2026-11-05', dates: [ab(2026, 11, 5)] },
    ]);
  });

  it('vacationRequestRanges: zwei halbe Tage hintereinander bleiben zwei Antraege', () => {
    const days = [tag(2026, 11, 4, { halfDay: true }), tag(2026, 11, 5, { halfDay: true })];
    expect(vacationRequestRanges(days, empMit()).map((r) => [r.dateSince, r.halfDay])).toEqual([
      ['2026-11-04', true],
      ['2026-11-05', true],
    ]);
  });

  it('vacationRequestRanges: ganze Tage tragen kein halfDay', () => {
    const r = vacationRequestRanges([3, 4, 5].map((d) => tag(2026, 11, d)), empMit());
    expect(r).toHaveLength(1);
    expect('halfDay' in r[0]).toBe(false);
  });
});
