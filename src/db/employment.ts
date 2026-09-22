import { Preferences } from '@capacitor/preferences';
import { useCallback, useEffect, useState } from 'react';
import {
  defaultEmployment,
  mergeVacationDays,
  type Employment,
  type VacationDay,
  type VacationYearMode,
} from '../domain/employment';
import { getProfile } from './profile';

const KEY_EMP = 'employment';
const KEY_EMPLOYMENTS = 'employments';
const KEY_VAC = 'vacations';

export const INITIAL_EMPLOYMENT_ID = 'emp-1';

const VALID_MODES: VacationYearMode[] = ['full', 'prorata', 'both'];

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
  };
}

async function saveEmploymentsList(list: Employment[]): Promise<void> {
  await Preferences.set({
    key: KEY_EMPLOYMENTS,
    value: JSON.stringify(list.map(cleanEmployment)),
  });
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
  return list[0]?.id ?? INITIAL_EMPLOYMENT_ID;
}

export async function hasUsableEmployment(): Promise<boolean> {
  const emp = await getEmployment();
  return emp.weeklyHours > 0;
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

/** Validiert + sortiert Urlaubstage; fehlende employmentId → emp-1. */
export function cleanVacationDays(raw: unknown): VacationDay[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const out: VacationDay[] = [];
  for (const item of raw) {
    const x = (typeof item === 'object' && item !== null ? item : {}) as Record<
      string,
      unknown
    >;
    if (typeof x.date !== 'number' || !Number.isFinite(x.date)) continue;
    if (seen.has(x.date)) continue;
    seen.add(x.date);
    const employmentId =
      typeof x.employmentId === 'string' && x.employmentId.trim() !== ''
        ? x.employmentId
        : INITIAL_EMPLOYMENT_ID;
    out.push({
      employmentId,
      date: x.date,
      note: typeof x.note === 'string' ? x.note : '',
    });
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

export function useVacationDays(): {
  days: VacationDay[];
  loading: boolean;
  add: (date: number, note?: string) => Promise<void>;
  addMany: (dates: readonly number[]) => Promise<number>;
  remove: (date: number) => Promise<void>;
} {
  const [days, setDays] = useState<VacationDay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getVacationDays().then((d) => {
      if (active) {
        setDays(d);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const add = useCallback(async (date: number, note = '') => {
    const employmentId = await getActiveEmploymentId();
    const next = await getVacationDays();
    if (!next.some((d) => d.date === date)) {
      next.push({ date, note, employmentId });
    }
    const cleaned = cleanVacationDays(next);
    await saveVacationDays(cleaned);
    setDays(cleaned);
  }, []);

  const addMany = useCallback(async (dates: readonly number[]) => {
    const employmentId = await getActiveEmploymentId();
    const current = await getVacationDays();
    const merged = mergeVacationDays(
      current,
      dates.map((date) => ({ date, note: '', employmentId })),
    );
    await saveVacationDays(merged);
    setDays(merged);
    return merged.length - current.length;
  }, []);

  const remove = useCallback(async (date: number) => {
    const next = (await getVacationDays()).filter((d) => d.date !== date);
    await saveVacationDays(next);
    setDays(next);
  }, []);

  return { days, loading, add, addMany, remove };
}
