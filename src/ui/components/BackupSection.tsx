import { useRef, useState } from 'react';
import { format } from 'date-fns';
import { getEmployments } from '../../db/employment';
import type { Employment } from '../../domain/employment';
import {
  backupToJson,
  buildBackup,
  entriesToCsv,
  restoreBackup,
} from '../../db/backup';
import { clearAllEntries, getAllEntries, countEntries } from '../../db/entries';
import { shareTextFile } from '../../pdf/share';

/**
 * Daten-Backup: exportieren, importieren (zusammenfuehren oder ersetzen), alle Eintraege als CSV,
 * alle Eintraege loeschen (aus MoreScreen ausgelagert, AUF-043).
 */
export function BackupSection({ employments }: { employments: readonly Employment[] }) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const stamp = () => format(Date.now(), 'yyyy-MM-dd_HHmm');

  const exportJson = async () => {
    setBusy(true);
    try {
      const data = await buildBackup();
      await shareTextFile(
        backupToJson(data),
        `Klarzeit-Backup_${stamp()}.json`,
        'Klarzeit Backup',
        'application/json',
      );
    } catch (e) {
      window.alert(`Export fehlgeschlagen: ${msg(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const exportCsvAll = async () => {
    setBusy(true);
    try {
      const all = await getAllEntries();
      const employments = await getEmployments();
      await shareTextFile(
        entriesToCsv(all, employments),
        `Klarzeit-Alle_${stamp()}.csv`,
        'Klarzeit – alle Eintraege',
        'text/csv',
      );
    } catch (e) {
      window.alert(`CSV-Export fehlgeschlagen: ${msg(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // erlaubt erneuten Import derselben Datei
    if (!file) return;
    // Standardweg ist das sichere Zusammenfuehren. Das destruktive Ersetzen
    // erfordert eine zusaetzliche, ausdrueckliche Bestaetigung.
    const wantReplace = window.confirm(
      'Backup importieren.\n\nOK = vorhandene Daten ERSETZEN (alle aktuellen Eintraege werden geloescht)\nAbbrechen = ZUSAMMENFUEHREN (sicher, fuegt nur hinzu)',
    );
    let mode: 'merge' | 'replace' = 'merge';
    if (wantReplace) {
      const sure = window.confirm(
        'Wirklich ALLE aktuellen Eintraege durch das Backup ersetzen?\nDas kann nicht rueckgaengig gemacht werden.',
      );
      if (!sure) return;
      mode = 'replace';
    }
    setBusy(true);
    try {
      const text = await file.text();
      const count = await restoreBackup(text, mode);
      window.alert(`${count} Eintraege importiert.`);
    } catch (err) {
      window.alert(`Import fehlgeschlagen: ${msg(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const wipeAll = async () => {
    const n = await countEntries();
    const clockodoExtra = employments.some((e) => e.clockodo !== null)
      ? '\nAn Clockodo uebertragene Eintraege bleiben dort stehen.'
      : '';
    const ok = window.confirm(
      `ALLE ${n} Eintraege unwiderruflich loeschen? Vorher unbedingt ein Backup exportieren!${clockodoExtra}`,
    );
    if (!ok) return;
    await clearAllEntries();
    window.alert('Alle Eintraege geloescht.');
  };

  return (
    <section className="card-section">
      <h2>Daten-Backup</h2>
      <p className="muted small">
        Alle Daten liegen ausschliesslich lokal auf diesem Geraet. Exportiere
        regelmaessig ein Backup, um Datenverlust (z.B. bei Geraetewechsel) zu
        vermeiden.
      </p>
      <button className="btn btn-block" disabled={busy} onClick={() => void exportJson()}>
        Backup exportieren (JSON)
      </button>
      <button
        className="btn btn-block"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
      >
        Backup importieren …
      </button>
      <button className="btn btn-block" disabled={busy} onClick={() => void exportCsvAll()}>
        Alle Eintraege als CSV
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => void onImportFile(e)}
      />
      <button className="btn btn-block danger-outline" disabled={busy} onClick={() => void wipeAll()}>
        Alle Daten loeschen
      </button>
    </section>
  );
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
