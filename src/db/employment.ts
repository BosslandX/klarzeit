import { Preferences } from '@capacitor/preferences';
import { useCallback, useEffect, useState } from 'react';
import {
  defaultEmployment,
  type Employment,
  type VacationDay,
  type VacationYearMode,
} from '../domain/employment';

const KEY_EMP = 'employment';
const KEY_VAC = 'vacations';

const VALID_MODES: VacationYearMode[] = ['full', 'prorata', 'both'];

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
  // Pflichtwerte plausibilisieren (System-Grenze: Backup-Datei UND Formular):
  // Wochenstunden > 0, Arbeitstage ganzzahlig 1..6 (Werktage-Basis des Urlaubs).
  const weeklyRaw = num(x.weeklyHours, defaultEmployment.weeklyHours);
  const weeklyHours = weeklyRaw > 0 ? weeklyRaw : defaultEmployment.weeklyHours;
  const wdRaw = Math.round(num(x.workdaysPerWeek, defaultEmployment.workdaysPerWeek));
  const workdaysPerWeek = Math.min(6, Math.max(1, wdRaw));
  return {
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

export async function getEmployment(): Promise<Employment> {
  const { value } = await Preferences.get({ key: KEY_EMP });
  if (!value) return defaultEmployment;
  try {
    return cleanEmployment(JSON.parse(value));
  } catch {
    return defaultEmployment;
  }
}

export async function saveEmployment(emp: Employment): Promise<void> {
  // Ueber cleanEmployment normalisieren, damit nie degenerierte Werte (z.B.
  // weeklyHours 0) persistiert werden — egal ob aus Formular oder Restore.
  await Preferences.set({
    key: KEY_EMP,
    value: JSON.stringify(cleanEmployment(emp)),
  });
}

/** Validiert + sortiert eine Urlaubstage-Liste (aufsteigend nach Datum, dedupliziert). */
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
    out.push({ date: x.date, note: typeof x.note === 'string' ? x.note : '' });
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
    const next = await getVacationDays();
    if (!next.some((d) => d.date === date)) next.push({ date, note });
    const cleaned = cleanVacationDays(next);
    await saveVacationDays(cleaned);
    setDays(cleaned);
  }, []);

  const remove = useCallback(async (date: number) => {
    const next = (await getVacationDays()).filter((d) => d.date !== date);
    await saveVacationDays(next);
    setDays(next);
  }, []);

  return { days, loading, add, remove };
}
