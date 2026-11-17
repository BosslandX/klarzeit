import { describe, expect, it } from 'vitest';
import {
  cleanSickPeriods,
  ENTGELTFORTZAHLUNG_TAGE,
  longSickRuns,
  mergeSickPeriods,
  splitVacationAndSickness,
  type SickPeriod,
} from './sickness';
import {
  buildBalanceLedger,
  buildVacationStatus,
  defaultEmployment,
  workdaysInRange,
  type Employment,
} from './employment';
import type { TimeEntry } from './types';
import { HOUR, MINUTE } from './time';

const d = (y: number, mo: number, dd: number) => new Date(y, mo - 1, dd).getTime();
const p = (from: number, to: number, certificate = true, employmentId = 'emp-1'): SickPeriod => ({
  employmentId,
  from,
  to,
  certificate,
});
// 40 Stunden an Mo-Fr, 8 h Tagessoll, Feiertage in Bayern.
const vollzeit: Employment = {
  ...defaultEmployment,
  startDate: d(2026, 1, 1),
  weeklyHours: 40,
  workdaysPerWeek: 5,
  publicHolidays: { land: 'BY', regional: [], extra: [], skip: [] },
};
const eintrag = (y: number, mo: number, dd: number, h: number): TimeEntry => ({
  employmentId: 'emp-1',
  start: new Date(y, mo - 1, dd, 8).getTime(),
  end: new Date(y, mo - 1, dd, 8 + h).getTime(),
  breakMinutes: 0,
  activity: '',
  note: '',
  source: 'manual',
  createdAt: 0,
  updatedAt: 0,
});

describe('Krankheit (AUF-033)', () => {
  it('cleanSickPeriods: prueft, setzt auf Mitternacht, sortiert und laesst Ueberschneidungen fallen', () => {
    expect(
      cleanSickPeriods([
        { employmentId: 'emp-1', from: d(2026, 3, 10) + 5 * HOUR, to: d(2026, 3, 12) + 23 * HOUR, certificate: true },
        { employmentId: 'emp-1', from: d(2026, 3, 2), to: d(2026, 3, 3) },
        { employmentId: 'emp-1', from: d(2026, 3, 11), to: d(2026, 3, 20), certificate: true },
        { employmentId: 'emp-2', from: d(2026, 3, 11), to: d(2026, 3, 11), certificate: 'ja' },
        { employmentId: 'emp-1', from: d(2026, 4, 2), to: d(2026, 4, 1) },
        { employmentId: '', from: d(2026, 4, 2), to: d(2026, 4, 2) },
        { employmentId: 'emp-1', from: Number.NaN, to: d(2026, 4, 2) },
        'kaputt',
      ]),
    ).toEqual([
      p(d(2026, 3, 2), d(2026, 3, 3), false),
      p(d(2026, 3, 10), d(2026, 3, 12)),
      p(d(2026, 3, 11), d(2026, 3, 11), false, 'emp-2'),
    ]);
    expect(cleanSickPeriods({})).toEqual([]);
  });

  it('mergeSickPeriods: ein eingehender Zeitraum, der einen lokalen ueberschneidet, entfaellt', () => {
    const lokal = [p(d(2026, 3, 10), d(2026, 3, 12))];
    expect(
      mergeSickPeriods(lokal, [
        p(d(2026, 3, 8), d(2026, 3, 10), false),
        p(d(2026, 3, 13), d(2026, 3, 14)),
        p(d(2026, 3, 10), d(2026, 3, 12), true, 'emp-2'),
      ]),
    ).toEqual([
      lokal[0],
      p(d(2026, 3, 10), d(2026, 3, 12), true, 'emp-2'),
      p(d(2026, 3, 13), d(2026, 3, 14)),
    ]);
  });

  it('splitVacationAndSickness: mit Bescheinigung Krankheit statt Urlaub, ohne bleibt es Urlaub', () => {
    const urlaub = [d(2026, 6, 1), d(2026, 6, 2), d(2026, 6, 3), d(2026, 6, 8)];
    const krank = [
      p(d(2026, 6, 2), d(2026, 6, 3)),
      p(d(2026, 6, 8), d(2026, 6, 9), false),
      p(d(2026, 6, 1), d(2026, 6, 1), true, 'emp-2'),
    ];
    expect(splitVacationAndSickness(urlaub, krank, 'emp-1')).toEqual({
      vacationDates: [d(2026, 6, 1), d(2026, 6, 8)],
      sickDates: [d(2026, 6, 2), d(2026, 6, 3), d(2026, 6, 9)],
    });
  });

  it('longSickRuns: aneinandergrenzende Zeitraeume zaehlen zusammen, ueber sechs Wochen wird gemeldet', () => {
    expect(ENTGELTFORTZAHLUNG_TAGE).toBe(42);
    const erst = p(d(2026, 1, 5), d(2026, 1, 31)); // 27 Tage
    const folge = p(d(2026, 2, 1), d(2026, 2, 16), false); // 16 Tage, zusammen 43
    expect(longSickRuns([folge, erst], 'emp-1')).toEqual([
      { from: d(2026, 1, 5), to: d(2026, 2, 16), days: 43 },
    ]);
    expect(longSickRuns([erst, p(d(2026, 2, 2), d(2026, 2, 17))], 'emp-1')).toEqual([]);
    expect(longSickRuns([p(d(2026, 1, 1), d(2026, 2, 11))], 'emp-1')).toEqual([]); // genau 42
    expect(longSickRuns([erst, folge], 'emp-2')).toEqual([]);
  });

  it('Konto: Krankheitstage an eigenen Arbeitstagen fuellen das Tagessoll auf, erfasste Zeit zaehlt mit', () => {
    const NOV_SOLL = 10_400 * MINUTE; // 40 h x 52/12 = 173 h 20 min
    // Mo 09.11. bis So 15.11.2026: fuenf Arbeitstage und ein Wochenende.
    const { sickDates } = splitVacationAndSickness([], [p(d(2026, 11, 9), d(2026, 11, 15))], 'emp-1');
    expect(sickDates).toHaveLength(7);
    const vormittag = eintrag(2026, 11, 10, 3);
    const l = buildBalanceLedger(vollzeit, [vormittag], d(2026, 11, 20), [], sickDates)!;
    expect(l.target.sickDays).toBe(5);
    expect(l.target.sickCreditMs).toBe(37 * HOUR);
    expect(l.target.saldoMs).toBe(40 * HOUR - NOV_SOLL);
    const ohne = buildBalanceLedger(vollzeit, [vormittag], d(2026, 11, 20))!;
    expect(ohne.target.sickDays).toBe(0);
    expect(ohne.target.sickCreditMs).toBe(0);
    expect(ohne.target.saldoMs).toBe(3 * HOUR - NOV_SOLL);
  });

  it('Konto: Feiertag und Urlaub gehen vor, alles zusammen hoechstens das Soll', () => {
    // Dezember 2026 in Bayern: 25.12. (Fr) Feiertag, der 26.12. ist ein Samstag.
    const weihnachten = buildBalanceLedger(vollzeit, [], d(2026, 12, 15), [], [
      d(2026, 12, 24),
      d(2026, 12, 25),
      d(2026, 12, 26),
    ])!;
    expect(weihnachten.target.sickDays).toBe(1);
    expect(weihnachten.target.holidayDays).toBe(1);
    // Urlaub am 07.12., krank ohne Bescheinigung am 07. und 08.12.: auch ungetrennt kein Tag doppelt.
    const doppelt = buildBalanceLedger(vollzeit, [], d(2026, 12, 15), [d(2026, 12, 7)], [
      d(2026, 12, 7),
      d(2026, 12, 8),
    ])!;
    expect(doppelt.target.vacationDays).toBe(1);
    expect(doppelt.target.sickDays).toBe(1);
    expect(doppelt.target.vacationCreditMs + doppelt.target.sickCreditMs).toBe(16 * HOUR);
    // Urlaub an allen Arbeitstagen ausser dem Feiertag, ab dem 28.12. krank mit Bescheinigung.
    const urlaub = workdaysInRange(d(2026, 12, 1), d(2026, 12, 31), vollzeit);
    expect(urlaub).toHaveLength(22);
    const teil = splitVacationAndSickness(urlaub, [p(d(2026, 12, 28), d(2026, 12, 31))], 'emp-1');
    const l = buildBalanceLedger(vollzeit, [], d(2026, 12, 15), teil.vacationDates, teil.sickDates)!;
    expect(l.target.vacationDays).toBe(18);
    expect(l.target.sickDays).toBe(4);
    expect(l.target.sickCreditMs).toBe(1280 * MINUTE);
    expect(l.target.vacationCreditMs + l.target.holidayCreditMs + l.target.sickCreditMs).toBe(
      l.target.sollMs,
    );
    expect(l.target.saldoMs).toBe(0);
  });

  it('Urlaubsstand: ein Urlaubstag mit Bescheinigung krank zaehlt nicht als genommen (§ 9 BUrlG)', () => {
    const urlaub = workdaysInRange(d(2026, 6, 8), d(2026, 6, 12), vollzeit);
    expect(urlaub).toHaveLength(5);
    const mit = splitVacationAndSickness(urlaub, [p(d(2026, 6, 10), d(2026, 6, 11))], 'emp-1');
    expect(buildVacationStatus(vollzeit, mit.vacationDates, 2026).taken).toBe(3);
    const ohne = splitVacationAndSickness(urlaub, [p(d(2026, 6, 10), d(2026, 6, 11), false)], 'emp-1');
    expect(buildVacationStatus(vollzeit, ohne.vacationDates, 2026).taken).toBe(5);
  });
});
