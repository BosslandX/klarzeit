import {
  startOfMonth,
  endOfMonth,
  endOfDay,
  startOfDay,
  eachDayOfInterval,
  eachMonthOfInterval,
  getDaysInMonth,
  getDay,
  getYear,
  differenceInCalendarDays,
  format,
} from 'date-fns';
import { de } from 'date-fns/locale';
import { HOUR, MINUTE, netMs } from './time';
import type { TimeEntry } from './types';
import { publicHolidayMap } from './holidays';
import {
  HALF_VACATION_DAY,
  WEEKS_PER_MONTH,
  contractAt,
  wochentageAm,
  type Employment,
} from './employment';

/**
 * Arbeitszeitkonto: Monats-Soll, Ist, Gutschriften fuer Urlaub, Feiertage und Krankheit und die
 * Fortschreibung des Saldos. Bis AUF-045 Teil von employment.ts und wortgleich hierher gewandert;
 * Vertrag, Arbeitstage und Urlaubsanspruch bleiben dort.
 */

// --- Monats-Soll (Arbeitszeitkonto) ---

/** Anteil der beschaeftigten Kalendertage am Monat (0 … 1). */
export function employedFractionOfMonth(emp: Employment, monthRef: number): number {
  const mStartMs = startOfMonth(monthRef).getTime();
  const mEndMs = endOfMonth(monthRef).getTime();
  const startMs = Math.max(mStartMs, startOfDay(emp.startDate).getTime());
  const endLimitMs =
    emp.endDate != null ? endOfDay(emp.endDate).getTime() : mEndMs;
  const endMs = Math.min(mEndMs, endLimitMs);
  if (endMs < startMs) return 0;

  const daysInMonth = getDaysInMonth(mStartMs);
  const employedDays = differenceInCalendarDays(endMs, startMs) + 1;
  return employedDays / daysInMonth;
}

/** Volles Monats-Soll in ms: Wochenstunden x (52/12). */
export function fullMonthlyTargetMs(weeklyHours: number): number {
  return weeklyHours * WEEKS_PER_MONTH * HOUR;
}

/** Mit dem Gehalt abgegoltene Ueberstunden-Obergrenze des Monats in ms. */
export function includedOvertimeCapMs(emp: Employment, monthRef: number): number {
  if (emp.includedOvertimeHoursPerMonth == null) return 0;
  return (
    Math.round(
      (emp.includedOvertimeHoursPerMonth *
        HOUR *
        employedFractionOfMonth(emp, monthRef)) /
        MINUTE,
    ) * MINUTE
  );
}

/**
 * Soll-Arbeitszeit EINES Arbeitstages in ms: Wochenstunden / Arbeitstage.
 * Bezugsgroesse fuer die Urlaubsgutschrift im Arbeitszeitkonto. 0 Arbeitstage
 * ergibt 0 statt Infinity (cleanEmployment erzwingt zwar 1..6, die Funktion
 * ist aber auch fuer ungepruefte Werte gutmuetig).
 */
export function dailyTargetMs(emp: Employment): number {
  if (emp.workdaysPerWeek <= 0) return 0;
  return (emp.weeklyHours / emp.workdaysPerWeek) * HOUR;
}

/**
 * Soll-Arbeitszeit eines Monats in ms. Bei Teilmonaten (Eintritts-/Austrittsmonat)
 * anteilig nach beschaeftigten Kalendertagen. Monate ausserhalb der Beschaeftigung
 * ergeben 0.
 */
export function monthSollMs(emp: Employment, monthRef: number): number {
  // Auf volle Minuten runden, damit Soll/Ist/Saldo in der Anzeige aufgehen.
  if (emp.contractHistory && emp.contractHistory.length > 0) {
    // Je beschaeftigtem Kalendertag der Anteil des Vertrags, der an diesem Tag galt (AUF-031).
    const anfang = startOfMonth(monthRef);
    const tageImMonat = getDaysInMonth(anfang);
    const empStart = startOfDay(emp.startDate).getTime();
    const empEnd = emp.endDate != null ? endOfDay(emp.endDate).getTime() : Infinity;
    const roh = eachDayOfInterval({ start: anfang, end: endOfMonth(anfang) })
      .filter((t) => t.getTime() >= empStart && t.getTime() <= empEnd)
      .reduce(
        (s, t) => s + fullMonthlyTargetMs(contractAt(emp, t.getTime()).weeklyHours) / tageImMonat,
        0,
      );
    return Math.round(roh / MINUTE) * MINUTE;
  }
  return (
    Math.round(
      (fullMonthlyTargetMs(emp.weeklyHours) * employedFractionOfMonth(emp, monthRef)) /
        MINUTE,
    ) * MINUTE
  );
}

// --- Saldo-Fortschreibung (Ueber-/Unterstunden) ---

/** Saldo eines einzelnen Monats. */
export interface MonthBalance {
  monthStart: number; // epoch ms (startOfMonth)
  label: string; // z.B. "Juni 2026"
  sollMs: number; // Brutto-Soll des Monats (ohne Urlaubsabzug)
  istMs: number;
  vacationDays: number; // im Monat genommene Urlaubstage (im Beschaeftigungsfenster)
  vacationCreditMs: number; // Gutschrift dafuer, gedeckelt auf sollMs
  holidayDays: number; // Feiertage an eigenen Arbeitstagen im Monat (im Beschaeftigungsfenster)
  holidayCreditMs: number; // Gutschrift dafuer, mit dem Urlaub zusammen gedeckelt auf sollMs
  sickDays: number; // Krankheitstage an eigenen Arbeitstagen (ohne Feiertage und Urlaub)
  sickCreditMs: number; // Gutschrift dafuer, mit Urlaub und Feiertagen gedeckelt auf sollMs
  saldoMs: number; // istMs + alle Gutschriften - sollMs (positiv = Ueberstunden)
  includedOvertimeMs: number; // mit Gehalt abgegolten dieses Monats (ms), nie negativ
}

/** Fortgeschriebenes Arbeitszeitkonto bis zu einem Zielmonat. */
export interface BalanceLedger {
  months: MonthBalance[]; // Eintrittsmonat .. Zielmonat (inkl.)
  opening: number; // Anfangssaldo zum Beschaeftigungsbeginn
  carryIn: number; // Uebertrag VOR dem Zielmonat (opening + Salden der Vormonate abzgl. Abgeltung)
  target: MonthBalance; // der Zielmonat selbst
  closing: number; // Gesamtsaldo NACH dem Zielmonat (carryIn + target.saldoMs - target.includedOvertimeMs)
}

/**
 * Summe der Netto-Arbeitszeit der Eintraege, deren Beginn im Monat UND im
 * Beschaeftigungsfenster [Beginn .. Ende] liegt (auf volle Minuten gerundet).
 * Das Clamping verhindert, dass Stunden vor Beginn / nach Ende den Saldo
 * verfaelschen (Soll wird in monthSollMs symmetrisch gekappt).
 */
function istMsOfMonth(
  emp: Employment,
  entries: readonly TimeEntry[],
  monthRef: number,
): number {
  const mStart = startOfMonth(monthRef).getTime();
  const mEnd = endOfMonth(monthRef).getTime();
  const empStart = startOfDay(emp.startDate).getTime();
  const empEnd = emp.endDate != null ? endOfDay(emp.endDate).getTime() : Infinity;
  const raw = entries.reduce(
    (sum, e) =>
      e.start >= mStart && e.start <= mEnd && e.start >= empStart && e.start <= empEnd
        ? sum + netMs(e)
        : sum,
    0,
  );
  return Math.round(raw / MINUTE) * MINUTE;
}

/**
 * Gutschrift fuer Tage ohne Arbeitspflicht (Urlaub, Feiertag, Krankheit): je Tag bis zum
 * Tagessoll des an ihm geltenden Vertrags, abzueglich der an diesem Tag erfassten Zeit -- so
 * zaehlt kein Tag doppelt. Auf volle Minuten gerundet. `anteil` deckelt die Gutschrift eines
 * Tages auf diesen Teil des Tagessolls (halber Urlaubstag, AUF-046); ohne ihn rechnet die
 * Funktion wie zuvor.
 */
function fillUpCreditMs(
  emp: Employment,
  entries: readonly TimeEntry[],
  days: readonly number[],
  anteil: (day: number) => number = () => 1,
): number {
  const empStart = startOfDay(emp.startDate).getTime();
  const empEnd = emp.endDate != null ? endOfDay(emp.endDate).getTime() : Infinity;
  const creditMs = days.reduce((sum, day) => {
    const perDay = dailyTargetMs({ ...emp, ...contractAt(emp, day) });
    const dayStart = startOfDay(day).getTime();
    const dayEnd = endOfDay(day).getTime();
    const istOfDay = entries.reduce(
      (s, e) =>
        e.start >= dayStart && e.start <= dayEnd && e.start >= empStart && e.start <= empEnd
          ? s + netMs(e)
          : s,
      0,
    );
    return sum + Math.min(perDay * anteil(day), Math.max(0, perDay - istOfDay));
  }, 0);
  return Math.round(creditMs / MINUTE) * MINUTE;
}

/**
 * Urlaubstage eines Monats und die Gutschrift dafuer.
 *
 * Symmetrisch zu istMsOfMonth/monthSollMs auf das Beschaeftigungsfenster
 * geklammert: ein Urlaubstag ausserhalb der Beschaeftigung entlastet nicht.
 *
 * Die Gutschrift fuellt einen Urlaubstag nur auf das Tagessoll AUF. Ist am
 * selben Tag schon Zeit erfasst — etwa weil der Tag frueher als manueller
 * Eintrag "Urlaub" nachgetragen wurde —, wird nur die Differenz gutgeschrieben.
 * Ohne diese Verrechnung wuerde derselbe Tag doppelt zaehlen (einmal als Ist,
 * einmal als Gutschrift) und kuenstliche Ueberstunden erzeugen.
 */
function vacationOfMonth(
  emp: Employment,
  entries: readonly TimeEntry[],
  vacationDates: readonly number[],
  monthRef: number,
  halfDates: readonly number[] = [],
): { days: number; creditMs: number } {
  const mStart = startOfMonth(monthRef).getTime();
  const mEnd = endOfMonth(monthRef).getTime();
  const empStart = startOfDay(emp.startDate).getTime();
  const empEnd = emp.endDate != null ? endOfDay(emp.endDate).getTime() : Infinity;
  // Ein Urlaubstag auf einem Feiertag zaehlt als Feiertag, nicht als Urlaub (§ 3 Abs. 2 BUrlG).
  const feiertage = publicHolidayMap(emp.publicHolidays, getYear(monthRef), getYear(monthRef));
  const inMonth = vacationDates.filter(
    (d) =>
      d >= mStart &&
      d <= mEnd &&
      d >= empStart &&
      d <= empEnd &&
      !feiertage.has(startOfDay(d).getTime()),
  );
  // Ein halber Urlaubstag zaehlt 0,5 und fuellt hoechstens das halbe Tagessoll auf (AUF-046).
  const halbe = new Set(halfDates.map((d) => startOfDay(d).getTime()));
  const anteil = (d: number) => (halbe.has(startOfDay(d).getTime()) ? HALF_VACATION_DAY : 1);
  return {
    days: inMonth.reduce((n, d) => n + anteil(d), 0),
    creditMs: fillUpCreditMs(emp, entries, inMonth, anteil),
  };
}

/**
 * Feiertage eines Monats an eigenen Arbeitstagen und die Gutschrift dafuer (AUF-029). Wie
 * beim Urlaub fuellt sie nur bis zum Tagessoll auf: Arbeit am Feiertag zaehlt als Ist,
 * gutgeschrieben wird der Rest. Grundlage: das Entgelt fuer Arbeitszeit, die infolge eines
 * gesetzlichen Feiertages ausfaellt (§ 2 Abs. 1 EntgFG).
 */
function holidaysOfMonth(
  emp: Employment,
  entries: readonly TimeEntry[],
  monthRef: number,
): { days: number; creditMs: number } {
  const mStart = startOfMonth(monthRef).getTime();
  const mEnd = endOfMonth(monthRef).getTime();
  const empStart = startOfDay(emp.startDate).getTime();
  const empEnd = emp.endDate != null ? endOfDay(emp.endDate).getTime() : Infinity;
  const jahr = getYear(monthRef);
  const tage = [...publicHolidayMap(emp.publicHolidays, jahr, jahr).keys()].filter(
    (d) =>
      d >= mStart &&
      d <= mEnd &&
      d >= empStart &&
      d <= empEnd &&
      wochentageAm(emp, d).includes(getDay(d)),
  );
  return { days: tage.length, creditMs: fillUpCreditMs(emp, entries, tage) };
}

/**
 * Krankheitstage eines Monats an eigenen Arbeitstagen und die Gutschrift dafuer (AUF-033): bis
 * zum Tagessoll, abzueglich am Tag erfasster Zeit -- fortgezahlt wird das Entgelt der
 * massgebenden regelmaessigen Arbeitszeit (§ 4 Abs. 1 EntgFG). Ein Feiertag zaehlt als Feiertag,
 * ein Urlaubstag als Urlaub; welche Urlaubstage krank zaehlen, entscheidet vorher
 * splitVacationAndSickness (§ 9 BUrlG). Die App rechnet Krankheitstage auch nach sechs Wochen
 * nicht als Minusstunden; dass die Entgeltfortzahlung endet, meldet longSickRuns.
 */
function sickOfMonth(
  emp: Employment,
  entries: readonly TimeEntry[],
  sickDates: readonly number[],
  vacationDates: readonly number[],
  monthRef: number,
): { days: number; creditMs: number } {
  const mStart = startOfMonth(monthRef).getTime();
  const mEnd = endOfMonth(monthRef).getTime();
  const empStart = startOfDay(emp.startDate).getTime();
  const empEnd = emp.endDate != null ? endOfDay(emp.endDate).getTime() : Infinity;
  const jahr = getYear(monthRef);
  const feiertage = publicHolidayMap(emp.publicHolidays, jahr, jahr);
  const urlaub = new Set(vacationDates.map((d) => startOfDay(d).getTime()));
  const tage = sickDates.filter((d) => {
    const tag = startOfDay(d).getTime();
    return (
      d >= mStart &&
      d <= mEnd &&
      d >= empStart &&
      d <= empEnd &&
      wochentageAm(emp, d).includes(getDay(d)) &&
      !feiertage.has(tag) &&
      !urlaub.has(tag)
    );
  });
  return { days: tage.length, creditMs: fillUpCreditMs(emp, entries, tage) };
}

/**
 * Baut das Arbeitszeitkonto vom Eintrittsmonat bis zum Monat von `refEpoch`.
 * `entries` sollte den gesamten Zeitraum (Beginn .. Zielmonatsende) abdecken;
 * die Zuordnung erfolgt nach dem Beginn jedes Eintrags. Gibt null zurueck, wenn
 * der Zielmonat vor dem Eintrittsmonat liegt.
 *
 * `vacationDates` (Tagesdaten genommener Urlaubstage) entlasten das Konto:
 * Urlaub ist bezahlte Freistellung (§ 1 BUrlG), an einem Urlaubstag entsteht
 * also keine Arbeitspflicht. Statt das Soll stillschweigend zu kuerzen wird die
 * Entlastung als eigene Gutschrift ausgewiesen, damit Brutto-Soll und Ist im
 * Report nachvollziehbar bleiben. Bereits erfasste Zeit am Urlaubstag wird
 * dabei angerechnet, ein Tag zaehlt also nie doppelt. Ohne Urlaubstage rechnet
 * die Funktion exakt wie zuvor.
 *
 * `sickDates` (Krankheitstage, vorher mit splitVacationAndSickness von den Urlaubstagen
 * getrennt) entlasten ebenso (AUF-033); ohne sie rechnet die Funktion wie zuvor.
 *
 * `halfVacationDates` nennt die halben unter den Urlaubstagen (AUF-046): sie zaehlen 0,5, und die
 * Gutschrift eines solchen Tages ist hoechstens das halbe Tagessoll. Ein Datum nur dort ist kein
 * Urlaubstag. Krankheit schreibt an einem halben Urlaubstag nichts gut -- wie an jedem
 * Urlaubstag geht der Urlaub vor.
 *
 * Mit Klausel fuer abgegoltene Ueberstunden: jeder Monat fuer sich — der Vertrag zaehlt
 * Ueberstunden pro Monat und kennt kein Konto; Minusstunden aus Vormonaten mindern die
 * Abgeltung nicht.
 */
export function buildBalanceLedger(
  emp: Employment,
  entries: readonly TimeEntry[],
  refEpoch: number,
  vacationDates: readonly number[] = [],
  sickDates: readonly number[] = [],
  halfVacationDates: readonly number[] = [],
): BalanceLedger | null {
  const firstMonth = startOfMonth(emp.startDate);
  const targetMonth = startOfMonth(refEpoch);
  if (targetMonth.getTime() < firstMonth.getTime()) return null;

  const months: MonthBalance[] = eachMonthOfInterval({
    start: firstMonth,
    end: targetMonth,
  }).map((m) => {
    const sollMs = monthSollMs(emp, m.getTime());
    const istMs = istMsOfMonth(emp, entries, m.getTime());
    const vac = vacationOfMonth(emp, entries, vacationDates, m.getTime(), halfVacationDates);
    const vacationDays = vac.days;
    // Deckel auf das Monats-Soll: reiner Urlaub kann die Arbeitspflicht
    // hoechstens aufheben, niemals Ueberstunden erzeugen. Nicht gegen das
    // Monats-Ist deckeln — die Verrechnung mit bereits erfasster Zeit ist in
    // vacationOfMonth bereits TAGGENAU erledigt; ein zweiter Abzug auf
    // Monatsebene wuerde Arbeit an urlaubsfreien Tagen entwerten.
    const vacationCreditMs = Math.min(vac.creditMs, sollMs);
    // Feiertage teilen sich den Deckel mit dem Urlaub: zusammen hoechstens das Soll.
    const hol = holidaysOfMonth(emp, entries, m.getTime());
    const holidayCreditMs = Math.min(hol.creditMs, sollMs - vacationCreditMs);
    // Krankheit teilt sich den Deckel mit Urlaub und Feiertagen.
    const sick = sickOfMonth(emp, entries, sickDates, vacationDates, m.getTime());
    const sickCreditMs = Math.min(sick.creditMs, sollMs - vacationCreditMs - holidayCreditMs);
    const saldoMs = istMs + vacationCreditMs + holidayCreditMs + sickCreditMs - sollMs;
    const includedOvertimeMs = Math.min(
      includedOvertimeCapMs(emp, m.getTime()),
      Math.max(0, saldoMs),
    );
    return {
      monthStart: m.getTime(),
      label: format(m, 'MMMM yyyy', { locale: de }),
      sollMs,
      istMs,
      vacationDays,
      vacationCreditMs,
      holidayDays: hol.days,
      holidayCreditMs,
      sickDays: sick.days,
      sickCreditMs,
      saldoMs,
      includedOvertimeMs,
    };
  });

  const opening = emp.openingBalanceMs;
  const target = months[months.length - 1];
  const monthNet = (mb: MonthBalance) => mb.saldoMs - mb.includedOvertimeMs;
  const carryIn =
    opening + months.slice(0, -1).reduce((s, mb) => s + monthNet(mb), 0);
  const closing = carryIn + target.saldoMs - target.includedOvertimeMs;
  return { months, opening, carryIn, target, closing };
}
