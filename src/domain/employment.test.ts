import { describe, it, expect } from 'vitest';
import {
  annualEntitlement,
  annualVacationDays,
  buildBalanceLedger,
  buildVacationStatus,
  dailyTargetMs,
  defaultEmployment,
  fullMonthlyTargetMs,
  fullMonthsEmployedInYear,
  mergeVacationDays,
  monthSollMs,
  includedOvertimeCapMs,
  roundTeilurlaub,
  waitingFulfilledInYear,
  waitingPeriodEnd,
  workdaysInRange,
  workWeekdaysOf,
  cleanWorkWeekdays,
  displayedWorkWeekdays,
  toggleWorkWeekday,
  type Employment,
} from './employment';
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

/** Volles Monats-Soll des Fixtures: 20 h x 52/12 = 86 h 40 min, minutengerundet. */
const SOLL = 312_000_000;

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

describe('Monats-Soll', () => {
  it('volles Monats-Soll = 20 h x 52/12 = 86,67 h', () => {
    // Bewusst toBeCloseTo: 20 * (52/12) * 3_600_000 ist in IEEE-754 nicht exakt
    // darstellbar (311_999_999.99999994). Erst monthSollMs rundet auf Minuten.
    expect(fullMonthlyTargetMs(20)).toBeCloseTo(SOLL, 0); // 86 h 40 min
    expect(fullMonthlyTargetMs(20) / HOUR).toBeCloseTo(86.6667, 3);
  });

  it('voller Monat (Mai 2026) -> volles Soll', () => {
    expect(monthSollMs(emp, new Date(2026, 4, 15).getTime())).toBe(SOLL);
  });

  it('Monat vor Beschaeftigungsbeginn -> 0', () => {
    expect(monthSollMs(emp, new Date(2026, 3, 15).getTime())).toBe(0);
  });

  it('Eintrittsmonat anteilig nach Kalendertagen', () => {
    // Start 16.09. -> 15 von 30 Tagen -> halbes Soll.
    const mid: Employment = { ...emp, startDate: new Date(2026, 8, 16).getTime() };
    expect(monthSollMs(mid, new Date(2026, 8, 1).getTime())).toBeCloseTo(
      SOLL / 2,
      0,
    );
  });

  it('Monats-Soll ist auf volle Minuten gerundet', () => {
    expect(monthSollMs(emp, new Date(2026, 4, 1).getTime()) % MINUTE).toBe(0);
    const mid: Employment = { ...emp, startDate: new Date(2026, 4, 16).getTime() };
    expect(monthSollMs(mid, new Date(2026, 4, 1).getTime()) % MINUTE).toBe(0);
  });
});

describe('Saldo-Fortschreibung', () => {
  it('Mai: Ist - Soll, Uebertrag 0', () => {
    const entries = [entry(2026, 5, 5, 8, 12), entry(2026, 5, 12, 8, 11)]; // 4 h + 3 h = 7 h
    const ledger = buildBalanceLedger(emp, entries, new Date(2026, 4, 28).getTime());
    expect(ledger).not.toBeNull();
    expect(ledger!.months).toHaveLength(1);
    expect(ledger!.target.istMs).toBe(7 * HOUR);
    expect(ledger!.target.sollMs).toBe(SOLL);
    expect(ledger!.target.saldoMs).toBe(7 * HOUR - SOLL);
    expect(ledger!.carryIn).toBe(0);
    expect(ledger!.closing).toBe(7 * HOUR - SOLL);
  });

  it('Juni: Uebertrag aus Mai wird fortgeschrieben', () => {
    const entries = [entry(2026, 5, 5, 8, 12)]; // nur 4 h im Mai, Juni leer
    const ledger = buildBalanceLedger(emp, entries, new Date(2026, 5, 10).getTime());
    expect(ledger!.months).toHaveLength(2);
    const maiSaldo = 4 * HOUR - SOLL;
    expect(ledger!.carryIn).toBe(maiSaldo); // Uebertrag vor Juni = Mai-Saldo
    expect(ledger!.target.label).toContain('Juni');
    expect(ledger!.target.saldoMs).toBe(0 - SOLL); // Juni leer
    expect(ledger!.closing).toBe(maiSaldo - SOLL);
  });

  it('Ist wird auf das Beschaeftigungsfenster geklammert (Eintrag vor Beginn ignoriert)', () => {
    const midStart: Employment = { ...emp, startDate: new Date(2026, 4, 16).getTime() };
    const before = entry(2026, 5, 5, 8, 12); // 05.05 liegt VOR Beginn 16.05.
    const after = entry(2026, 5, 20, 8, 11); // 20.05, 3 h
    const ledger = buildBalanceLedger(midStart, [before, after], new Date(2026, 4, 28).getTime());
    expect(ledger!.target.istMs).toBe(3 * HOUR); // nur 'after' zaehlt
  });

  it('Anfangssaldo fliesst in den Uebertrag ein', () => {
    const withOpening: Employment = { ...emp, openingBalanceMs: 5 * HOUR };
    const ledger = buildBalanceLedger(withOpening, [], new Date(2026, 4, 20).getTime());
    expect(ledger!.opening).toBe(5 * HOUR);
    expect(ledger!.carryIn).toBe(5 * HOUR);
    expect(ledger!.closing).toBe(5 * HOUR - SOLL);
  });

  it('Zielmonat vor Beginn -> null', () => {
    expect(buildBalanceLedger(emp, [], new Date(2026, 3, 1).getTime())).toBeNull();
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

describe('Tagessoll', () => {
  it('Wochenstunden / Arbeitstage', () => {
    expect(dailyTargetMs(emp)).toBe(5 * HOUR); // 20 h / 4 Tage
    expect(dailyTargetMs({ ...emp, weeklyHours: 40, workdaysPerWeek: 5 })).toBe(8 * HOUR);
  });

  it('0 Arbeitstage waere eine Division durch null -> 0', () => {
    expect(dailyTargetMs({ ...emp, workdaysPerWeek: 0 })).toBe(0);
  });
});

describe('Urlaubsgutschrift im Arbeitszeitkonto', () => {
  const vac = (y: number, mo: number, d: number) => new Date(y, mo - 1, d).getTime();

  it('ohne Urlaubstage bleibt der Saldo unveraendert (Rueckwaertskompatibilitaet)', () => {
    const entries = [entry(2026, 5, 5, 8, 12)]; // 4 h
    const a = buildBalanceLedger(emp, entries, new Date(2026, 4, 28).getTime());
    const b = buildBalanceLedger(emp, entries, new Date(2026, 4, 28).getTime(), []);
    expect(a!.target.saldoMs).toBe(4 * HOUR - SOLL);
    expect(b!.target.saldoMs).toBe(a!.target.saldoMs);
    expect(b!.target.vacationDays).toBe(0);
    expect(b!.target.vacationCreditMs).toBe(0);
  });

  it('ein Urlaubstag schreibt ein Tagessoll gut', () => {
    const entries = [entry(2026, 5, 5, 8, 12)]; // 4 h
    const ledger = buildBalanceLedger(
      emp,
      entries,
      new Date(2026, 4, 28).getTime(),
      [vac(2026, 5, 6)],
    );
    expect(ledger!.target.vacationDays).toBe(1);
    expect(ledger!.target.vacationCreditMs).toBe(5 * HOUR);
    // Soll bleibt brutto stehen, die Gutschrift geht in den Saldo ein.
    expect(ledger!.target.sollMs).toBe(SOLL);
    expect(ledger!.target.istMs).toBe(4 * HOUR);
    expect(ledger!.target.saldoMs).toBe(4 * HOUR + 5 * HOUR - SOLL);
  });

  it('Urlaubstag vor Beschaeftigungsbeginn wird nicht gutgeschrieben', () => {
    const midStart: Employment = { ...emp, startDate: new Date(2026, 4, 16).getTime() };
    const ledger = buildBalanceLedger(midStart, [], new Date(2026, 4, 28).getTime(), [
      vac(2026, 5, 5), // vor Beginn
      vac(2026, 5, 20), // nach Beginn
    ]);
    expect(ledger!.target.vacationDays).toBe(1);
  });

  it('Urlaubstag nach befristetem Ende wird nicht gutgeschrieben', () => {
    const ends: Employment = { ...emp, endDate: new Date(2026, 4, 15).getTime() };
    const ledger = buildBalanceLedger(ends, [], new Date(2026, 4, 28).getTime(), [
      vac(2026, 5, 11), // vor Ende
      vac(2026, 5, 20), // nach Ende
    ]);
    expect(ledger!.target.vacationDays).toBe(1);
  });

  it('Gutschrift eines Vormonats wandert in den Uebertrag', () => {
    const ledger = buildBalanceLedger(emp, [], new Date(2026, 5, 10).getTime(), [
      vac(2026, 5, 6), // Mai
    ]);
    expect(ledger!.months).toHaveLength(2);
    expect(ledger!.carryIn).toBe(5 * HOUR - SOLL); // Mai: nur die Gutschrift
    expect(ledger!.target.vacationDays).toBe(0); // Juni ohne Urlaub
    expect(ledger!.closing).toBe(5 * HOUR - SOLL - SOLL);
  });

  it('Urlaubstage anderer Monate zaehlen nicht in den Zielmonat', () => {
    const ledger = buildBalanceLedger(emp, [], new Date(2026, 5, 10).getTime(), [
      vac(2026, 5, 6), // Mai
      vac(2026, 6, 8), // Juni
    ]);
    expect(ledger!.target.vacationDays).toBe(1); // nur der Juni-Tag
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

describe('Urlaubsgutschrift trifft auf bereits erfasste Zeit (Doppelzaehlung)', () => {
  const vac = (y: number, mo: number, d: number) => new Date(y, mo - 1, d).getTime();
  const ref = new Date(2026, 4, 28).getTime();

  it('Urlaubstag ohne Erfassung: volle Gutschrift', () => {
    const l = buildBalanceLedger(emp, [], ref, [vac(2026, 5, 6)]);
    expect(l!.target.vacationCreditMs).toBe(5 * HOUR);
  });

  it('Urlaubstag mit bereits erfasstem vollen Tag: KEINE zusaetzliche Gutschrift', () => {
    // Wer den Urlaubstag frueher als manuellen Eintrag "Urlaub" nachgetragen hat,
    // darf ihn nicht zusaetzlich gutgeschrieben bekommen.
    const entries = [entry(2026, 5, 6, 8, 13)]; // 5 h am Urlaubstag
    const l = buildBalanceLedger(emp, entries, ref, [vac(2026, 5, 6)]);
    expect(l!.target.istMs).toBe(5 * HOUR);
    expect(l!.target.vacationCreditMs).toBe(0);
    expect(l!.target.saldoMs).toBe(5 * HOUR - SOLL); // genau wie ohne Urlaubsliste
  });

  it('Urlaubstag mit halb erfasstem Tag: nur die Differenz wird gutgeschrieben', () => {
    const entries = [entry(2026, 5, 6, 8, 10)]; // 2 h am Urlaubstag
    const l = buildBalanceLedger(emp, entries, ref, [vac(2026, 5, 6)]);
    expect(l!.target.vacationCreditMs).toBe(3 * HOUR); // 5 h Tagessoll - 2 h
    expect(l!.target.saldoMs).toBe(2 * HOUR + 3 * HOUR - SOLL);
  });

  it('mehr erfasst als Tagessoll: Gutschrift 0, die Mehrarbeit bleibt erhalten', () => {
    const entries = [entry(2026, 5, 6, 8, 16)]; // 8 h am Urlaubstag
    const l = buildBalanceLedger(emp, entries, ref, [vac(2026, 5, 6)]);
    expect(l!.target.vacationCreditMs).toBe(0);
    expect(l!.target.saldoMs).toBe(8 * HOUR - SOLL);
  });

  it('Erfassung an einem ANDEREN Tag mindert die Gutschrift nicht', () => {
    const entries = [entry(2026, 5, 7, 8, 13)]; // 5 h, aber am 07., Urlaub am 06.
    const l = buildBalanceLedger(emp, entries, ref, [vac(2026, 5, 6)]);
    expect(l!.target.vacationCreditMs).toBe(5 * HOUR);
    expect(l!.target.saldoMs).toBe(5 * HOUR + 5 * HOUR - SOLL);
  });

  it('mehrere Eintraege am selben Urlaubstag werden zusammengezaehlt', () => {
    const entries = [entry(2026, 5, 6, 8, 10), entry(2026, 5, 6, 13, 15)]; // 2 h + 2 h
    const l = buildBalanceLedger(emp, entries, ref, [vac(2026, 5, 6)]);
    expect(l!.target.vacationCreditMs).toBe(1 * HOUR); // 5 h - 4 h
  });
});

describe('Deckel der Urlaubsgutschrift', () => {
  const vac = (y: number, mo: number, d: number) => new Date(y, mo - 1, d).getTime();
  const ref = new Date(2026, 4, 28).getTime();

  it('Arbeit an urlaubsfreien Tagen wird durch den Urlaub NICHT entwertet', () => {
    // 12 urlaubsfreie Tage a 7 h = 84 h Ist, dazu 4 Urlaubstage (je 5 h Soll).
    // Der Urlaub nimmt 20 h Arbeitspflicht weg, es verbleiben 66:40 Soll —
    // die 84 h ergeben also echte Ueberstunden. Wuerde die Gutschrift gegen das
    // Monats-Ist statt nur gegen das Tages-Ist verrechnet, stuende hier 0:00.
    const entries = Array.from({ length: 12 }, (_, i) => entry(2026, 5, i + 1, 8, 15));
    const urlaub = [25, 26, 27, 28].map((d) => vac(2026, 5, d));
    const l = buildBalanceLedger(emp, entries, ref, urlaub);
    expect(l!.target.istMs).toBe(84 * HOUR);
    expect(l!.target.vacationCreditMs).toBe(20 * HOUR);
    expect(l!.target.saldoMs).toBe(84 * HOUR + 20 * HOUR - SOLL); // +17:20
  });

  it('Ueberstundenmonat: der Urlaubstag entlastet zusaetzlich', () => {
    // 100 h Ist an urlaubsfreien Tagen, 1 Urlaubstag. Der Tag mindert den
    // Resturlaub — dann muss er auch das Konto entlasten, sonst ist er im
    // Arbeitszeitkonto wertlos.
    const entries = Array.from({ length: 20 }, (_, i) => entry(2026, 5, i + 2, 8, 13));
    const l = buildBalanceLedger(emp, entries, ref, [vac(2026, 5, 25)]);
    expect(l!.target.istMs).toBe(100 * HOUR);
    expect(l!.target.vacationDays).toBe(1);
    expect(l!.target.vacationCreditMs).toBe(5 * HOUR);
    expect(l!.target.saldoMs).toBe(100 * HOUR + 5 * HOUR - SOLL); // +18:20
  });

  it('reiner Urlaub erzeugt keine Ueberstunden (Deckel auf das Monats-Soll)', () => {
    // 25 Urlaubstage x 5 h = 125 h Rohgutschrift bei 86:40 Monats-Soll und 0 h
    // Ist. Ohne Deckel entstuenden aus reinem Urlaub +38:20 Ueberstunden.
    const urlaub = Array.from({ length: 25 }, (_, i) => vac(2026, 5, i + 1));
    const l = buildBalanceLedger(emp, [], ref, urlaub);
    expect(l!.target.vacationCreditMs).toBe(SOLL);
    expect(l!.target.saldoMs).toBe(0);
  });

  it('Monat ohne Soll (ausserhalb der Beschaeftigung) bekommt keine Gutschrift', () => {
    const ends: Employment = { ...emp, endDate: new Date(2026, 4, 31).getTime() };
    // Juni liegt komplett nach dem Ende -> Soll 0, Urlaubstage duerfen nicht wirken.
    const l = buildBalanceLedger(ends, [], new Date(2026, 5, 15).getTime(), [
      vac(2026, 6, 8),
    ]);
    const juni = l!.months[l!.months.length - 1];
    expect(juni.sollMs).toBe(0);
    expect(juni.vacationCreditMs).toBe(0);
    expect(juni.saldoMs).toBe(0);
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

describe('Mit dem Gehalt abgegoltene Ueberstunden (AUF-016)', () => {
  const empU: Employment = {
    ...emp,
    weeklyHours: 30,
    workdaysPerWeek: 5,
    includedOvertimeHoursPerMonth: 10,
  };

  it('includedOvertimeCapMs: volle Grenze, keine Klausel, Teilmonat anteilig, vor Beginn 0', () => {
    const mai = new Date(2026, 4, 1).getTime();
    expect(includedOvertimeCapMs(empU, mai)).toBe(10 * HOUR);
    expect(includedOvertimeCapMs({ ...empU, includedOvertimeHoursPerMonth: null }, mai)).toBe(0);
    const teil = { ...empU, startDate: new Date(2026, 8, 16).getTime() };
    const sep = new Date(2026, 8, 1).getTime();
    expect(includedOvertimeCapMs(teil, sep)).toBe(5 * HOUR);
    const apr = new Date(2026, 3, 1).getTime();
    expect(includedOvertimeCapMs(empU, apr)).toBe(0);
  });

  function monthEntries(mo: number, n: number, restH = 0, restDay = 20) {
    const list: TimeEntry[] = [];
    for (let d = 1; d <= n; d++) list.push(entry(2026, mo, d, 8, 18));
    if (restH > 0) list.push(entry(2026, mo, restDay, 8, 8 + restH));
    return list;
  }

  function maiEntries(n: number, restH = 0, restDay = 20) {
    return monthEntries(5, n, restH, restDay);
  }

  it('Abgeltung: Plus unter der Grenze wird ganz abgegolten', () => {
    const ref = new Date(2026, 4, 31).getTime();
    const l = buildBalanceLedger(empU, maiEntries(13, 6), ref)!;
    expect(l.target.saldoMs).toBe(6 * HOUR);
    expect(l.target.includedOvertimeMs).toBe(6 * HOUR);
    expect(l.closing).toBe(0);
  });

  it('Abgeltung: Plus ueber der Grenze, der Rest geht ins Konto', () => {
    const ref = new Date(2026, 4, 31).getTime();
    const l = buildBalanceLedger(empU, maiEntries(14, 5), ref)!;
    expect(l.target.saldoMs).toBe(15 * HOUR);
    expect(l.target.includedOvertimeMs).toBe(10 * HOUR);
    expect(l.closing).toBe(5 * HOUR);
  });

  it('Abgeltung: ohne Klausel rechnet das Konto wie bisher', () => {
    const ref = new Date(2026, 4, 31).getTime();
    const e = { ...empU, includedOvertimeHoursPerMonth: null };
    const l = buildBalanceLedger(e, maiEntries(14, 5), ref)!;
    expect(l.target.includedOvertimeMs).toBe(0);
    expect(l.target.saldoMs).toBe(15 * HOUR);
    expect(l.closing).toBe(15 * HOUR);
  });

  it('Abgeltung: Minus aus dem Vormonat mindert die Abgeltung nicht', () => {
    const mai = maiEntries(12);
    const juni = monthEntries(6, 14, 5);
    const ref = new Date(2026, 5, 30).getTime();
    const l = buildBalanceLedger(empU, [...mai, ...juni], ref)!;
    expect(l.months[0].includedOvertimeMs).toBe(0);
    expect(l.target.saldoMs).toBe(15 * HOUR);
    expect(l.target.includedOvertimeMs).toBe(10 * HOUR);
    expect(l.carryIn).toBe(-10 * HOUR);
    expect(l.closing).toBe(-5 * HOUR);
  });

  it('Abgeltung: abgegoltene Stunden eines Vormonats fehlen im Uebertrag', () => {
    const ref = new Date(2026, 5, 30).getTime();
    const l = buildBalanceLedger(empU, maiEntries(14, 5), ref)!;
    expect(l.months[0].includedOvertimeMs).toBe(10 * HOUR);
    expect(l.carryIn).toBe(5 * HOUR);
    expect(l.target.saldoMs).toBe(-130 * HOUR);
    expect(l.target.includedOvertimeMs).toBe(0);
    expect(l.closing).toBe(-125 * HOUR);
  });

  it('Abgeltung: im Eintrittsmonat gilt die Grenze anteilig', () => {
    const teil = { ...empU, startDate: new Date(2026, 8, 16).getTime() };
    const ents: TimeEntry[] = [];
    for (let d = 16; d <= 22; d++) ents.push(entry(2026, 9, d, 8, 18));
    ents.push(entry(2026, 9, 23, 8, 11));
    const ref = new Date(2026, 8, 30).getTime();
    const l = buildBalanceLedger(teil, ents, ref)!;
    expect(l.target.sollMs).toBe(65 * HOUR);
    expect(l.target.saldoMs).toBe(8 * HOUR);
    expect(l.target.includedOvertimeMs).toBe(5 * HOUR);
    expect(l.closing).toBe(3 * HOUR);
  });

  it('Abgeltung: Urlaubsgutschrift zaehlt zum Monatsplus', () => {
    const ref = new Date(2026, 4, 31).getTime();
    const vac = new Date(2026, 4, 25).getTime();
    const l = buildBalanceLedger(empU, maiEntries(13), ref, [vac])!;
    expect(l.target.vacationCreditMs).toBe(6 * HOUR);
    expect(l.target.saldoMs).toBe(6 * HOUR);
    expect(l.target.includedOvertimeMs).toBe(6 * HOUR);
    expect(l.closing).toBe(0);
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
