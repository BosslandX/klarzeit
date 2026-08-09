import { useRef, useState } from 'react';
import { format } from 'date-fns';
import { useProfile } from '../../db/profile';
import { useEmployment, useVacationDays } from '../../db/employment';
import type { Profile } from '../../domain/types';
import {
  annualVacationDays,
  fullMonthlyTargetMs,
  type Employment,
  type VacationYearMode,
} from '../../domain/employment';
import {
  decimalHours,
  formatDate,
  fromDateInput,
  HOUR,
} from '../../domain/time';
import {
  backupToJson,
  buildBackup,
  entriesToCsv,
  restoreBackup,
} from '../../db/backup';
import { clearAllEntries, getAllEntries, countEntries } from '../../db/entries';
import { shareTextFile } from '../../pdf/share';
import {
  checkForUpdate,
  downloadAndInstall,
  type UpdateInfo,
} from '../../update/updater';

const VACATION_MODE_LABELS: { value: VacationYearMode; label: string }[] = [
  { value: 'both', label: 'Beide (voll + anteilig)' },
  { value: 'full', label: 'Voller Jahresanspruch' },
  { value: 'prorata', label: 'Anteilig (Zwoelftelung)' },
];

const FIELDS: { key: keyof Profile; label: string; placeholder: string }[] = [
  { key: 'vorname', label: 'Vorname', placeholder: 'Max' },
  { key: 'nachname', label: 'Nachname', placeholder: 'Mustermann' },
  { key: 'personalnummer', label: 'Personalnummer / ID', placeholder: 'z.B. 10042' },
  { key: 'arbeitgeber', label: 'Arbeitgeber', placeholder: 'Firma GmbH' },
  { key: 'abteilung', label: 'Abteilung / Position', placeholder: 'Entwicklung' },
];

export function MoreScreen() {
  const { profile, loading, save } = useProfile();
  const [form, setForm] = useState<Profile | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateMsg, setUpdateMsg] = useState('');
  const [available, setAvailable] = useState<UpdateInfo | null>(null);
  const { employment, save: saveEmp } = useEmployment();
  const { days: vacDays, add: addVac, remove: removeVac } = useVacationDays();
  const [empForm, setEmpForm] = useState<Employment | null>(null);
  const [empFlash, setEmpFlash] = useState(false);
  const [newVacDate, setNewVacDate] = useState('');

  // Lokaler Formularzustand, initialisiert aus dem geladenen Profil.
  const current = form ?? profile;
  const setField = (key: keyof Profile, value: string) =>
    setForm({ ...(form ?? profile), [key]: value });

  // Lokaler Formularzustand fuer die Beschaeftigungsdaten.
  const emp = empForm ?? employment;
  const setEmpField = <K extends keyof Employment,>(key: K, value: Employment[K]) =>
    setEmpForm({ ...(empForm ?? employment), [key]: value });

  const handleSaveEmployment = async () => {
    await saveEmp(emp);
    setEmpForm(null);
    setEmpFlash(true);
    setTimeout(() => setEmpFlash(false), 1800);
  };

  const handleAddVacation = async () => {
    const t = fromDateInput(newVacDate);
    if (Number.isNaN(t)) return;
    await addVac(t);
    setNewVacDate('');
  };

  const handleSaveProfile = async () => {
    await save(current);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  };

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
      await shareTextFile(
        entriesToCsv(all),
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
    const ok = window.confirm(
      `ALLE ${n} Eintraege unwiderruflich loeschen? Vorher unbedingt ein Backup exportieren!`,
    );
    if (!ok) return;
    await clearAllEntries();
    window.alert('Alle Eintraege geloescht.');
  };

  const onCheckUpdate = async () => {
    setUpdateBusy(true);
    setUpdateMsg('');
    setAvailable(null);
    try {
      const info = await checkForUpdate();
      if (info) {
        setAvailable(info);
        setUpdateMsg(
          `Neue Version ${info.versionName} verfuegbar (installiert: ${info.currentVersionName}).`,
        );
      } else {
        setUpdateMsg('Du hast bereits die neueste Version.');
      }
    } catch (e) {
      setUpdateMsg(`Update-Pruefung fehlgeschlagen: ${msg(e)}`);
    } finally {
      setUpdateBusy(false);
    }
  };

  const onInstallUpdate = async () => {
    if (!available) return;
    setUpdateBusy(true);
    setUpdateMsg('Lade Update herunter …');
    try {
      await downloadAndInstall(available);
      setUpdateMsg('Installation gestartet – bitte den System-Dialog bestaetigen.');
    } catch (e) {
      setUpdateMsg(`Update fehlgeschlagen: ${msg(e)}`);
    } finally {
      setUpdateBusy(false);
    }
  };

  if (loading) return <div className="screen center muted">Lade…</div>;

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Mehr</h1>
      </header>

      <section className="card-section">
        <h2>Persoenliche Daten</h2>
        <p className="muted small">
          Wird im Report-Kopf ausgegeben, damit die Zeiterfassung der Person
          zugeordnet werden kann.
        </p>
        {FIELDS.map((f) => (
          <label key={f.key} className="field">
            <span>{f.label}</span>
            <input
              type="text"
              placeholder={f.placeholder}
              value={current[f.key]}
              onChange={(e) => setField(f.key, e.target.value)}
            />
          </label>
        ))}
        <button className="btn btn-primary" onClick={() => void handleSaveProfile()}>
          {savedFlash ? '✓ Gespeichert' : 'Profil speichern'}
        </button>
      </section>

      <section className="card-section">
        <h2>Beschaeftigung &amp; Arbeitszeitkonto</h2>
        <p className="muted small">
          Grundlage fuer den Soll/Ist-Saldo und den gesetzlichen Urlaub in den
          Monatsreports. Trage hier deine Vertragsdaten ein (Wochenstunden,
          Arbeitstage/Woche und Beginn). Wird lokal gespeichert.
        </p>
        <label className="field">
          <span>Beginn des Arbeitsverhaeltnisses</span>
          <input
            type="date"
            value={format(emp.startDate, 'yyyy-MM-dd')}
            onChange={(e) => {
              const t = fromDateInput(e.target.value);
              if (!Number.isNaN(t)) setEmpField('startDate', t);
            }}
          />
        </label>
        <label className="field">
          <span>Ende (befristet, optional)</span>
          <input
            type="date"
            value={emp.endDate != null ? format(emp.endDate, 'yyyy-MM-dd') : ''}
            onChange={(e) => {
              if (!e.target.value) {
                setEmpField('endDate', null);
                return;
              }
              const t = fromDateInput(e.target.value);
              if (!Number.isNaN(t)) setEmpField('endDate', t);
            }}
          />
        </label>
        <label className="field">
          <span>Wochenarbeitszeit (Stunden)</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            value={emp.weeklyHours}
            onChange={(e) => setEmpField('weeklyHours', Number(e.target.value) || 0)}
          />
        </label>
        <label className="field">
          <span>Arbeitstage pro Woche</span>
          <select
            value={emp.workdaysPerWeek}
            onChange={(e) => setEmpField('workdaysPerWeek', Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Urlaub im Eintrittsjahr ausweisen</span>
          <select
            value={emp.vacationYearMode}
            onChange={(e) =>
              setEmpField('vacationYearMode', e.target.value as VacationYearMode)
            }
          >
            {VACATION_MODE_LABELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Anfangssaldo (Stunden, +/-)</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.25"
            value={decimalHours(emp.openingBalanceMs)}
            onChange={(e) =>
              setEmpField(
                'openingBalanceMs',
                Math.round((Number(e.target.value) || 0) * HOUR),
              )
            }
          />
        </label>
        <p className="muted small">
          Monats-Soll:{' '}
          {decimalHours(fullMonthlyTargetMs(emp.weeklyHours))
            .toFixed(2)
            .replace('.', ',')}{' '}
          Std. · gesetzl. Urlaub: {annualVacationDays(emp.workdaysPerWeek)}{' '}
          Tage/Jahr (BUrlG).
        </p>
        <button className="btn btn-primary" onClick={() => void handleSaveEmployment()}>
          {empFlash ? '✓ Gespeichert' : 'Beschaeftigung speichern'}
        </button>

        <h3 className="sub-head">Genommene Urlaubstage</h3>
        <p className="muted small">
          Jeder Eintrag zaehlt als 1 Urlaubstag und mindert den Resturlaub des
          jeweiligen Jahres.
        </p>
        <div className="vac-add">
          <input
            type="date"
            value={newVacDate}
            onChange={(e) => setNewVacDate(e.target.value)}
          />
          <button
            className="btn"
            disabled={!newVacDate}
            onClick={() => void handleAddVacation()}
          >
            Urlaubstag hinzufuegen
          </button>
        </div>
        {vacDays.length === 0 ? (
          <p className="muted small">Noch keine Urlaubstage erfasst.</p>
        ) : (
          <ul className="vac-list">
            {vacDays.map((d) => (
              <li key={d.date}>
                <span>{formatDate(d.date)}</span>
                <button
                  className="link-btn danger"
                  onClick={() => void removeVac(d.date)}
                >
                  entfernen
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

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

      <section className="card-section">
        <h2>Datenschutz</h2>
        <p className="muted small">
          Diese App speichert deine personenbezogenen Daten und Arbeitszeiten
          nur lokal (Offline, kein Server, keine Cloud, keine Konten). Reports
          und Backups werden ausschliesslich dann weitergegeben, wenn du sie
          aktiv ueber die Teilen-Funktion versendest.
        </p>
      </section>

      <section className="card-section">
        <h2>App-Update</h2>
        <p className="muted small">
          Sucht auf dem Server nach einer neueren Version und installiert sie.
        </p>
        <button className="btn" onClick={onCheckUpdate} disabled={updateBusy}>
          Nach Update suchen
        </button>
        {available && (
          <button
            className="btn btn-primary"
            onClick={onInstallUpdate}
            disabled={updateBusy}
          >
            Update {available.versionName} installieren
          </button>
        )}
        {updateMsg && <p className="muted small">{updateMsg}</p>}
        {available?.notes && <p className="muted small">{available.notes}</p>}
      </section>

      <section className="card-section">
        <h2>Ueber</h2>
        <p className="muted small">
          Klarzeit 1.3 · Offline Single-User · Capacitor + React.
        </p>
      </section>
    </div>
  );
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
