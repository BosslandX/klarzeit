import { describe, it, expect } from 'vitest';
import {
  buildBalanceLedger,
  dailyTargetMs,
  fullMonthlyTargetMs,
  includedOvertimeCapMs,
  monthSollMs,
} from './balance';
import type { Employment } from './employment';
import type { TimeEntry } from './types';
import { HOUR, MINUTE } from './time';

// Tests des Arbeitszeitkontos -- bis AUF-045 in employment.test.ts, wortgleich hierher gewandert.

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

describe('Halbe Urlaubstage (AUF-046)', () => {
  const vac = (y: number, mo: number, d: number) => new Date(y, mo - 1, d).getTime();
  const ref = new Date(2026, 4, 28).getTime();

  it('ein halber Urlaubstag zaehlt 0,5 und schreibt das halbe Tagessoll gut', () => {
    const l = buildBalanceLedger(emp, [], ref, [vac(2026, 5, 6)], [], [vac(2026, 5, 6)]);
    expect(l!.target.vacationDays).toBe(0.5);
    expect(l!.target.vacationCreditMs).toBe(2.5 * HOUR);
  });

  it('halber Tag mit 2 h erfasst: die Gutschrift bleibt das halbe Tagessoll', () => {
    const entries = [entry(2026, 5, 6, 8, 10)]; // 2 h
    const l = buildBalanceLedger(emp, entries, ref, [vac(2026, 5, 6)], [], [vac(2026, 5, 6)]);
    expect(l!.target.vacationCreditMs).toBe(2.5 * HOUR);
    expect(l!.target.saldoMs).toBe(2 * HOUR + 2.5 * HOUR - SOLL);
  });

  it('halber Tag mit 4 h erfasst: Gutschrift nur bis zum Tagessoll', () => {
    const entries = [entry(2026, 5, 6, 8, 12)]; // 4 h
    const l = buildBalanceLedger(emp, entries, ref, [vac(2026, 5, 6)], [], [vac(2026, 5, 6)]);
    expect(l!.target.vacationCreditMs).toBe(1 * HOUR); // 5 h Tagessoll - 4 h
  });

  it('ganze und halbe Tage zusammen', () => {
    const l = buildBalanceLedger(
      emp,
      [],
      ref,
      [vac(2026, 5, 6), vac(2026, 5, 7)],
      [],
      [vac(2026, 5, 7)],
    );
    expect(l!.target.vacationDays).toBe(1.5);
    expect(l!.target.vacationCreditMs).toBe(7.5 * HOUR);
  });

  it('ein Datum nur in der halben Liste ist kein Urlaubstag', () => {
    const l = buildBalanceLedger(emp, [], ref, [vac(2026, 5, 6)], [], [vac(2026, 5, 7)]);
    expect(l!.target.vacationDays).toBe(1);
    expect(l!.target.vacationCreditMs).toBe(5 * HOUR);
  });
});
