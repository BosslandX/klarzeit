import { daysOfAbsence } from '../domain/clockodo-absence';
import { Preferences } from '@capacitor/preferences';
import { useCallback, useEffect, useState } from 'react';
import {
  defaultEmployment,
  mergeVacationDays,
  vacationDayKey,
  type Employment,
  type VacationDay,
  type VacationYearMode,
} from '../domain/employment';
import {
  cleanClockodoAbsenceRef,
  cleanClockodoConfig,
  type ClockodoAbsenceRef,
} from '../domain/clockodo';
import { applyAbsenceRef } from '../domain/clockodo-absence';
import { getProfile } from './profile';
import { removeClockodoKey } from '../clockodo/key-store';
import { removeClockodoLists } from './clockodo-lists';
import { db } from './db';

const KEY_EMP = 'employment';
const KEY_EMPLOYMENTS = 'employments';
const KEY_VAC = 'vacations';
const KEY_ACTIVE = 'activeEmployment';

export const INITIAL_EMPLOYMENT_ID = 'emp-1';

const VALID_MODES: VacationYearMode[] = ['full', 'prorata', 'both'];

/**
 * Bis 1.7 druckte jedes PDF diesen Satz fest. Beschaeftigungen ohne das Feld (aeltere
 * Daten und Backups) behalten ihn, neue beginnen leer.
 */
const LEGACY_BALANCE_NOTE = 'Ausgleich n. § 2 (4) Arbeitsvertrag.';

/** Neue Beschaeftigung: Zeitstempel + Zufallsteil (kein crypto.randomUUID). */
export function createEmploymentId(): string {
  return `emp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Uebernimmt nur bekannte Felder + Default-Fallbacks (kein Datenmuell). */
export function cleanEmployment(raw: unknown): Employment {
  const x = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const mode =
    typeof x.vacationYearMode === 'string' &&
    VALID_MODES.includes(x.vacationYearMode as VacationYearMode)
      ? (x.vacationYearMode as VacationYearMode)
      : defaultEmployment.vacationYearMode;
  const weeklyRaw = num(x.weeklyHours, defaultEmployment.weeklyHours);
  const weeklyHours = weeklyRaw > 0 ? weeklyRaw : defaultEmployment.weeklyHours;
  const wdRaw = Math.round(num(x.workdaysPerWeek, defaultEmployment.workdaysPerWeek));
  const workdaysPerWeek = Math.min(6, Math.max(1, wdRaw));
  let contractVacationDays: number | null = null;
  if (
    typeof x.contractVacationDays === 'number' &&
    Number.isFinite(x.contractVacationDays) &&
    x.contractVacationDays > 0
  ) {
    contractVacationDays = x.contractVacationDays;
  }
  let includedOvertimeHoursPerMonth: number | null = null;
  if (
    typeof x.includedOvertimeHoursPerMonth === 'number' &&
    Number.isFinite(x.includedOvertimeHoursPerMonth) &&
    x.includedOvertimeHoursPerMonth > 0
  ) {
    includedOvertimeHoursPerMonth = x.includedOvertimeHoursPerMonth;
  }
  let balanceNote: string;
  if (!('balanceNote' in x)) {
    balanceNote = LEGACY_BALANCE_NOTE;
  } else if (typeof x.balanceNote === 'string') {
    balanceNote = x.balanceNote;
  } else {
    balanceNote = '';
  }
  const id =
    typeof x.id === 'string' && x.id.trim() !== ''
      ? x.id
      : defaultEmployment.id;
  const name =
    typeof x.name === 'string' && x.name.trim() !== ''
      ? x.name
      : defaultEmployment.name;
  return {
    id,
    name,
    arbeitgeber: str(x.arbeitgeber),
    personalnummer: str(x.personalnummer),
    abteilung: str(x.abteilung),
    startDate: num(x.startDate, defaultEmployment.startDate),
    endDate:
      typeof x.endDate === 'number' && Number.isFinite(x.endDate)
        ? x.endDate
        : null,
    weeklyHours,
    workdaysPerWeek,
    vacationYearMode: mode,
    openingBalanceMs: num(x.openingBalanceMs, 0),
    contractVacationDays,
    includedOvertimeHoursPerMonth,
    balanceNote,
    clockodo: cleanClockodoConfig(x.clockodo),
  };
}

async function saveEmploymentsList(list: Employment[]): Promise<void> {
  await Preferences.set({
    key: KEY_EMPLOYMENTS,
    value: JSON.stringify(list.map(cleanEmployment)),
  });
}

/** Ersetzt die gespeicherte Beschaeftigungsliste (z. B. Backup-Import). */
export async function replaceEmployments(list: Employment[]): Promise<void> {
  await saveEmploymentsList(list);
}

/** true, wenn der employments-Schluessel bereits gesetzt ist (ohne Legacy-Migration). */
export async function hasEmploymentsListStored(): Promise<boolean> {
  const { value } = await Preferences.get({ key: KEY_EMPLOYMENTS });
  if (!value) return false;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

export async function hasLegacyEmploymentStored(): Promise<boolean> {
  const { value } = await Preferences.get({ key: KEY_EMP });
  return value != null && value !== '';
}

async function migrateEmploymentsFromLegacy(): Promise<Employment[]> {
  const { value } = await Preferences.get({ key: KEY_EMP });
  let contract: Employment;
  if (value) {
    try {
      contract = cleanEmployment(JSON.parse(value));
    } catch {
      contract = cleanEmployment(defaultEmployment);
    }
  } else {
    contract = cleanEmployment(defaultEmployment);
  }
  const profile = await getProfile();
  const displayName = profile.arbeitgeber.trim() || 'Beschäftigung 1';
  return [
    {
      ...contract,
      id: INITIAL_EMPLOYMENT_ID,
      name: displayName,
      arbeitgeber: profile.arbeitgeber,
      personalnummer: profile.personalnummer,
      abteilung: profile.abteilung,
    },
  ];
}

/** Alle Beschaeftigungen (migriert beim ersten Lesen). */
export async function getEmployments(): Promise<Employment[]> {
  const { value } = await Preferences.get({ key: KEY_EMPLOYMENTS });
  if (value) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(cleanEmployment);
      }
    } catch {
      /* fall through */
    }
  }
  const migrated = await migrateEmploymentsFromLegacy();
  await saveEmploymentsList(migrated);
  return migrated;
}

/** Aktive (erste) Beschaeftigung — API-Kompatibilitaet. */
export async function getEmployment(): Promise<Employment> {
  const list = await getEmployments();
  return list[0] ?? cleanEmployment(defaultEmployment);
}

export async function getActiveEmploymentId(): Promise<string> {
  const list = await getEmployments();
  const fallback = list[0]?.id ?? INITIAL_EMPLOYMENT_ID;
  const { value } = await Preferences.get({ key: KEY_ACTIVE });
  if (typeof value === 'string' && value !== '' && list.some((e) => e.id === value)) {
    return value;
  }
  return fallback;
}

/** Speichert die zuletzt gewaehlte Beschaeftigung; unbekannte IDs werden abgelehnt. */
export async function setActiveEmployment(id: string): Promise<void> {
  const list = await getEmployments();
  if (!list.some((e) => e.id === id)) {
    throw new Error('Unbekannte Beschaeftigung: ' + id);
  }
  await Preferences.set({ key: KEY_ACTIVE, value: id });
}

export async function saveEmployment(emp: Employment): Promise<void> {
  const list = await getEmployments();
  const cleaned = cleanEmployment(emp);
  if (list.length === 0) {
    await saveEmploymentsList([cleaned]);
    return;
  }
  const next = [...list];
  next[0] = { ...cleaned, id: list[0].id };
  await saveEmploymentsList(next);
}


export type EmploymentPatch = Partial<Omit<Employment, 'id'>>;

/** Haengt eine neue Beschaeftigung an und gibt die gespeicherte Liste zurueck. */
export async function addEmployment(
  partial: EmploymentPatch = {},
): Promise<Employment[]> {
  const list = await getEmployments();
  const id = createEmploymentId();
  const newEmp = cleanEmployment({ ...defaultEmployment, ...partial, id });
  const next = [...list, newEmp];
  await saveEmploymentsList(next);
  return next;
}

/** Aendert nur die Beschaeftigung mit dieser ID; die id bleibt unveraenderlich. */
export async function updateEmployment(
  id: string,
  patch: EmploymentPatch,
): Promise<Employment[]> {
  const list = await getEmployments();
  const idx = list.findIndex((e) => e.id === id);
  if (idx === -1) {
    throw new Error('Beschaeftigung nicht gefunden: ' + id);
  }
  const merged = cleanEmployment({ ...list[idx], ...patch, id: list[idx].id });
  const next = [...list];
  next[idx] = merged;
  await saveEmploymentsList(next);
  return next;
}

export async function countEntriesOfEmployment(id: string): Promise<number> {
  return db.entries.where('employmentId').equals(id).count();
}

/**
 * Entfernt eine Beschaeftigung nur ohne haengende Zeiteintraege/Urlaubstage
 * und nur wenn mindestens eine Beschaeftigung bleibt.
 */
export async function removeEmployment(id: string): Promise<Employment[]> {
  const list = await getEmployments();
  const entryCount = await countEntriesOfEmployment(id);
  const vacations = await getVacationDays();
  const vacCount = vacations.filter((d) => d.employmentId === id).length;
  if (entryCount > 0) {
    throw new Error(
      'Loeschen nicht moeglich: ' +
        entryCount +
        ' Zeiteintrag(e) haengen an dieser Beschaeftigung.',
    );
  }
  if (vacCount > 0) {
    throw new Error(
      'Loeschen nicht moeglich: ' +
        vacCount +
        ' Urlaubstag(e) haengen an dieser Beschaeftigung.',
    );
  }
  if (list.length <= 1) {
    throw new Error(
      'Die letzte Beschaeftigung kann nicht geloescht werden.',
    );
  }
  await removeClockodoKey(id);
  await removeClockodoLists(id);
  const next = list.filter((e) => e.id !== id);
  await saveEmploymentsList(next);
  return next;
}

/**
 * Validiert + sortiert Urlaubstage; fehlende employmentId → emp-1. Doppelt ist
 * nur derselbe Tag derselben Beschaeftigung (der erste bleibt).
 */
export function cleanVacationDays(raw: unknown): VacationDay[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: VacationDay[] = [];
  for (const item of raw) {
    const x = (typeof item === 'object' && item !== null ? item : {}) as Record<
      string,
      unknown
    >;
    if (typeof x.date !== 'number' || !Number.isFinite(x.date)) continue;
    const employmentId =
      typeof x.employmentId === 'string' && x.employmentId.trim() !== ''
        ? x.employmentId
        : INITIAL_EMPLOYMENT_ID;
    const key = vacationDayKey(employmentId, x.date);
    if (seen.has(key)) continue;
    seen.add(key);
    const note = typeof x.note === 'string' ? x.note : '';
    const absence = cleanClockodoAbsenceRef(x.clockodoAbsence);
    if (absence) {
      out.push({ employmentId, date: x.date, note, clockodoAbsence: absence });
    } else {
      out.push({ employmentId, date: x.date, note });
    }
  }
  return out.sort((a, b) => a.date - b.date);
}

export async function getVacationDays(): Promise<VacationDay[]> {
  const { value } = await Preferences.get({ key: KEY_VAC });
  if (!value) return [];
  try {
    return cleanVacationDays(JSON.parse(value));
  } catch {
    return [];
  }
}

export async function saveVacationDays(days: VacationDay[]): Promise<void> {
  await Preferences.set({
    key: KEY_VAC,
    value: JSON.stringify(cleanVacationDays(days)),
  });
}

/** Traegt einen Urlaubstag ein; ein schon erfasster bleibt samt Notiz bestehen. */
export async function addVacationDay(
  date: number,
  note: string,
  employmentId: string,
): Promise<VacationDay[]> {
  const merged = mergeVacationDays(await getVacationDays(), [
    { date, note, employmentId },
  ]);
  await saveVacationDays(merged);
  return merged;
}


/** Vermerkt einen Clockodo-Antrag an den genannten Urlaubstagen einer Beschaeftigung. */
export async function setVacationAbsenceRef(
  employmentId: string,
  dates: readonly number[],
  ref: ClockodoAbsenceRef,
): Promise<VacationDay[]> {
  const next = applyAbsenceRef(await getVacationDays(), employmentId, dates, ref);
  await saveVacationDays(next);
  return next;
}

/** Entfernt einen Urlaubstag nur in der genannten Beschaeftigung. */
export async function removeVacationDay(
  date: number,
  employmentId: string,
): Promise<VacationDay[]> {
  const next = (await getVacationDays()).filter(
    (d) => !(d.date === date && d.employmentId === employmentId),
  );
  await saveVacationDays(next);
  return next;
}

/** Entfernt die Urlaubstage eines Clockodo-Antrags einer Beschaeftigung; liefert ihre Zahl. */
export async function removeVacationDaysOfAbsence(
  employmentId: string,
  absenceId: number,
): Promise<number> {
  const current = await getVacationDays();
  const drop = daysOfAbsence(current, employmentId, absenceId);
  if (drop.length === 0) return 0;
  const keys = new Set(drop.map((d) => `${d.employmentId} ${d.date}`));
  const next = current.filter((d) => !keys.has(`${d.employmentId} ${d.date}`));
  await saveVacationDays(next);
  return drop.length;
}

// --- React-Hooks ---

export function useEmployment(): {
  employment: Employment;
  loading: boolean;
  save: (e: Employment) => Promise<void>;
} {
  const [employment, setEmployment] = useState<Employment>(defaultEmployment);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getEmployment().then((e) => {
      if (active) {
        setEmployment(e);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const save = useCallback(async (e: Employment) => {
    await saveEmployment(e);
    setEmployment(e);
  }, []);

  return { employment, loading, save };
}

export function useEmployments(): {
  employments: Employment[];
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [employments, setEmployments] = useState<Employment[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const list = await getEmployments();
    setEmployments(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { employments, loading, refresh };
}


export function useVacationDays(): {
  days: VacationDay[];
  loading: boolean;
  refresh: () => Promise<void>;
  add: (date: number, note?: string, employmentId?: string) => Promise<void>;
  addMany: (dates: readonly number[], employmentId?: string) => Promise<number>;
  remove: (date: number, employmentId: string) => Promise<void>;
} {
  const [days, setDays] = useState<VacationDay[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const d = await getVacationDays();
    setDays(d);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(
    async (date: number, note = '', employmentId?: string) => {
      const eid =
        employmentId != null && employmentId !== ''
          ? employmentId
          : await getActiveEmploymentId();
      setDays(await addVacationDay(date, note, eid));
    },
    [],
  );

  const addMany = useCallback(async (dates: readonly number[], employmentId?: string) => {
    const eid =
      employmentId != null && employmentId !== ''
        ? employmentId
        : await getActiveEmploymentId();
    const current = await getVacationDays();
    const merged = mergeVacationDays(
      current,
      dates.map((date) => ({ date, note: '', employmentId: eid })),
    );
    await saveVacationDays(merged);
    setDays(merged);
    return merged.length - current.length;
  }, []);

  const remove = useCallback(async (date: number, employmentId: string) => {
    setDays(await removeVacationDay(date, employmentId));
  }, []);

  return { days, loading, refresh, add, addMany, remove };
}
