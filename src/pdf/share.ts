import type { jsPDF } from 'jspdf';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

function browserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * PDF erzeugen, auf dem Geraet ablegen und ueber das System-Share-Sheet teilen
 * (z.B. an Gmail/Outlook als Anhang). Im Browser: Download.
 */
export async function sharePdf(
  doc: jsPDF,
  filename: string,
  title: string,
): Promise<void> {
  if (!isNative()) {
    doc.save(filename);
    return;
  }
  // datauristring -> "data:application/pdf;...;base64,<DATA>"
  const dataUri = doc.output('datauristring');
  const base64 = dataUri.substring(dataUri.indexOf(',') + 1);

  const written = await Filesystem.writeFile({
    path: filename,
    data: base64,
    directory: Directory.Cache,
  });

  await Share.share({
    title,
    text: title,
    url: written.uri,
    dialogTitle: 'Report teilen / per E-Mail senden',
  });
}

/**
 * Text-Datei (JSON/CSV) teilen bzw. im Browser herunterladen.
 */
export async function shareTextFile(
  content: string,
  filename: string,
  title: string,
  mime = 'text/plain',
): Promise<void> {
  if (!isNative()) {
    browserDownload(new Blob([content], { type: mime }), filename);
    return;
  }
  const written = await Filesystem.writeFile({
    path: filename,
    data: content,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  await Share.share({
    title,
    text: title,
    url: written.uri,
    dialogTitle: title,
  });
}
