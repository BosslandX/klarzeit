import {
  startOfMonth,
  endOfMonth,
  endOfDay,
  startOfDay,
  addMonths,
  eachDayOfInterval,
  eachMonthOfInterval,
  getDaysInMonth,
  getDay,
  getYear,
  getMonth,
  differenceInCalendarDays,
  format,
} from 'date-fns';
import { de } from 'date-fns/locale';
import { HOUR, MINUTE, netMs } from './time';
import type { TimeEntry } from './types';

/**
 * Beschaeftigungs-/Vertragsdaten fuer Arbeitszeitkonto und gesetzlichen Urlaub.
 * Single-User, lokal gespeichert (siehe db/employment.ts). Die konkreten Werte
 * (Wochenstunden, Arbeitstage, Beginn) traegt der Nutzer in der App ein; der
 * Urlaub richtet sich nach dem Bundesurlaubsgesetz (BUrlG §§ 3–5).
 */
export interface Employment {
  /** Stabile ID, wird nie wiederverwendet. */
  id: string;
  /** Anzeigename der Beschaeftigung. */
  name: string;
  arbeitgeber: string;
  personalnummer: string;
  abteilung: string;
  /** Beginn des Arbeitsverhaeltnisses (epoch ms, lokale Mitternacht). */
  startDate: number;
  /** Optionales (befristetes) Ende, letzter Arbeitstag; null = offen. */
  endDate: number | null;
  /** Vertragliche Wochenarbeitszeit in Stunden (z.B. 20). */
  weeklyHours: number;
  /** Arbeitstage pro Woche (Basis des gesetzlichen Urlaubsanspruchs). */
  workdaysPerWeek: number;
  /** Darstellung des Urlaubsanspruchs im Eintrittsjahr. */
  vacationYearMode: VacationYearMode;
  /** Anfangssaldo in ms zum Start (uebernommene Ueber-/Minusstunden). Default 0. */
  openingBalanceMs: number;
  /** Vertraglicher Jahresurlaub in Arbeitstagen; null = gesetzliches Minimum. */
  contractVacationDays: number | null;
}

/**
 * Wie der Urlaubsanspruch im Eintrittsjahr ausgewiesen wird:
 * - full:    voller gesetzlicher Jahresanspruch (Wartezeit § 4 im Jahr erfuellt)
 * - prorata: anteilig nach § 5 (Zwoelftelung), auf-/abgerundet
 * - both:    voller Anspruch als Hauptzahl, Zwoelftelung zusaetzlich nachrichtlich
 */
export type VacationYearMode = 'full' | 'prorata' | 'both';

/** Ein genommener Urlaubstag (jeweils 1 Arbeitstag), als Tagesdatum (epoch ms). */
export interface VacationDay {
  employmentId: string;
  date: number; // lokale Mitternacht des Urlaubstags
  note: string;
}

// --- Konstanten (gesetzliche Grundlagen) ---

/** Durchschnittliche Wochen pro Monat: 52 / 12. Standard fuer feste Wochenstunden. */
export const WEEKS_PER_MONTH = 52 / 12;
/** § 3 Abs. 1 BUrlG: gesetzlicher Mindesturlaub bei 6-Tage-Woche. */
export const STATUTORY_VACATION_WERKTAGE = 24;
/** Werktage-Basis (Mo–Sa) des § 3 BUrlG. */
export const WERKTAGE_PER_WEEK = 6;
/** § 4 BUrlG: Wartezeit bis zum vollen Urlaubsanspruch. */
export const WAITING_PERIOD_MONTHS = 6;

/**
 * Neutrale Standardwerte. Die konkreten Vertragsdaten (Wochenstunden, Arbeitstage,
 * Beginn) traegt der Nutzer in der App ein (Tab „Mehr"); sie werden lokal in den
 * Preferences gespeichert. Bewusst KEINE personenbezogenen Vorgaben im Build.
 */
export const defaultEmployment: Employment = {
  id: 'emp-1',
  name: 'Beschäftigung 1',
  arbeitgeber: '',
  personalnummer: '',
  abteilung: '',
  startDate: new Date(new Date().getFullYear(), 0, 1).getTime(), // 1. Jan. des laufenden Jahres
  endDate: null,
  weeklyHours: 0, // in den Einstellungen (Mehr) eintragen
  workdaysPerWeek: 5,
  vacationYearMode: 'both',
  openingBalanceMs: 0,
  contractVacationDays: null,
};

// --- Monats-Soll (Arbeitszeitkonto) ---

/** Volles Monats-Soll in ms: Wochenstunden x (52/12). */
export function fullMonthlyTargetMs(weeklyHours: number): number {
  return weeklyHours * WEEKS_PER_MONTH * HOUR;
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
  const mStartMs = startOfMonth(monthRef).getTime();
  const mEndMs = endOfMonth(monthRef).getTime();
  const startMs = Math.max(mStartMs, startOfDay(emp.startDate).getTime());
  const endLimitMs =
    emp.endDate != null ? endOfDay(emp.endDate).getTime() : mEndMs;
  const endMs = Math.min(mEndMs, endLimitMs);
  if (endMs < startMs) return 0;

  const daysInMonth = getDaysInMonth(mStartMs);
  const employedDays = differenceInCalendarDays(endMs, startMs) + 1;
  const fraction = employedDays / daysInMonth;
  // Auf volle Minuten runden, damit Soll/Ist/Saldo in der Anzeige aufgehen.
  return Math.round((fullMonthlyTargetMs(emp.weeklyHours) * fraction) / MINUTE) * MINUTE;
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
  saldoMs: number; // istMs + vacationCreditMs - sollMs (positiv = Ueberstunden)
}

/** Fortgeschriebenes Arbeitszeitkonto bis zu einem Zielmonat. */
export interface BalanceLedger {
  months: MonthBalance[]; // Eintrittsmonat .. Zielmonat (inkl.)
  opening: number; // Anfangssaldo zum Beschaeftigungsbeginn
  carryIn: number; // Uebertrag VOR dem Zielmonat (opening + Salden der Vormonate)
  target: MonthBalance; // der Zielmonat selbst
  closing: number; // Gesamtsaldo NACH dem Zielmonat (carryIn + target.saldo)
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
): { days: number; creditMs: number } {
  const mStart = startOfMonth(monthRef).getTime();
  const mEnd = endOfMonth(monthRef).getTime();
  const empStart = startOfDay(emp.startDate).getTime();
  const empEnd = emp.endDate != null ? endOfDay(emp.endDate).getTime() : Infinity;
  const inMonth = vacationDates.filter(
    (d) => d >= mStart && d <= mEnd && d >= empStart && d <= empEnd,
  );
  const perDay = dailyTargetMs(emp);
  const creditMs = inMonth.reduce((sum, day) => {
    const dayStart = startOfDay(day).getTime();
    const dayEnd = endOfDay(day).getTime();
    const istOfDay = entries.reduce(
      (s, e) =>
        e.start >= dayStart && e.start <= dayEnd && e.start >= empStart && e.start <= empEnd
          ? s + netMs(e)
          : s,
      0,
    );
    return sum + Math.max(0, perDay - istOfDay);
  }, 0);
  return {
    days: inMonth.length,
    creditMs: Math.round(creditMs / MINUTE) * MINUTE,
  };
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
 */
export function buildBalanceLedger(
  emp: Employment,
  entries: readonly TimeEntry[],
  refEpoch: number,
  vacationDates: readonly number[] = [],
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
    const vac = vacationOfMonth(emp, entries, vacationDates, m.getTime());
    const vacationDays = vac.days;
    // Deckel auf das Monats-Soll: reiner Urlaub kann die Arbeitspflicht
    // hoechstens aufheben, niemals Ueberstunden erzeugen. Nicht gegen das
    // Monats-Ist deckeln — die Verrechnung mit bereits erfasster Zeit ist in
    // vacationOfMonth bereits TAGGENAU erledigt; ein zweiter Abzug auf
    // Monatsebene wuerde Arbeit an urlaubsfreien Tagen entwerten.
    const vacationCreditMs = Math.min(vac.creditMs, sollMs);
    return {
      monthStart: m.getTime(),
      label: format(m, 'MMMM yyyy', { locale: de }),
      sollMs,
      istMs,
      vacationDays,
      vacationCreditMs,
      saldoMs: istMs + vacationCreditMs - sollMs,
    };
  });

  const opening = emp.openingBalanceMs;
  const target = months[months.length - 1];
  const carryIn =
    opening + months.slice(0, -1).reduce((s, mb) => s + mb.saldoMs, 0);
  const closing = carryIn + target.saldoMs;
  return { months, opening, carryIn, target, closing };
}

// --- Urlaubstage erfassen ---

/**
 * Arbeitstage eines Zeitraums als Tagesdaten (lokale Mitternacht), aufsteigend.
 *
 * Der Vertrag speichert nur die ANZAHL der Arbeitstage pro Woche, nicht welche
 * Wochentage das sind. Ausgeschlossen werden daher ausschliesslich die klaren
 * Nicht-Arbeitstage: immer der Sonntag, zusaetzlich der Samstag bei weniger als
 * sechs Arbeitstagen. Bei einer 3- oder 4-Tage-Woche liefert die Funktion also
 * bewusst zu viele Tage — der Nutzer korrigiert sie einzeln, statt dass die App
 * eine Wochentagsverteilung errät, die sie nicht kennt.
 *
 * Feiertage sind der App unbekannt und bleiben enthalten. `bis` vor `von`
 * ergibt eine leere Liste.
 */
export function workdaysInRange(
  fromEpoch: number,
  toEpoch: number,
  workdaysPerWeek: number,
): number[] {
  const from = startOfDay(fromEpoch);
  const to = startOfDay(toEpoch);
  if (to.getTime() < from.getTime()) return [];
  const includeSaturday = workdaysPerWeek >= WERKTAGE_PER_WEEK;
  return eachDayOfInterval({ start: from, end: to })
    .filter((d) => {
      const wd = getDay(d); // 0 = Sonntag, 6 = Samstag
      if (wd === 0) return false;
      if (wd === 6) return includeSaturday;
      return true;
    })
    .map((d) => d.getTime());
}

/**
 * Vereinigt zwei Urlaubslisten. Bei gleichem Datum gewinnt der BESTEHENDE
 * Eintrag, damit ein Backup-Import lokale Tage (und deren Notiz) nie
 * ueberschreibt. Ergebnis aufsteigend sortiert.
 */
export function mergeVacationDays(
  existing: readonly VacationDay[],
  incoming: readonly VacationDay[],
): VacationDay[] {
  const known = new Set(existing.map((d) => d.date));
  return [...existing, ...incoming.filter((d) => !known.has(d.date))].sort(
    (a, b) => a.date - b.date,
  );
}

// --- Urlaub (BUrlG) ---

/**
 * Gesetzlicher Jahresurlaub in eigenen Arbeitstagen: 24 Werktage x (Arbeitstage / 6).
 * Beispiele: 2 Tage/Woche -> 8, 3 -> 12, 5 -> 20, 6 -> 24.
 */
export function annualVacationDays(workdaysPerWeek: number): number {
  return (STATUTORY_VACATION_WERKTAGE * workdaysPerWeek) / WERKTAGE_PER_WEEK;
}

/**
 * Massgeblicher Jahresurlaub: Vertragswert, sofern gesetzt und nicht unter dem
 * gesetzlichen Minimum — der Mindesturlaub ist unabdingbar (§ 13 Abs. 1 BUrlG,
 * vgl. roundTeilurlaub).
 */
export function annualEntitlement(emp: Employment): {
  days: number;
  statutory: number;
  fromContract: boolean;
} {
  const statutory = annualVacationDays(emp.workdaysPerWeek);
  const contract = emp.contractVacationDays;
  const fromContract =
    contract != null && contract >= statutory;
  return {
    days: fromContract ? contract : statutory,
    statutory,
    fromContract,
  };
}

/**
 * § 5 Abs. 2 BUrlG: Bruchteile von mind. einem halben Tag werden auf volle Tage
 * AUFgerundet. Bruchteile unter einem halben Tag bleiben als Bruchteil bestehen
 * — das Gesetz ordnet nur die Aufrundung an; ein Abrunden waere eine unzulaessige
 * Kuerzung des unabdingbaren Mindesturlaubs (§ 13 Abs. 1 BUrlG).
 */
export function roundTeilurlaub(days: number): number {
  const frac = days - Math.floor(days);
  return frac >= 0.5 ? Math.ceil(days) : days;
}

/**
 * Anzahl der Kalendermonate eines Jahres, die voll in die Beschaeftigung fallen.
 * Hinweis: § 5 Abs. 1 BUrlG stellt streng genommen auf volle ZEITmonate des
 * Bestehens des Arbeitsverhaeltnisses ab. Fuer am Monatsersten beginnende /
 * am Monatsletzten endende Vertraege (Regelfall, vgl. Vertrag 01.06.) ist die
 * Kalendermonats-Zaehlung damit deckungsgleich.
 */
export function fullMonthsEmployedInYear(emp: Employment, year: number): number {
  const startMs = startOfDay(emp.startDate).getTime();
  const endMs = emp.endDate != null ? endOfDay(emp.endDate).getTime() : null;
  let count = 0;
  for (let m = 0; m < 12; m++) {
    const ref = new Date(year, m, 1);
    const mStart = ref.getTime();
    const mEnd = endOfMonth(ref).getTime();
    const startedBy = startMs <= mStart;
    const notEndedBefore = endMs == null || endMs >= mEnd;
    if (startedBy && notEndedBefore) count++;
  }
  return count;
}

/** Ende der Wartezeit (§ 4 BUrlG): Beginn + 6 Monate. */
export function waitingPeriodEnd(emp: Employment): number {
  return addMonths(emp.startDate, WAITING_PERIOD_MONTHS).getTime();
}

/** Ist die 6-Monats-Wartezeit (§ 4) bis Ende des Jahres erfuellt? */
export function waitingFulfilledInYear(emp: Employment, year: number): boolean {
  return getYear(waitingPeriodEnd(emp)) <= year;
}

/** Aufbereiteter Urlaubsstatus eines Kalenderjahres. */
export interface VacationStatus {
  year: number;
  workdaysPerWeek: number;
  annualFull: number; // voller Jahresanspruch (Vertrag oder gesetzlich)
  annualStatutory: number; // gesetzlicher Mindestanspruch (Arbeitstage)
  fromContract: boolean; // Jahresanspruch stammt aus Vertragsfeld
  fullMonths: number; // beschaeftigte volle Monate im Jahr
  prorataExact: number; // annualFull x fullMonths/12 (ungerundet)
  prorataRounded: number; // § 5 Abs. 2 gerundet
  waitingFulfilled: boolean; // Wartezeit § 4 im Jahr erfuellt
  isEntryYear: boolean;
  mode: VacationYearMode;
  entitlement: number; // massgebliche Anspruchszahl fuers Jahr
  taken: number; // genommene Urlaubstage im Jahr
  remaining: number; // Resturlaub (entitlement - taken)
}

/**
 * Urlaubsstatus fuer ein Kalenderjahr aus Vertrag und genommenen Tagen.
 * Im Eintrittsjahr richtet sich die massgebliche Zahl nach `vacationYearMode`;
 * bei erfuellter Wartezeit ist das der volle Jahresanspruch (§ 4), sonst der
 * gezwoelftelte Teilurlaub (§ 5). Folgejahre: voller Anspruch; bei befristetem
 * Austritt anteilig nur, wenn in der ERSTEN Jahreshaelfte ausgeschieden wird
 * (§ 5 Abs. 1 lit. c) oder vor erfuellter Wartezeit (lit. b).
 */
export function buildVacationStatus(
  emp: Employment,
  takenDates: readonly number[],
  year: number,
): VacationStatus {
  const entitlementBase = annualEntitlement(emp);
  const annualFull = entitlementBase.days;
  const annualStatutory = entitlementBase.statutory;
  const fromContract = entitlementBase.fromContract;
  const fullMonths = fullMonthsEmployedInYear(emp, year);
  const prorataExact = (annualFull * fullMonths) / 12;
  const prorataRounded = roundTeilurlaub(prorataExact);
  const waitingFulfilled = waitingFulfilledInYear(emp, year);
  const isEntryYear = year === getYear(emp.startDate);

  const exitsThisYear = emp.endDate != null && getYear(emp.endDate) === year;
  let entitlement: number;
  if (!isEntryYear) {
    if (exitsThisYear) {
      // § 5 Abs. 1 lit. c (Umkehrschluss, st. Rspr. BAG): Zwoelftelung nur bei
      // Ausscheiden in der ERSTEN Jahreshaelfte (<= 30.06.) nach erfuellter
      // Wartezeit ODER vor erfuellter Wartezeit (lit. b). Ausscheiden in der
      // ZWEITEN Jahreshaelfte (ab 01.07.) nach Wartezeit -> VOLLER Jahresanspruch.
      const secondHalfExit = getMonth(emp.endDate as number) >= 6; // Jul..Dez
      const waitingDoneByExit = waitingPeriodEnd(emp) <= (emp.endDate as number);
      entitlement = waitingDoneByExit && secondHalfExit ? annualFull : prorataRounded;
    } else if (fullMonths === 12) {
      entitlement = annualFull; // ganzjaehrig beschaeftigt
    } else {
      entitlement = prorataRounded; // Jahr ganz/teilweise ausserhalb der Beschaeftigung
    }
  } else if (emp.vacationYearMode === 'prorata') {
    entitlement = prorataRounded;
  } else {
    // 'full' und 'both': voll, wenn die Wartezeit im Jahr erfuellt ist.
    entitlement = waitingFulfilled ? annualFull : prorataRounded;
  }

  const taken = takenDates.filter((d) => getYear(d) === year).length;
  return {
    year,
    workdaysPerWeek: emp.workdaysPerWeek,
    annualFull,
    annualStatutory,
    fromContract,
    fullMonths,
    prorataExact,
    prorataRounded,
    waitingFulfilled,
    isEntryYear,
    mode: emp.vacationYearMode,
    entitlement,
    taken,
    remaining: entitlement - taken,
  };
}
