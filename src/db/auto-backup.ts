import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { backupToJson, buildBackup, type BackupData } from './backup';

/**
 * Automatisches Backup in den OEFFENTLICHEN Documents-Ordner.
 *
 * Anders als der App-eigene Speicher (IndexedDB, Directory.Data/External)
 * ueberlebt Directory.Documents eine Deinstallation der App. Damit liegt nach
 * einer Neuinstallation eine Sicherung bereit, die wiederhergestellt werden kann.
 *
 * Hinweis Android 11+: Die App darf nur die von ihr selbst angelegten Dateien
 * lesen. Verliert sie nach einer Deinstallation den Besitz (Scoped Storage),
 * schlaegt das automatische Lesen fehl -> dann bleibt der manuelle Import der
 * sichtbaren Datei (Tab "Mehr") als verlaesslicher Rueckweg.
 */
const DIR = Directory.Documents;
const FOLDER = 'Klarzeit';
const FILE = `${FOLDER}/autobackup.json`;

function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/** Best-effort Storage-Permission (nur Android <= 10 noetig; 11+ permission-frei). */
async function ensurePermission(): Promise<void> {
  try {
    const status = await Filesystem.checkPermissions();
    if (status.publicStorage !== 'granted') {
      await Filesystem.requestPermissions();
    }
  } catch {
    // Auf Plattformen ohne publicStorage-Permission ist das ein No-op.
  }
}

/** Vollstaendiges Backup in den oeffentlichen Documents-Ordner schreiben. */
export async function writeAutoBackup(): Promise<void> {
  if (!isNative()) return;
  try {
    await ensurePermission();
    const json = backupToJson(await buildBackup());
    await Filesystem.writeFile({
      path: FILE,
      data: json,
      directory: DIR,
      encoding: Encoding.UTF8,
      recursive: true,
    });
  } catch {
    // Auto-Backup ist best-effort und darf den App-Betrieb nie stoeren.
  }
}

/** Liest das Auto-Backup, falls vorhanden und lesbar. Sonst null. */
export async function readAutoBackup(): Promise<BackupData | null> {
  if (!isNative()) return null;
  try {
    await ensurePermission();
    const res = await Filesystem.readFile({
      path: FILE,
      directory: DIR,
      encoding: Encoding.UTF8,
    });
    const text = typeof res.data === 'string' ? res.data : await res.data.text();
    const data = JSON.parse(text) as BackupData;
    if (data?.app !== 'zeiterfassung' || !Array.isArray(data.entries)) return null;
    return data;
  } catch {
    // Datei fehlt oder ist nach Neuinstallation nicht (mehr) lesbar.
    return null;
  }
}
