import {
  endOfMonth,
  endOfDay,
  startOfDay,
  addMonths,
  eachDayOfInterval,
  getDay,
  getYear,
  getMonth,
} from 'date-fns';
import type { ClockodoAbsenceRef, ClockodoConfig } from './clockodo';
import { publicHolidayMap, type PublicHolidays } from './holidays';

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
  /**
   * Feste Arbeitstage als Wochentage (0 = Sonntag ... 6 = Samstag), aufsteigend, 1 bis 6
   * Tage. Fehlt = nicht gewaehlt, dann gilt die Regel von workWeekdaysOf. Ist das Feld
   * gesetzt, ist workdaysPerWeek seine Laenge (cleanEmployment).
   */
  workWeekdays?: number[];
  /** Feiertage am Arbeitsort (AUF-029); fehlt = keine, wie bis 1.12. */
  publicHolidays?: PublicHolidays;
  /**
   * Fruehere Vertragsstaende (AUF-031), aufsteigend nach validUntil; fehlt = der Vertrag galt
   * immer wie oben. Ein Stand gilt bis einschliesslich validUntil, danach der naechste.
   */
  contractHistory?: ContractPeriod[];
  /** Darstellung des Urlaubsanspruchs im Eintrittsjahr. */
  vacationYearMode: VacationYearMode;
  /** Anfangssaldo in ms zum Start (uebernommene Ueber-/Minusstunden). Default 0. */
  openingBalanceMs: number;
  /** Vertraglicher Jahresurlaub in Arbeitstagen; null = gesetzliches Minimum. */
  contractVacationDays: number | null;
  /** Mit dem Gehalt abgegoltene Ueberstunden je Monat (Stunden); null = keine solche Klausel. */
  includedOvertimeHoursPerMonth: number | null;
  /** Hinweis in der Fussnote des PDF-Kontoblocks (z. B. Ausgleichsregel im Vertrag); leer = keiner. */
  balanceNote: string;
  /** Clockodo-Uebertragung; null = aus. */
  clockodo: ClockodoConfig | null;
}

/**
 * Wie der Urlaubsanspruch im Eintrittsjahr ausgewiesen wird:
 * - full:    voller gesetzlicher Jahresanspruch (Wartezeit § 4 im Jahr erfuellt)
 * - prorata: anteilig nach § 5 (Zwoelftelung), auf-/abgerundet
 * - both:    voller Anspruch als Hauptzahl, Zwoelftelung zusaetzlich nachrichtlich
 */
export type VacationYearMode = 'full' | 'prorata' | 'both';

/** Ein frueherer Vertragsstand: galt bis einschliesslich validUntil (lokale Mitternacht). */
export interface ContractPeriod {
  validUntil: number;
  weeklyHours: number;
  workdaysPerWeek: number;
  workWeekdays?: number[];
}

/** Die Vertragsbedingungen, die mit einem Vertragsstand wechseln. */
export type ContractTerms = Pick<Employment, 'weeklyHours' | 'workdaysPerWeek' | 'workWeekdays'>;

/**
 * Vertragsbedingungen an einem Tag (AUF-031): der erste fruehere Stand, der den Tag noch
 * umfasst, sonst der heutige Vertrag.
 */
export function contractAt(
  emp: ContractTerms & Pick<Employment, 'contractHistory'>,
  date: number,
): ContractTerms {
  const tag = startOfDay(date).getTime();
  const stand = (emp.contractHistory ?? []).find((c) => tag <= c.validUntil) ?? emp;
  return {
    weeklyHours: stand.weeklyHours,
    workdaysPerWeek: stand.workdaysPerWeek,
    ...(stand.workWeekdays ? { workWeekdays: stand.workWeekdays } : {}),
  };
}

/**
 * Gespeicherte Vertragsstaende pruefen: validUntil auf Mitternacht, Wochenstunden ueber 0,
 * 1 bis 6 Arbeitstage (gewaehlte Wochentage setzen ihre Zahl), aufsteigend, je Tag einer.
 * Bleibt keiner, undefined.
 */
export function cleanContractHistory(raw: unknown): ContractPeriod[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const jeTag = new Map<number, ContractPeriod>();
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const x = item as Record<string, unknown>;
    if (typeof x.validUntil !== 'number' || !Number.isFinite(x.validUntil)) continue;
    if (typeof x.weeklyHours !== 'number' || !Number.isFinite(x.weeklyHours)) continue;
    if (x.weeklyHours <= 0) continue;
    const wochentage = cleanWorkWeekdays(x.workWeekdays);
    const zahl = typeof x.workdaysPerWeek === 'number' ? Math.round(x.workdaysPerWeek) : Number.NaN;
    const workdaysPerWeek = wochentage ? wochentage.length : zahl;
    if (!(workdaysPerWeek >= 1 && workdaysPerWeek <= WERKTAGE_PER_WEEK)) continue;
    const validUntil = startOfDay(x.validUntil).getTime();
    jeTag.set(validUntil, {
      validUntil,
      weeklyHours: x.weeklyHours,
      workdaysPerWeek,
      ...(wochentage ? { workWeekdays: wochentage } : {}),
    });
  }
  const liste = [...jeTag.values()].sort((a, b) => a.validUntil - b.validUntil);
  return liste.length > 0 ? liste : undefined;
}

/** Wochentage, an denen am Tag gearbeitet wird: nach dem Vertragsstand, der den Tag umfasst. */
export function wochentageAm(
  emp: Pick<Employment, 'workdaysPerWeek' | 'workWeekdays' | 'contractHistory'>,
  date: number,
): number[] {
  const tag = startOfDay(date).getTime();
  return workWeekdaysOf((emp.contractHistory ?? []).find((c) => tag <= c.validUntil) ?? emp);
}

/** Ein genommener Urlaubstag (1 Arbeitstag, ein halber 0,5), als Tagesdatum (epoch ms). */
export interface VacationDay {
  employmentId: string;
  date: number; // lokale Mitternacht des Urlaubstags
  note: string;
  /** Halber Urlaubstag (AUF-046): zaehlt 0,5, die Gutschrift hoechstens das halbe Tagessoll; fehlt = ganzer Tag. */
  halfDay?: true;
  /** Clockodo-Antrag, zu dem der Tag gehoert; fehlt = nie beantragt. */
  clockodoAbsence?: ClockodoAbsenceRef;
}

/** Anteil eines halben Urlaubstags am ganzen (AUF-046). */
export const HALF_VACATION_DAY = 0.5;

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
  includedOvertimeHoursPerMonth: null,
  balanceNote: '',
  clockodo: null,
};

// --- Urlaubstage erfassen ---

/**
 * Arbeitstage eines Zeitraums als Tagesdaten (lokale Mitternacht), aufsteigend: die
 * Tage, deren Wochentag in workWeekdaysOf(emp) steht.
 *
 * Feiertage der Beschaeftigung (publicHolidays) zaehlen nicht: an ihnen gibt es keinen
 * Urlaubstag (§ 3 Abs. 2 BUrlG). `bis` vor `von` ergibt eine leere Liste.
 */
export function workdaysInRange(
  fromEpoch: number,
  toEpoch: number,
  emp: Pick<Employment, 'workdaysPerWeek' | 'workWeekdays' | 'publicHolidays' | 'contractHistory'>,
): number[] {
  const from = startOfDay(fromEpoch);
  const to = startOfDay(toEpoch);
  if (to.getTime() < from.getTime()) return [];
  const feiertage = publicHolidayMap(emp.publicHolidays, from.getFullYear(), to.getFullYear());
  return eachDayOfInterval({ start: from, end: to })
    .filter(
      (d) =>
        wochentageAm(emp, d.getTime()).includes(getDay(d)) && !feiertage.has(d.getTime()),
    )
    .map((d) => d.getTime());
}

/**
 * Wochentage, an denen die Beschaeftigung arbeitet (0 = Sonntag ... 6 = Samstag),
 * aufsteigend. Ohne gewaehlte Wochentage die bisherige Regel: Montag bis Freitag, ab
 * sechs Arbeitstagen auch der Samstag, nie der Sonntag. Bei 1 bis 4 Arbeitstagen sind
 * das bewusst zu viele Tage -- die App raet keine Verteilung, die sie nicht kennt.
 */
export function workWeekdaysOf(
  emp: Pick<Employment, 'workdaysPerWeek' | 'workWeekdays'>,
): number[] {
  if (emp.workWeekdays && emp.workWeekdays.length > 0) return [...emp.workWeekdays];
  return emp.workdaysPerWeek >= WERKTAGE_PER_WEEK ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
}

/**
 * Gespeicherte Wochentage pruefen: ganze Zahlen 0 bis 6, Doppelte entfernt, aufsteigend,
 * 1 bis 6 Tage. Alles andere ergibt undefined (= nicht gewaehlt).
 */
export function cleanWorkWeekdays(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  if (!raw.every((v) => Number.isInteger(v) && v >= 0 && v <= 6)) return undefined;
  const days = [...new Set(raw as number[])].sort((a, b) => a - b);
  return days.length >= 1 && days.length <= WERKTAGE_PER_WEEK ? days : undefined;
}

/**
 * Wochentage, die das Formular als gewaehlt zeigt: die gespeicherten; ohne solche bei 5
 * oder 6 Arbeitstagen die der bisherigen Regel, bei 1 bis 4 keine.
 */
export function displayedWorkWeekdays(
  emp: Pick<Employment, 'workdaysPerWeek' | 'workWeekdays'>,
): number[] {
  if (emp.workWeekdays && emp.workWeekdays.length > 0) return [...emp.workWeekdays];
  return emp.workdaysPerWeek >= 5 ? workWeekdaysOf(emp) : [];
}

/**
 * Einen Wochentag an- oder abwaehlen. null, wenn das nicht geht: der letzte Tag bleibt,
 * und mehr als sechs Tage gibt es nicht (Werktage-Basis des § 3 BUrlG).
 */
export function toggleWorkWeekday(
  current: readonly number[],
  day: number,
): number[] | null {
  const next = current.includes(day)
    ? current.filter((d) => d !== day)
    : [...current, day].sort((a, b) => a - b);
  return next.length >= 1 && next.length <= WERKTAGE_PER_WEEK ? next : null;
}

/**
 * Ein Urlaubstag ist je Beschaeftigung eindeutig — derselbe Kalendertag darf
 * in zwei Beschaeftigungen Urlaub sein, in einer nur einmal.
 */
export function vacationDayKey(employmentId: string, date: number): string {
  return `${employmentId}|${date}`;
}

/**
 * Vereinigt zwei Urlaubslisten. Bei gleichem Tag derselben Beschaeftigung
 * gewinnt der BESTEHENDE Eintrag, damit ein Backup-Import lokale Tage (und
 * deren Notiz) nie ueberschreibt. Ergebnis aufsteigend sortiert.
 */
export function mergeVacationDays(
  existing: readonly VacationDay[],
  incoming: readonly VacationDay[],
): VacationDay[] {
  const known = new Set(
    existing.map((d) => vacationDayKey(d.employmentId, d.date)),
  );
  return [
    ...existing,
    ...incoming.filter(
      (d) => !known.has(vacationDayKey(d.employmentId, d.date)),
    ),
  ].sort((a, b) => a.date - b.date);
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
  taken: number; // genommene Urlaubstage im Jahr, ein halber zaehlt 0,5 (AUF-046)
  remaining: number; // Resturlaub (entitlement - taken)
}

/**
 * Urlaubsstatus fuer ein Kalenderjahr aus Vertrag und genommenen Tagen.
 * Im Eintrittsjahr richtet sich die massgebliche Zahl nach `vacationYearMode`;
 * bei erfuellter Wartezeit ist das der volle Jahresanspruch (§ 4), sonst der
 * gezwoelftelte Teilurlaub (§ 5). Folgejahre: voller Anspruch; bei befristetem
 * Austritt anteilig nur, wenn in der ERSTEN Jahreshaelfte ausgeschieden wird
 * (§ 5 Abs. 1 lit. c) oder vor erfuellter Wartezeit (lit. b).
 *
 * `halfDates` nennt die halben unter den genommenen Tagen; sie zaehlen 0,5 (AUF-046). Ein
 * Datum nur dort ist kein Urlaubstag.
 */
export function buildVacationStatus(
  emp: Employment,
  takenDates: readonly number[],
  year: number,
  halfDates: readonly number[] = [],
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

  // Urlaubstage auf Feiertagen zaehlen nicht (§ 3 Abs. 2 BUrlG); ein halber zaehlt 0,5 (AUF-046).
  const feiertage = publicHolidayMap(emp.publicHolidays, year, year);
  const halbe = new Set(halfDates.map((d) => startOfDay(d).getTime()));
  const taken = takenDates
    .filter((d) => getYear(d) === year && !feiertage.has(startOfDay(d).getTime()))
    .reduce((n, d) => n + (halbe.has(startOfDay(d).getTime()) ? HALF_VACATION_DAY : 1), 0);
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
