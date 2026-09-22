import { getAllEntries } from './entries';
import { db } from './db';
import { getProfile, hasUsableProfile, saveProfile, emptyProfile } from './profile';
import {
  cleanEmployment,
  cleanVacationDays,
  getActiveEmploymentId,
  getEmployments,
  getVacationDays,
  hasEmploymentsListStored,
  hasLegacyEmploymentStored,
  hasUsableEmployment,
  INITIAL_EMPLOYMENT_ID,
  replaceEmployments,
  saveEmployment,
  saveVacationDays,
  setActiveEmployment,
} from './employment';
import type { Profile, TimeEntry } from '../domain/types';
import { mergeVacationDays } from '../domain/employment';
import type { Employment, VacationDay } from '../domain/employment';
import { decimalHours, formatClock, formatDate, netMs } from '../domain/time';

export interface BackupData {
  /**
   * Format-Kennung, KEIN Produktname. Sie bleibt beim Rebranding auf "Klarzeit"
   * bewusst unveraendert: aeltere Backups (auch die aus der Vorgaengerversion mit
   * anderer App-ID) muessen importierbar bleiben, sonst gehen beim Umstieg alle
   * erfassten Zeiten verloren.
   */
  app: 'zeiterfassung';
  version: 1 | 2 | 3;
  exportedAt: number;
  profile: Profile;
  entries: TimeEntry[];
  employment?: Employment;
  vacations?: VacationDay[];
  employments?: Employment[];
  activeEmployment?: string;
}

export async function buildBackup(): Promise<BackupData> {
  const [profile, entries, employments, activeEmployment, vacations] =
    await Promise.all([
      getProfile(),
      getAllEntries(),
      getEmployments(),
      getActiveEmploymentId(),
      getVacationDays(),
    ]);
  return {
    app: 'zeiterfassung',
    version: 3,
    exportedAt: Date.now(),
    profile,
    entries,
    employments,
    activeEmployment,
    vacations,
  };
}

export function backupToJson(data: BackupData): string {
  return JSON.stringify(data, null, 2);
}

export type RestoreMode = 'merge' | 'replace';

function isValidEntry(e: unknown): e is TimeEntry {
  if (typeof e !== 'object' || e === null) return false;
  const x = e as Record<string, unknown>;
  return (
    typeof x.start === 'number' &&
    Number.isFinite(x.start) &&
    typeof x.end === 'number' &&
    Number.isFinite(x.end) &&
    x.end > x.start &&
    typeof x.breakMinutes === 'number' &&
    x.breakMinutes >= 0 &&
    typeof x.activity === 'string' &&
    typeof x.note === 'string' &&
    (x.source === 'tracked' || x.source === 'manual') &&
    typeof x.createdAt === 'number' &&
    typeof x.updatedAt === 'number' &&
    (x.id === undefined || (typeof x.id === 'number' && Number.isInteger(x.id)))
  );
}

function cleanEntry(e: TimeEntry): TimeEntry {
  const employmentId =
    typeof e.employmentId === 'string' && e.employmentId.trim() !== ''
      ? e.employmentId
      : INITIAL_EMPLOYMENT_ID;
  return {
    id: e.id,
    employmentId,
    start: e.start,
    end: e.end,
    breakMinutes: e.breakMinutes,
    activity: e.activity,
    note: e.note,
    source: e.source,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

function cleanProfile(p: unknown): Profile {
  const x = (typeof p === 'object' && p !== null ? p : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    ...emptyProfile,
    vorname: str(x.vorname),
    nachname: str(x.nachname),
    personalnummer: str(x.personalnummer),
    arbeitgeber: str(x.arbeitgeber),
    abteilung: str(x.abteilung),
  };
}

function employmentFromProfile(
  profile: Profile,
  contract?: Employment,
): Employment {
  const base = contract
    ? cleanEmployment(contract)
    : cleanEmployment({ id: INITIAL_EMPLOYMENT_ID });
  const displayName = profile.arbeitgeber.trim() || 'Beschäftigung 1';
  return {
    ...base,
    id: INITIAL_EMPLOYMENT_ID,
    name: displayName,
    arbeitgeber: profile.arbeitgeber,
    personalnummer: profile.personalnummer,
    abteilung: profile.abteilung,
  };
}

function employmentFromLegacyBackup(data: BackupData): Employment {
  const profile = cleanProfile(data.profile);
  const contract = data.employment
    ? cleanEmployment(data.employment)
    : undefined;
  return employmentFromProfile(profile, contract);
}

export function mergeEmployments(
  existing: readonly Employment[],
  incoming: readonly Employment[],
): Employment[] {
  const localIds = new Set(existing.map((e) => e.id));
  const added = incoming
    .filter((e) => !localIds.has(e.id))
    .map((e) => cleanEmployment(e));
  return [...existing.map((e) => cleanEmployment(e)), ...added];
}

async function applyActiveEmploymentFromBackup(
  activeId: string | undefined,
  employments: Employment[],
): Promise<void> {
  if (typeof activeId !== 'string' || activeId === '') return;
  if (!employments.some((e) => e.id === activeId)) return;
  try {
    await setActiveEmployment(activeId);
  } catch {
    /* getActiveEmploymentId faellt auf erste Beschaeftigung zurueck */
  }
}

async function restoreEmployments(
  data: BackupData,
  mode: RestoreMode,
): Promise<void> {
  if (data.version === 3 && Array.isArray(data.employments)) {
    const incoming = data.employments.map((e) => cleanEmployment(e));
    if (mode === 'replace') {
      await replaceEmployments(incoming);
      await applyActiveEmploymentFromBackup(data.activeEmployment, incoming);
      return;
    }
    const local = await getEmployments();
    await replaceEmployments(mergeEmployments(local, incoming));
    return;
  }

  const single = employmentFromLegacyBackup(data);
  if (mode === 'replace') {
    await replaceEmployments([single]);
    return;
  }

  const hasLocal =
    (await hasEmploymentsListStored()) || (await hasLegacyEmploymentStored());
  if (!hasLocal) {
    await replaceEmployments([single]);
    return;
  }

  if (data.employment && !(await hasUsableEmployment())) {
    await saveEmployment(cleanEmployment(data.employment));
  }
}

export async function restoreBackup(
  json: string,
  mode: RestoreMode,
): Promise<number> {
  let data: BackupData;
  try {
    data = JSON.parse(json) as BackupData;
  } catch {
    throw new Error('Datei ist kein gueltiges JSON.');
  }
  if (data?.app !== 'zeiterfassung' || !Array.isArray(data.entries)) {
    throw new Error('Keine gueltige Zeiterfassung-Backup-Datei.');
  }
  if (data.version !== 1 && data.version !== 2 && data.version !== 3) {
    throw new Error('Nicht unterstuetzte Backup-Version.');
  }
  if (!data.entries.every(isValidEntry)) {
    throw new Error('Backup enthaelt ungueltige Eintraege.');
  }

  const entries: TimeEntry[] = data.entries.map((e) => {
    const clean = cleanEntry(e as TimeEntry);
    return mode === 'merge' ? { ...clean, id: undefined } : clean;
  });

  await db.transaction('rw', db.entries, async () => {
    if (mode === 'replace') {
      await db.entries.clear();
    }
    await db.entries.bulkPut(entries);
  });

  if (data.profile && (mode === 'replace' || !(await hasUsableProfile()))) {
    await saveProfile(cleanProfile(data.profile));
  }

  await restoreEmployments(data, mode);

  if (Array.isArray(data.vacations)) {
    const incoming = cleanVacationDays(data.vacations);
    await saveVacationDays(
      mode === 'merge'
        ? mergeVacationDays(await getVacationDays(), incoming)
        : incoming,
    );
  }
  return entries.length;
}

function csvCell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  if (/[";\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function employmentNameForCsv(
  employmentId: string,
  employments?: readonly Employment[],
): string {
  if (employments) {
    const hit = employments.find((e) => e.id === employmentId);
    if (hit) return hit.name;
  }
  return employmentId;
}

export function entriesToCsv(
  entries: TimeEntry[],
  employments?: readonly Employment[],
): string {
  const header = [
    'Datum',
    'Start',
    'Ende',
    'Pause_min',
    'Dauer_h',
    'Quelle',
    'Beschaeftigung',
    'Taetigkeit',
    'Notiz',
  ];
  const lines = [header.join(';')];
  for (const e of entries) {
    lines.push(
      [
        formatDate(e.start),
        formatClock(e.start),
        formatClock(e.end),
        e.breakMinutes,
        decimalHours(netMs(e)).toFixed(2).replace('.', ','),
        e.source === 'manual' ? 'manuell' : 'erfasst',
        employmentNameForCsv(e.employmentId, employments),
        e.activity,
        e.note,
      ]
        .map(csvCell)
        .join(';'),
    );
  }
  return lines.join('\r\n');
}
