import { describe, it, expect } from 'vitest';
import {
  annualVacationDays,
  buildBalanceLedger,
  buildVacationStatus,
  defaultEmployment,
  fullMonthlyTargetMs,
  fullMonthsEmployedInYear,
  monthSollMs,
  roundTeilurlaub,
  waitingFulfilledInYear,
  waitingPeriodEnd,
  type Employment,
} from './employment';
import type { TimeEntry } from './types';
import { HOUR, MINUTE } from './time';

// Beispielhafter Teilzeitvertrag als expliziter Fixture – unabhaengig von den
// (neutralen) App-Defaults, damit die Tests die Rechtslogik konkret pruefen:
// 20 Wochenstunden an 4 Arbeitstagen, Beginn 01.05.2026.
const emp: Employment = {
  startDate: new Date(2026, 4, 1).getTime(), // 01.05.2026
  endDate: null,
  weeklyHours: 20,
  workdaysPerWeek: 4,
  vacationYearMode: 'both',
  openingBalanceMs: 0,
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
