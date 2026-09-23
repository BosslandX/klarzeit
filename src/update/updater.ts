import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Directory, Filesystem } from '@capacitor/filesystem';

/**
 * Self-hosted In-App-Update ueber GitHub Releases (wie apps/regelexperte).
 *
 * Ablauf:
 *  1. version.json vom neuesten GitHub-Release laden und versionCode vergleichen.
 *  2. Ist eine neuere Version da: APK (Release-Asset) in den Cache herunterladen.
 *  3. System-Installer ueber das native ApkInstaller-Plugin oeffnen.
 *
 * Voraussetzung: gleiche App-ID und gleicher Signatur-Keystore wie die
 * installierte App, sonst verweigert Android das Update.
 */

interface ApkInstallerPlugin {
  install(options: { path: string }): Promise<void>;
}
const ApkInstaller = registerPlugin<ApkInstallerPlugin>('ApkInstaller');

// Bezug ueber ein eigenes, OEFFENTLICHES Release-Repo, das nur APK und
// version.json traegt (kein Quellcode). Das Code-Repo BosslandX/klarzeit ist
// privat und liefert unauthentifiziert 404 – CapacitorHttp schickt kein Token.
// Die "latest/download"-URL zeigt stabil auf das jeweils neueste Release-Asset –
// kein API-Rate-Limit, kein eigener Server noetig.
const GH_OWNER = 'BosslandX';
const GH_REPO = 'klarzeit-releases';
export const UPDATE_MANIFEST_URL = `https://github.com/${GH_OWNER}/${GH_REPO}/releases/latest/download/version.json`;

/** Inhalt der serverseitigen version.json. */
export interface RemoteVersion {
  versionCode: number; // muss zur build.gradle versionCode passen (monoton steigend)
  versionName: string; // Anzeigename, z.B. "1.2"
  url: string; // Direktlink zur APK (HTTPS)
  notes?: string; // optionaler Changelog-Text
}

export interface UpdateInfo extends RemoteVersion {
  currentVersionName: string;
}

function isRemoteVersion(value: unknown): value is RemoteVersion {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.versionCode === 'number' &&
    Number.isFinite(v.versionCode) &&
    typeof v.versionName === 'string' &&
    typeof v.url === 'string' &&
    v.url.startsWith('https://')
  );
}

/**
 * Prueft auf eine neuere Version. Gibt UpdateInfo zurueck, wenn eine bereitsteht,
 * sonst null. Wirft bei Netzwerk-/Formatfehlern (vom Aufrufer zu behandeln).
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!Capacitor.isNativePlatform()) return null;
  // Nativer HTTP-Request statt WebView-fetch: GitHubs Release-Asset-Server
  // (release-assets.githubusercontent.com) sendet keine CORS-Header, ein
  // fetch() aus der WebView scheitert daher mit "Failed to fetch".
  const res = await CapacitorHttp.get({
    url: UPDATE_MANIFEST_URL,
    headers: { 'Cache-Control': 'no-cache' },
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Server antwortete mit Status ${res.status}.`);
  }
  const remote: unknown =
    typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  if (!isRemoteVersion(remote)) {
    throw new Error('version.json hat ein ungueltiges Format.');
  }
  const info = await CapApp.getInfo();
  const current = Number(info.build); // build = versionCode auf Android
  if (!Number.isFinite(current) || remote.versionCode <= current) return null;
  return { ...remote, currentVersionName: info.version };
}

/** Laedt die APK herunter und oeffnet den System-Installer. */
export async function downloadAndInstall(remote: RemoteVersion): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Update ist nur in der Android-App moeglich.');
  }
  const result = await Filesystem.downloadFile({
    url: remote.url,
    path: 'update.apk',
    directory: Directory.Cache,
  });
  if (!result.path) throw new Error('Download fehlgeschlagen.');
  await ApkInstaller.install({ path: result.path });
}
