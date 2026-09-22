import { getAllEntries } from './entries';
import { db } from './db';
import { getProfile, hasUsableProfile, saveProfile, emptyProfile } from './profile';
import {
  cleanEmployment,
  cleanVacationDays,
  getEmployment,
  getVacationDays,
  hasUsableEmployment,
  saveEmployment,
  saveVacationDays,
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
  version: 1 | 2;
  exportedAt: number;
  profile: Profile;
  entries: TimeEntry[];
  // Ab Version 2: Vertragsdaten + genommene Urlaubstage.
  employment?: Employment;
  vacations?: VacationDay[];
}

export async function buildBackup(): Promise<BackupData> {
  const [profile, entries, employment, vacations] = await Promise.all([
    getProfile(),
    getAllEntries(),
    getEmployment(),
    getVacationDays(),
  ]);
  return {
    app: 'zeiterfassung',
    version: 2,
    exportedAt: Date.now(),
    profile,
    entries,
    employment,
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

/** Uebernimmt nur bekannte Felder (verhindert, dass Datenmuell in die DB wandert). */
function cleanEntry(e: TimeEntry): TimeEntry {
  const employmentId =
    typeof e.employmentId === 'string' && e.employmentId.trim() !== ''
      ? e.employmentId
      : 'emp-1';
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

/**
 * Stellt ein Backup wieder her.
 * - replace: vorhandene Daten loeschen, IDs des Backups uebernehmen. Profil,
 *   Vertragsdaten und Urlaubstage werden durch die des Backups ersetzt.
 * - merge: Backup-Eintraege als neue Datensaetze hinzufuegen (IDs neu vergeben).
 *   Merge heisst ueberall "fuegt nur hinzu": Urlaubstage werden vereinigt (bei
 *   gleichem Datum gewinnt der vorhandene Tag), Profil und Vertragsdaten werden
 *   nur uebernommen, wenn lokal noch keine gespeichert sind. Andernfalls wuerde
 *   ein aelteres Backup still die aktuellen Stammdaten und alle seither
 *   erfassten Urlaubstage loeschen.
 *
 * Validierung erfolgt VOR jeglichem Schreiben/Loeschen. clear() und bulkPut()
 * laufen in EINER Dexie-Transaktion, damit bei einem Fehler nichts verloren geht
 * (automatischer Rollback). Gibt die Anzahl importierter Eintraege zurueck.
 */
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
  if (data.version !== 1 && data.version !== 2) {
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

  // Stammdaten sind Einzelwerte, kein Anhaengen moeglich: im Merge-Modus daher
  // nur uebernehmen, wenn lokal noch nichts Brauchbares hinterlegt ist
  // (Erstimport auf ein leeres Geraet). Ausgefuellte Angaben bleiben unangetastet.
  if (data.profile && (mode === 'replace' || !(await hasUsableProfile()))) {
    await saveProfile(cleanProfile(data.profile));
  }
  // Ab Version 2: Vertragsdaten + Urlaubstage (validiert) uebernehmen.
  if (data.employment && (mode === 'replace' || !(await hasUsableEmployment()))) {
    await saveEmployment(cleanEmployment(data.employment));
  }
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
  // Schutz vor CSV-/Formel-Injection: fuehrendes Sonderzeichen entschaerfen.
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  if (/[";\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** CSV-Export (Semikolon-getrennt, fuer deutsches Excel). */
export function entriesToCsv(entries: TimeEntry[]): string {
  const header = [
    'Datum',
    'Start',
    'Ende',
    'Pause_min',
    'Dauer_h',
    'Quelle',
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
        e.activity,
        e.note,
      ]
        .map(csvCell)
        .join(';'),
    );
  }
  return lines.join('\r\n');
}
