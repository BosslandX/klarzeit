import { describe, it, expect } from 'vitest';
import {
  annualEntitlement,
  annualVacationDays,
  buildVacationStatus,
  defaultEmployment,
  fullMonthsEmployedInYear,
  mergeVacationDays,
  roundTeilurlaub,
  waitingFulfilledInYear,
  waitingPeriodEnd,
  workdaysInRange,
  workWeekdaysOf,
  cleanContractHistory,
  contractAt,
  cleanWorkWeekdays,
  displayedWorkWeekdays,
  toggleWorkWeekday,
  type Employment,
} from './employment';
import { buildBalanceLedger, monthSollMs } from './balance';
import type { TimeEntry } from './types';
import { HOUR, MINUTE } from './time';

// Beispielhafter Teilzeitvertrag als expliziter Fixture – unabhaengig von den
// (neutralen) App-Defaults, damit die Tests die Rechtslogik konkret pruefen:
// 20 Wochenstunden an 4 Arbeitstagen, Beginn 01.05.2026.
const emp: Employment = {
  id: 'emp-1',
  name: 'Test',
  arbeitgeber: '',
  personalnummer: '',
  abteilung: '',
  startDate: new Date(2026, 4, 1).getTime(), // 01.05.2026
  endDate: null,
  weeklyHours: 20,
  workdaysPerWeek: 4,
  vacationYearMode: 'both',
  openingBalanceMs: 0,
  contractVacationDays: null,
  includedOvertimeHoursPerMonth: null,
  balanceNote: '',
  clockodo: null,
};

/** Hilfs-Eintrag (lokale Zeiten). */
function entry(
  y: number,
  mo: number,
  d: number,
  fromH: number,
  toH: number,
  breakMinutes = 0,
): TimeEntry {
  const start = new Date(y, mo - 1, d, fromH, 0).getTime();
  const end = new Date(y, mo - 1, d, toH, 0).getTime();
  return {
    employmentId: 'emp-1',
    start,
    end,
    breakMinutes,
    activity: 'Test',
    note: '',
    source: 'manual',
    createdAt: start,
    updatedAt: start,
  };
}

describe('App-Defaults', () => {
  it('sind neutral – keine personenbezogenen Vertragswerte im Build', () => {
    expect(defaultEmployment.weeklyHours).toBe(0);
    expect(defaultEmployment.workdaysPerWeek).toBe(5);
    expect(defaultEmployment.endDate).toBeNull();
  });
});

describe('Urlaubsanspruch (BUrlG)', () => {
  it('Jahresanspruch = 4 x Arbeitstage/Woche', () => {
    expect(annualVacationDays(1)).toBe(4);
    expect(annualVacationDays(2)).toBe(8);
    expect(annualVacationDays(3)).toBe(12);
    expect(annualVacationDays(4)).toBe(16);
    expect(annualVacationDays(5)).toBe(20);
    expect(annualVacationDays(6)).toBe(24);
  });

  it('§ 5 Abs. 2: >= halber Tag aufrunden, Bruchteile < 1/2 bleiben erhalten', () => {
    expect(roundTeilurlaub(4.0)).toBe(4);
    expect(roundTeilurlaub(4.49)).toBeCloseTo(4.49, 5); // < 1/2: NICHT abrunden
    expect(roundTeilurlaub(4.5)).toBe(5);
    expect(roundTeilurlaub(4.6667)).toBe(5);
  });

  it('befristeter Austritt: 2. Jahreshaelfte voll, 1. Jahreshaelfte anteilig (§ 5 I lit. c)', () => {
    const exitH2: Employment = { ...emp, endDate: new Date(2027, 7, 31).getTime() }; // 31.08.2027
    const sH2 = buildVacationStatus(exitH2, [], 2027);
    expect(sH2.isEntryYear).toBe(false);
    expect(sH2.entitlement).toBe(16); // Ausscheiden 2. Jahreshaelfte -> voll

    const exitH1: Employment = { ...emp, endDate: new Date(2027, 5, 30).getTime() }; // 30.06.2027
    const sH1 = buildVacationStatus(exitH1, [], 2027);
    expect(sH1.fullMonths).toBe(6); // Jan–Jun
    expect(sH1.entitlement).toBe(8); // 16 x 6/12 = 8 -> anteilig
  });

  it('Jahr komplett ausserhalb der Beschaeftigung -> 0', () => {
    const ended: Employment = { ...emp, endDate: new Date(2026, 11, 31).getTime() };
    const s = buildVacationStatus(ended, [], 2028);
    expect(s.entitlement).toBe(0);
  });

  it('volle Monate im Eintrittsjahr 2026 = 8 (Mai–Dez)', () => {
    expect(fullMonthsEmployedInYear(emp, 2026)).toBe(8);
    expect(fullMonthsEmployedInYear(emp, 2027)).toBe(12);
    expect(fullMonthsEmployedInYear(emp, 2025)).toBe(0);
  });

  it('Wartezeit § 4 endet 01.11.2026 -> 2026 erfuellt', () => {
    expect(waitingPeriodEnd(emp)).toBe(new Date(2026, 10, 1).getTime());
    expect(waitingFulfilledInYear(emp, 2026)).toBe(true);
  });

  it('Eintrittsjahr 2026, mode "both": Hauptzahl 16, anteilig 11', () => {
    const s = buildVacationStatus(emp, [], 2026);
    expect(s.annualFull).toBe(16);
    expect(s.fullMonths).toBe(8);
    expect(s.prorataExact).toBeCloseTo(10.6667, 3);
    expect(s.prorataRounded).toBe(11); // § 5 II: 10,67 -> aufgerundet
    expect(s.waitingFulfilled).toBe(true);
    expect(s.isEntryYear).toBe(true);
    expect(s.entitlement).toBe(16); // voll, da Wartezeit erfuellt
    expect(s.remaining).toBe(16);
  });

  it('mode "prorata": Eintrittsjahr nur anteilig (11)', () => {
    const s = buildVacationStatus({ ...emp, vacationYearMode: 'prorata' }, [], 2026);
    expect(s.entitlement).toBe(11);
  });

  it('mode "full" aber Wartezeit nicht im Jahr erfuellt -> anteilig', () => {
    // Start 01.10.2026 -> Wartezeit endet 01.04.2027.
    const late: Employment = {
      ...emp,
      startDate: new Date(2026, 9, 1).getTime(),
      vacationYearMode: 'full',
    };
    expect(waitingFulfilledInYear(late, 2026)).toBe(false);
    const s = buildVacationStatus(late, [], 2026);
    expect(s.fullMonths).toBe(3); // Okt–Dez
    expect(s.entitlement).toBe(roundTeilurlaub((16 * 3) / 12)); // 4,0
    expect(s.entitlement).toBe(4);
  });

  it('genommene Urlaubstage werden je Jahr gezaehlt', () => {
    const taken = [
      new Date(2026, 6, 7).getTime(),
      new Date(2026, 7, 4).getTime(),
      new Date(2027, 0, 9).getTime(), // anderes Jahr
    ];
    const s = buildVacationStatus(emp, taken, 2026);
    expect(s.taken).toBe(2);
    expect(s.remaining).toBe(14); // 16 - 2
  });

  it('ein halber Urlaubstag zaehlt 0,5 (AUF-046)', () => {
    const taken = [new Date(2026, 6, 7).getTime(), new Date(2026, 7, 4).getTime()];
    const s = buildVacationStatus(emp, taken, 2026, [new Date(2026, 7, 4).getTime()]);
    expect(s.taken).toBe(1.5);
    expect(s.remaining).toBe(14.5); // 16 - 1,5
  });

  it('ein Datum nur in der halben Liste zaehlt nicht (AUF-046)', () => {
    const s = buildVacationStatus(emp, [new Date(2026, 6, 7).getTime()], 2026, [
      new Date(2026, 7, 4).getTime(),
    ]);
    expect(s.taken).toBe(1);
  });

  it('Folgejahr 2027: voller Jahresanspruch', () => {
    const s = buildVacationStatus(emp, [], 2027);
    expect(s.isEntryYear).toBe(false);
    expect(s.fullMonths).toBe(12);
    expect(s.entitlement).toBe(16);
  });
});

describe('annualEntitlement / Vertragsurlaub', () => {
  it('ohne Vertragswert: days 16, statutory 16, fromContract false', () => {
    const e = annualEntitlement(emp);
    expect(e.days).toBe(16);
    expect(e.statutory).toBe(16);
    expect(e.fromContract).toBe(false);
  });

  it('Vertragswert 26: days 26, statutory 16, fromContract true', () => {
    const e = annualEntitlement({ ...emp, contractVacationDays: 26 });
    expect(e.days).toBe(26);
    expect(e.statutory).toBe(16);
    expect(e.fromContract).toBe(true);
  });

  it('Vertragswert 12 unter Minimum: days 16, fromContract false', () => {
    const e = annualEntitlement({ ...emp, contractVacationDays: 12 });
    expect(e.days).toBe(16);
    expect(e.fromContract).toBe(false);
  });

  it('buildVacationStatus Folgejahr 2027, Vertrag 30, drei Tage: annualFull 30, annualStatutory 16, entitlement 30, remaining 27', () => {
    const withContract = { ...emp, contractVacationDays: 30 };
    const taken = [
      new Date(2027, 0, 5).getTime(),
      new Date(2027, 1, 10).getTime(),
      new Date(2027, 2, 15).getTime(),
    ];
    const s = buildVacationStatus(withContract, taken, 2027);
    expect(s.annualFull).toBe(30);
    expect(s.annualStatutory).toBe(16);
    expect(s.entitlement).toBe(30);
    expect(s.remaining).toBe(27);
  });

  it('Eintrittsjahr 2026 prorata, Vertrag 25: prorataExact ~16,6667, prorataRounded 17, entitlement 17', () => {
    const withContract = {
      ...emp,
      contractVacationDays: 25,
      vacationYearMode: 'prorata' as const,
    };
    const s = buildVacationStatus(withContract, [], 2026);
    expect(s.prorataExact).toBeCloseTo(16.6667, 3);
    expect(s.prorataRounded).toBe(17);
    expect(s.entitlement).toBe(17);
  });

  it('Austritt mit Vertrag 30: Ende 30.06.2027 entitlement 15; Ende 31.08.2027 entitlement 30', () => {
    const base = { ...emp, contractVacationDays: 30 };
    const exitH1 = { ...base, endDate: new Date(2027, 5, 30).getTime() };
    expect(buildVacationStatus(exitH1, [], 2027).entitlement).toBe(15);
    const exitH2 = { ...base, endDate: new Date(2027, 7, 31).getTime() };
    expect(buildVacationStatus(exitH2, [], 2027).entitlement).toBe(30);
  });
});

describe('Arbeitstage eines Zeitraums', () => {
  const d = (y: number, mo: number, dd: number) => new Date(y, mo - 1, dd).getTime();

  it('Mo-Fr bei 5 Arbeitstagen: Wochenende uebersprungen', () => {
    // 08.06.2026 = Mo, 19.06.2026 = Fr -> 2 volle Wochen ohne Sa/So
    const days = workdaysInRange(d(2026, 6, 8), d(2026, 6, 19), { workdaysPerWeek: 5 });
    expect(days).toHaveLength(10);
    expect(days[0]).toBe(d(2026, 6, 8));
    expect(days[days.length - 1]).toBe(d(2026, 6, 19));
    expect(days).not.toContain(d(2026, 6, 13)); // Samstag
    expect(days).not.toContain(d(2026, 6, 14)); // Sonntag
  });

  it('bei 6 Arbeitstagen zaehlt der Samstag mit, der Sonntag nie', () => {
    const days = workdaysInRange(d(2026, 6, 8), d(2026, 6, 19), { workdaysPerWeek: 6 });
    expect(days).toHaveLength(11); // 10 + Sa 13.06.
    expect(days).toContain(d(2026, 6, 13));
    expect(days).not.toContain(d(2026, 6, 14));
  });

  it('reines Wochenende ergibt bei 5 Arbeitstagen nichts', () => {
    expect(workdaysInRange(d(2026, 6, 13), d(2026, 6, 14), { workdaysPerWeek: 5 })).toEqual([]);
  });

  it('einzelner Tag: von = bis', () => {
    expect(workdaysInRange(d(2026, 6, 10), d(2026, 6, 10), { workdaysPerWeek: 5 })).toEqual([d(2026, 6, 10)]);
  });

  it('bis vor von ergibt eine leere Liste', () => {
    expect(workdaysInRange(d(2026, 6, 19), d(2026, 6, 8), { workdaysPerWeek: 5 })).toEqual([]);
  });

  it('Uhrzeiten in den Eingaben stoeren nicht (Normalisierung auf Mitternacht)', () => {
    const from = new Date(2026, 5, 8, 17, 45).getTime();
    const to = new Date(2026, 5, 9, 3, 10).getTime();
    expect(workdaysInRange(from, to, { workdaysPerWeek: 5 })).toEqual([d(2026, 6, 8), d(2026, 6, 9)]);
  });
});

describe('Urlaubslisten zusammenfuehren', () => {
  const v = (y: number, mo: number, dd: number, note = '') => ({
    employmentId: 'emp-1',
    date: new Date(y, mo - 1, dd).getTime(),
    note,
  });

  it('vereinigt beide Listen und sortiert aufsteigend', () => {
    const merged = mergeVacationDays([v(2026, 6, 10)], [v(2026, 6, 3)]);
    expect(merged.map((x) => x.date)).toEqual([
      v(2026, 6, 3).date,
      v(2026, 6, 10).date,
    ]);
  });

  it('bestehende Eintraege gehen nie verloren', () => {
    const existing = [v(2026, 6, 10), v(2026, 6, 11)];
    const merged = mergeVacationDays(existing, [v(2026, 6, 1)]);
    expect(merged).toHaveLength(3);
    for (const e of existing) {
      expect(merged.some((m) => m.date === e.date)).toBe(true);
    }
  });

  it('bei gleichem Datum gewinnt der bestehende Eintrag (Notiz bleibt)', () => {
    const merged = mergeVacationDays(
      [v(2026, 6, 10, 'meine Notiz')],
      [v(2026, 6, 10, 'aus dem Backup')],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].note).toBe('meine Notiz');
  });

  it('gleiches Datum in zwei Beschaeftigungen bleibt zweimal erhalten', () => {
    const merged = mergeVacationDays(
      [v(2026, 6, 10, 'meine Notiz')],
      [{ ...v(2026, 6, 10), employmentId: 'emp-2' }],
    );
    expect(merged).toHaveLength(2);
    expect(merged.map((x) => x.employmentId).sort()).toEqual(['emp-1', 'emp-2']);
  });
  it('leere Eingaben', () => {
    expect(mergeVacationDays([], [])).toEqual([]);
    expect(mergeVacationDays([], [v(2026, 6, 1)])).toHaveLength(1);
    expect(mergeVacationDays([v(2026, 6, 1)], [])).toHaveLength(1);
  });
});

describe('Auswertung getrennt je Beschaeftigung (AUF-007)', () => {
  const empA: Employment = {
    ...emp,
    id: 'emp-a',
    name: 'Job A',
    weeklyHours: 40,
    workdaysPerWeek: 5,
    startDate: new Date(2026, 0, 1).getTime(),
  };
  const empB: Employment = {
    ...emp,
    id: 'emp-b',
    name: 'Job B',
    weeklyHours: 40,
    workdaysPerWeek: 5,
    startDate: new Date(2026, 0, 1).getTime(),
  };

  function entryFor(
    employmentId: string,
    y: number,
    mo: number,
    d: number,
    fromH: number,
    toH: number,
  ): TimeEntry {
    const e = entry(y, mo, d, fromH, toH);
    return { ...e, employmentId };
  }

  const ref = new Date(2026, 4, 15).getTime();
  const entryA = entryFor('emp-a', 2026, 5, 5, 8, 16); // 8 h
  const entryB = entryFor('emp-b', 2026, 5, 6, 9, 13); // 4 h
  const istAAllein = 8 * HOUR;
  const istSummeBeider = 12 * HOUR;

  it('buildBalanceLedger mit gefilterten Eintraegen: Ist von A allein, nicht Summe beider', () => {
    const l = buildBalanceLedger(empA, [entryA], ref);
    expect(l!.target.istMs).toBe(istAAllein);
    expect(istSummeBeider).toBe(istAAllein + 4 * HOUR);
    const lBoth = buildBalanceLedger(empA, [entryA, entryB], ref);
    expect(lBoth!.target.istMs).toBe(istSummeBeider);
  });

  it('Urlaubstag bei A entlastet nur A Konto, nicht B', () => {
    const vacDay = new Date(2026, 4, 20).getTime();
    const lA = buildBalanceLedger(empA, [], ref, [vacDay]);
    const lB = buildBalanceLedger(empB, [], ref, []);
    expect(lA!.target.vacationDays).toBe(1);
    expect(lB!.target.vacationDays).toBe(0);
  });

  it('buildVacationStatus fuer B zaehlt nur B Urlaubstage', () => {
    const a1 = new Date(2026, 5, 2).getTime();
    const a2 = new Date(2026, 5, 3).getTime();
    const b1 = new Date(2026, 5, 10).getTime();
    const b2 = new Date(2026, 5, 11).getTime();
    const nurB = [b1, b2];
    const alle = [a1, a2, b1, b2];
    const statusB = buildVacationStatus(empB, nurB, 2026);
    const faelschlichAlle = buildVacationStatus(empB, alle, 2026);
    expect(statusB.taken).toBe(2);
    expect(faelschlichAlle.taken).toBe(4);
  });
});

describe('Arbeitstage als Wochentage (AUF-027)', () => {
  const d = (y: number, mo: number, dd: number) => new Date(y, mo - 1, dd).getTime();
  // 08.06.2026 ist ein Montag, 14.06.2026 ein Sonntag.
  const woche = (tage: number[]) =>
    workdaysInRange(d(2026, 6, 8), d(2026, 6, 14), {
      workdaysPerWeek: tage.length,
      workWeekdays: tage,
    });

  it('workWeekdaysOf: ohne Auswahl die bisherige Regel, mit Auswahl genau die Auswahl', () => {
    expect(workWeekdaysOf({ workdaysPerWeek: 5 })).toEqual([1, 2, 3, 4, 5]);
    expect(workWeekdaysOf({ workdaysPerWeek: 6 })).toEqual([1, 2, 3, 4, 5, 6]);
    expect(workWeekdaysOf({ workdaysPerWeek: 4 })).toEqual([1, 2, 3, 4, 5]);
    expect(workWeekdaysOf({ workdaysPerWeek: 4, workWeekdays: [1, 2, 3, 4] })).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it('workdaysInRange: Montag bis Donnerstag, der Freitag faellt heraus', () => {
    expect(woche([1, 2, 3, 4])).toEqual([
      d(2026, 6, 8),
      d(2026, 6, 9),
      d(2026, 6, 10),
      d(2026, 6, 11),
    ]);
  });

  it('workdaysInRange: Dienstag bis Samstag, ohne Montag, mit Samstag', () => {
    expect(woche([2, 3, 4, 5, 6])).toEqual([
      d(2026, 6, 9),
      d(2026, 6, 10),
      d(2026, 6, 11),
      d(2026, 6, 12),
      d(2026, 6, 13),
    ]);
  });

  it('workdaysInRange: ein gewaehlter Sonntag zaehlt', () => {
    expect(woche([0, 3, 4, 5, 6])).toEqual([
      d(2026, 6, 10),
      d(2026, 6, 11),
      d(2026, 6, 12),
      d(2026, 6, 13),
      d(2026, 6, 14),
    ]);
  });

  it('cleanWorkWeekdays: sortiert, ohne Doppelte, nur 1 bis 6 gueltige Tage', () => {
    expect(cleanWorkWeekdays([4, 1, 3, 2])).toEqual([1, 2, 3, 4]);
    expect(cleanWorkWeekdays([1, 1, 2])).toEqual([1, 2]);
    expect(cleanWorkWeekdays([0, 6])).toEqual([0, 6]);
    const kaputt: unknown[] = [
      [],
      [0, 1, 2, 3, 4, 5, 6],
      [1, 7],
      [-1],
      [1.5],
      ['1'],
      'Mo',
      null,
      undefined,
    ];
    for (const k of kaputt) {
      expect(cleanWorkWeekdays(k)).toBeUndefined();
    }
  });

  it('displayedWorkWeekdays: gewaehlte Tage; sonst bei 5 und 6 die bisherige Regel, bei 1 bis 4 keine', () => {
    expect(displayedWorkWeekdays({ workdaysPerWeek: 3, workWeekdays: [2, 4, 6] })).toEqual([
      2, 4, 6,
    ]);
    expect(displayedWorkWeekdays({ workdaysPerWeek: 5 })).toEqual([1, 2, 3, 4, 5]);
    expect(displayedWorkWeekdays({ workdaysPerWeek: 6 })).toEqual([1, 2, 3, 4, 5, 6]);
    expect(displayedWorkWeekdays({ workdaysPerWeek: 4 })).toEqual([]);
  });

  it('toggleWorkWeekday: an- und abwaehlen, der letzte Tag bleibt, hoechstens sechs', () => {
    expect(toggleWorkWeekday([1, 3], 2)).toEqual([1, 2, 3]);
    expect(toggleWorkWeekday([1, 2, 3], 2)).toEqual([1, 3]);
    expect(toggleWorkWeekday([], 0)).toEqual([0]);
    expect(toggleWorkWeekday([5], 5)).toBeNull();
    expect(toggleWorkWeekday([1, 2, 3, 4, 5, 6], 0)).toBeNull();
  });
});

describe('Feiertage im Konto und beim Urlaub (AUF-029)', () => {
  const d = (y: number, mo: number, dd: number) => new Date(y, mo - 1, dd).getTime();
  const bayern = { land: 'BY' as const, regional: [], extra: [], skip: [] };
  // 40 Stunden an Mo-Fr, 8 h Tagessoll; Mai 2026 in Bayern: 1. Mai (Fr), Christi
  // Himmelfahrt 14.05. (Do), Pfingstmontag 25.05. (Mo).
  const vollzeit: Employment = {
    ...emp,
    startDate: d(2026, 1, 1),
    weeklyHours: 40,
    workdaysPerWeek: 5,
    publicHolidays: bayern,
  };
  const MAI_SOLL = 10_400 * MINUTE; // 40 h x 52/12 = 173 h 20 min
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

  it('Feiertage an eigenen Arbeitstagen fuellen das Tagessoll auf', () => {
    const l = buildBalanceLedger(vollzeit, [], d(2026, 5, 15))!;
    expect(l.target.holidayDays).toBe(3);
    expect(l.target.holidayCreditMs).toBe(24 * HOUR);
    expect(l.target.saldoMs).toBe(24 * HOUR - MAI_SOLL);
  });

  it('nur an eigenen Arbeitstagen: bei Mo-Do zaehlt der 1. Mai (Fr) nicht', () => {
    const moDo: Employment = { ...vollzeit, weeklyHours: 28, workdaysPerWeek: 4, workWeekdays: [1, 2, 3, 4] };
    const l = buildBalanceLedger(moDo, [], d(2026, 5, 15))!;
    expect(l.target.holidayDays).toBe(2);
    expect(l.target.holidayCreditMs).toBe(14 * HOUR);
  });

  it('Arbeit am Feiertag zaehlt als Ist, gutgeschrieben wird nur der Rest', () => {
    const l = buildBalanceLedger(vollzeit, [eintrag(2026, 5, 14, 4)], d(2026, 5, 15))!;
    expect(l.target.istMs).toBe(4 * HOUR);
    expect(l.target.holidayCreditMs).toBe(20 * HOUR);
  });

  it('ein Urlaubstag am Feiertag zaehlt einmal, als Feiertag', () => {
    const l = buildBalanceLedger(vollzeit, [], d(2026, 5, 15), [d(2026, 5, 14), d(2026, 5, 15)])!;
    expect(l.target.vacationDays).toBe(1);
    expect(l.target.vacationCreditMs).toBe(8 * HOUR);
    expect(l.target.holidayDays).toBe(3);
    expect(l.target.holidayCreditMs).toBe(24 * HOUR);
  });

  it('ohne Feiertagseinstellung rechnet das Konto wie bisher', () => {
    const ohne: Employment = { ...vollzeit, publicHolidays: undefined };
    const l = buildBalanceLedger(ohne, [], d(2026, 5, 15))!;
    expect(l.target.holidayDays).toBe(0);
    expect(l.target.holidayCreditMs).toBe(0);
    expect(l.target.saldoMs).toBe(-MAI_SOLL);
  });

  it('Urlaub und Feiertage zusammen hoechstens das Monats-Soll', () => {
    // Dezember 2026: 23 Werktage Mo-Fr, Feiertag am 25.12. (Fr); Urlaub an allen anderen.
    const urlaub = workdaysInRange(d(2026, 12, 1), d(2026, 12, 31), vollzeit);
    expect(urlaub).toHaveLength(22);
    const l = buildBalanceLedger(vollzeit, [], d(2026, 12, 15), urlaub)!;
    expect(l.target.vacationCreditMs + l.target.holidayCreditMs).toBe(l.target.sollMs);
    expect(l.target.saldoMs).toBe(0);
  });

  it('workdaysInRange laesst Feiertage aus, ohne Einstellung nicht', () => {
    expect(workdaysInRange(d(2026, 5, 11), d(2026, 5, 17), vollzeit)).toEqual([
      d(2026, 5, 11),
      d(2026, 5, 12),
      d(2026, 5, 13),
      d(2026, 5, 15),
    ]);
    expect(workdaysInRange(d(2026, 5, 11), d(2026, 5, 17), { workdaysPerWeek: 5 })).toHaveLength(5);
  });

  it('buildVacationStatus: ein Urlaubstag am Feiertag ist nicht genommen', () => {
    expect(buildVacationStatus(vollzeit, [d(2026, 5, 14), d(2026, 5, 15)], 2026).taken).toBe(1);
    expect(
      buildVacationStatus({ ...vollzeit, publicHolidays: undefined }, [d(2026, 5, 14), d(2026, 5, 15)], 2026)
        .taken,
    ).toBe(2);
  });
});

describe('Vertrag gueltig ab (AUF-031)', () => {
  const d = (y: number, mo: number, dd: number) => new Date(y, mo - 1, dd).getTime();
  // Bis 31.03.2026: 20 h an Mo-Do (5 h/Tag); seit 01.04.2026: 30 h an Mo-Fr (6 h/Tag).
  const gewechselt: Employment = {
    ...emp,
    startDate: d(2026, 1, 1),
    weeklyHours: 30,
    workdaysPerWeek: 5,
    contractHistory: [
      { validUntil: d(2026, 3, 31), weeklyHours: 20, workdaysPerWeek: 4, workWeekdays: [1, 2, 3, 4] },
    ],
  };

  it('contractAt: bis einschliesslich validUntil der fruehere Stand, danach der heutige', () => {
    expect(contractAt(gewechselt, d(2026, 3, 31) + 20 * HOUR)).toEqual({
      weeklyHours: 20,
      workdaysPerWeek: 4,
      workWeekdays: [1, 2, 3, 4],
    });
    expect(contractAt(gewechselt, d(2026, 4, 1))).toEqual({ weeklyHours: 30, workdaysPerWeek: 5 });
    expect(contractAt({ ...gewechselt, contractHistory: undefined }, d(2026, 1, 5))).toEqual({
      weeklyHours: 30,
      workdaysPerWeek: 5,
    });
  });

  it('cleanContractHistory: Mitternacht, aufsteigend, je Tag einer, Ungueltiges faellt weg', () => {
    expect(
      cleanContractHistory([
        { validUntil: d(2026, 6, 30) + 5 * HOUR, weeklyHours: 25, workdaysPerWeek: 5 },
        { validUntil: d(2026, 3, 31), weeklyHours: 20, workdaysPerWeek: 5, workWeekdays: [1, 2, 3] },
        { validUntil: d(2026, 6, 30), weeklyHours: 28, workdaysPerWeek: 4 },
        { validUntil: d(2026, 1, 31), weeklyHours: 0, workdaysPerWeek: 5 },
        { validUntil: d(2026, 2, 28), weeklyHours: 10, workdaysPerWeek: 7 },
        { validUntil: 'x', weeklyHours: 10, workdaysPerWeek: 5 },
      ]),
    ).toEqual([
      { validUntil: d(2026, 3, 31), weeklyHours: 20, workdaysPerWeek: 3, workWeekdays: [1, 2, 3] },
      { validUntil: d(2026, 6, 30), weeklyHours: 28, workdaysPerWeek: 4 },
    ]);
    expect(cleanContractHistory([])).toBeUndefined();
    expect(cleanContractHistory('x')).toBeUndefined();
  });

  it('monthSollMs: jeder Monat mit dem Vertrag, der in ihm galt', () => {
    expect(monthSollMs(gewechselt, d(2026, 3, 15))).toBe(5_200 * MINUTE); // 20 h x 52/12
    expect(monthSollMs(gewechselt, d(2026, 4, 15))).toBe(7_800 * MINUTE); // 30 h x 52/12
  });

  it('monthSollMs: Wechsel mitten im Monat nach Kalendertagen', () => {
    const mitte: Employment = {
      ...gewechselt,
      contractHistory: [{ validUntil: d(2026, 4, 15), weeklyHours: 20, workdaysPerWeek: 5 }],
    };
    // April: 15 Tage zu 20 h, 15 Tage zu 30 h -> 25 h x 52/12 = 108 h 20 min.
    expect(monthSollMs(mitte, d(2026, 4, 15))).toBe(6_500 * MINUTE);
  });

  it('ohne fruehere Staende rechnet monthSollMs wie bisher', () => {
    const ohne: Employment = { ...gewechselt, contractHistory: undefined };
    expect(monthSollMs(ohne, d(2026, 3, 15))).toBe(7_800 * MINUTE);
  });

  it('Urlaubsgutschrift mit dem Tagessoll des Tages', () => {
    const l = buildBalanceLedger(gewechselt, [], d(2026, 4, 30), [d(2026, 3, 31), d(2026, 4, 1)])!;
    expect(l.months[2].vacationCreditMs).toBe(5 * HOUR);
    expect(l.target.vacationCreditMs).toBe(6 * HOUR);
  });

  it('Feiertage nur an den Arbeitstagen des Vertrags, der am Tag galt', () => {
    // Bayern: Karfreitag 03.04.2026 (Fr), Ostermontag 06.04.2026 (Mo).
    const bisApril: Employment = {
      ...gewechselt,
      publicHolidays: { land: 'BY', regional: [], extra: [], skip: [] },
      contractHistory: [
        { validUntil: d(2026, 4, 30), weeklyHours: 20, workdaysPerWeek: 4, workWeekdays: [1, 2, 3, 4] },
      ],
    };
    const l = buildBalanceLedger(bisApril, [], d(2026, 5, 31))!;
    expect(l.months[3].holidayDays).toBe(1);
    expect(l.target.holidayDays).toBe(3);
  });

  it('workdaysInRange: die Wochentage des Vertrags, der am Tag galt', () => {
    const bisApril: Employment = {
      ...gewechselt,
      contractHistory: [
        { validUntil: d(2026, 4, 30), weeklyHours: 20, workdaysPerWeek: 4, workWeekdays: [1, 2, 3, 4] },
      ],
    };
    // 20.04. (Mo) bis 03.05.2026 (So): bis 30.04. Mo-Do (der Freitag 24.04. faellt heraus),
    // Freitag 01.05. nach dem neuen Vertrag.
    expect(workdaysInRange(d(2026, 4, 20), d(2026, 5, 3), bisApril)).toEqual([
      d(2026, 4, 20),
      d(2026, 4, 21),
      d(2026, 4, 22),
      d(2026, 4, 23),
      d(2026, 4, 27),
      d(2026, 4, 28),
      d(2026, 4, 29),
      d(2026, 4, 30),
      d(2026, 5, 1),
    ]);
  });
});

describe('Resturlaub-Uebertrag (AUF-048)', () => {
  const t = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();
  const mit = (fromYear: number, startDays: number, lapsed: { year: number; days: number }[] = []) => ({
    ...emp,
    vacationCarry: { fromYear, startDays, lapsed },
  });

  it('ohne vacationCarry kein Uebertrag, der Rest wie bisher', () => {
    const s = buildVacationStatus(emp, [t(2027, 3, 2)], 2027);
    expect([s.carryIn, s.lapsed, s.remaining]).toEqual([null, 0, 15]);
  });

  it('im Startjahr gilt der eingetragene Rest', () => {
    const s = buildVacationStatus(mit(2027, 5), [], 2027);
    expect([s.carryIn, s.remaining]).toEqual([5, 21]); // 16 + 5
  });

  it('vor dem Startjahr kein Uebertrag', () => {
    expect(buildVacationStatus(mit(2027, 5), [], 2026).carryIn).toBeNull();
  });

  it('im Folgejahr geht der Rest des Vorjahres ueber', () => {
    const taken = [t(2027, 3, 2), t(2027, 3, 3), t(2027, 3, 4)];
    const s = buildVacationStatus(mit(2027, 5), taken, 2028);
    expect([s.carryIn, s.remaining]).toEqual([18, 34]); // 16 + 5 - 3; dann 16 + 18
  });

  it('ein Minus geht nicht ueber (E24, §§ 1, 3 Abs. 1 BUrlG)', () => {
    const taken = Array.from({ length: 18 }, (_, i) => t(2027, 6, 1) + i * 86_400_000);
    expect(buildVacationStatus(mit(2027, 0), taken, 2027).remaining).toBe(-2);
    expect(buildVacationStatus(mit(2027, 0), taken, 2028).carryIn).toBe(0);
  });

  it('verfallene Tage mindern den Rest ihres Jahres', () => {
    const s = buildVacationStatus(mit(2027, 5, [{ year: 2028, days: 4 }]), [], 2028);
    expect([s.carryIn, s.lapsed, s.remaining]).toEqual([21, 4, 33]); // 16 + 21 - 4
  });

  it('halbe Tage zaehlen im Uebertrag 0,5', () => {
    const s = buildVacationStatus(mit(2027, 0), [t(2027, 3, 2)], 2028, [t(2027, 3, 2)]);
    expect(s.carryIn).toBe(15.5);
  });
});
