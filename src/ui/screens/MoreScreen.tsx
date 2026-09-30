import { useRef, useState } from 'react';
import { differenceInCalendarDays, format } from 'date-fns';
import { useProfile } from '../../db/profile';
import {
  getEmployments,
  addEmployment,
  removeEmployment,
  updateEmployment,
  useEmployments,
  useVacationDays,
} from '../../db/employment';

import type { Profile } from '../../domain/types';
import {
  annualEntitlement,
  dailyTargetMs,
  fullMonthlyTargetMs,
  workdaysInRange,
  type Employment,
  type VacationYearMode,
} from '../../domain/employment';
import {
  decimalHours,
  formatDateWithWeekday,
  formatDays,
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
import { ClockodoSettings } from '../components/ClockodoSettings';
import { removeClockodoKey } from '../../clockodo/key-store';
import { removeClockodoLists } from '../../db/clockodo-lists';
import {
  checkForUpdate,
  downloadAndInstall,
  type UpdateInfo,
} from '../../update/updater';

/**
 * Groesster am Stueck eintragbarer Urlaubszeitraum (Kalendertage). Ein Jahr ist
 * mehr als jeder reale Urlaub; die Grenze verhindert, dass ein Vertipper im
 * Jahresfeld die Vorschau ueber Hunderttausende Tage rechnen laesst.
 */
const MAX_VACATION_RANGE_DAYS = 366;

const VACATION_MODE_LABELS: { value: VacationYearMode; label: string }[] = [
  { value: 'both', label: 'Beide (voll + anteilig)' },
  { value: 'full', label: 'Voller Jahresanspruch' },
  { value: 'prorata', label: 'Anteilig (Zwoelftelung)' },
];

const FIELDS: { key: keyof Profile; label: string; placeholder: string }[] = [
  { key: 'vorname', label: 'Vorname', placeholder: 'Max' },
  { key: 'nachname', label: 'Nachname', placeholder: 'Mustermann' },
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
  const {
    employments,
    loading: empListLoading,
    refresh: refreshEmps,
  } = useEmployments();
  const {
    days: vacDays,
    add: addVac,
    addMany: addVacMany,
    remove: removeVac,
  } = useVacationDays();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Employment | null>(null);
  const [empFlash, setEmpFlash] = useState(false);
  const [vacEmpId, setVacEmpId] = useState('');
  const [newVacDate, setNewVacDate] = useState('');
  const [vacFrom, setVacFrom] = useState('');
  const [vacTo, setVacTo] = useState('');
  const [vacRangeMsg, setVacRangeMsg] = useState('');

  // Lokaler Formularzustand, initialisiert aus dem geladenen Profil.
  const current = form ?? profile;
  const setField = (key: keyof Profile, value: string) =>
    setForm({ ...(form ?? profile), [key]: value });

  const vacTargetId =
    vacEmpId || employments[0]?.id || '';
  const vacEmp =
    employments.find((e) => e.id === vacTargetId) ?? employments[0];
  const emp = editDraft ?? vacEmp;
  const setEmpField = <K extends keyof Employment,>(key: K, value: Employment[K]) => {
    if (!editDraft) return;
    setEditDraft({ ...editDraft, [key]: value });
  };

  const empLabel = (id: string) =>
    employments.find((e) => e.id === id)?.name ?? id;

  const openEdit = (e: Employment) => {
    setEditingId(e.id);
    setEditDraft({ ...e });
  };

  const closeEdit = () => {
    setEditingId(null);
    setEditDraft(null);
  };

  const handleAddEmployment = async () => {
    const list = await addEmployment({
      name: 'Beschaeftigung ' + (employments.length + 1),
    });
    await refreshEmps();
    const newest = list[list.length - 1];
    openEdit(newest);
  };

  const handleSaveEmployment = async () => {
    if (!editingId || !editDraft) return;
    const { id: _omit, ...patch } = editDraft;
    const vorher = employments.find((e) => e.id === editingId);
    await updateEmployment(editingId, patch);
    if (vorher?.clockodo && patch.clockodo === null) {
      await removeClockodoKey(editingId);
      await removeClockodoLists(editingId);
    }
    await refreshEmps();
    closeEdit();
    setEmpFlash(true);
    setTimeout(() => setEmpFlash(false), 1800);
  };

  const handleDeleteEmployment = async () => {
    if (!editingId) return;
    const ok = window.confirm(
      'Diese Beschaeftigung wirklich loeschen? Zeiteintraege und Urlaubstage muessen vorher entfernt sein.',
    );
    if (!ok) return;
    try {
      await removeEmployment(editingId);
      await refreshEmps();
      closeEdit();
    } catch (e) {
      window.alert(msg(e));
    }
  };

  const handleAddVacation = async () => {
    const t = fromDateInput(newVacDate);
    if (Number.isNaN(t) || !vacTargetId) return;
    await addVac(t, '', vacTargetId);
    setNewVacDate('');
  };

  // Zweiter Erfassungsweg: ganzer Zeitraum statt Einzeltag. Die Vorschau wird
  // bei jeder Eingabe neu berechnet, damit vor dem Klick sichtbar ist, wie
  // viele Tage tatsaechlich eingetragen werden. Die Obergrenze schuetzt den
  // Render-Pfad: ein <input type="date"> laesst Jahreszahlen bis 275760 zu, und
  // workdaysInRange legt pro Kalendertag ein Date-Objekt an.
  const rangeSpanDays =
    Number.isNaN(fromDateInput(vacFrom)) || Number.isNaN(fromDateInput(vacTo))
      ? 0
      : differenceInCalendarDays(fromDateInput(vacTo), fromDateInput(vacFrom)) + 1;
  const rangeTooLong = rangeSpanDays > MAX_VACATION_RANGE_DAYS;
  const rangeDays =
    rangeSpanDays <= 0 || rangeTooLong
      ? []
      : workdaysInRange(
          fromDateInput(vacFrom),
          fromDateInput(vacTo),
          vacEmp != null ? vacEmp.workdaysPerWeek : 5,
        );

  const handleAddVacationRange = async () => {
    if (rangeDays.length === 0) return;
    const added = await addVacMany(rangeDays, vacTargetId);
    const skipped = rangeDays.length - added;
    setVacFrom('');
    setVacTo('');
    // Inline statt window.alert: die neuen Tage stehen sofort in der Liste
    // darunter, die Meldung ergaenzt nur, was uebersprungen wurde.
    setVacRangeMsg(
      `${added} Urlaubstag(e) eingetragen` +
        (skipped > 0 ? `, ${skipped} war(en) bereits erfasst` : '') +
        '.',
    );
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

  if (loading || empListLoading) return <div className="screen center muted">Lade…</div>;

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
          Grundlage fuer den Soll/Ist-Saldo und den Urlaubsanspruch in den
          Monatsreports. Mehrere Beschaeftigungen sind moeglich; je Eintrag
          Vertragsdaten pflegen. Wird lokal gespeichert.
        </p>

        <h3 className="sub-head">Deine Beschaeftigungen</h3>
        {employments.length === 0 ? (
          <p className="muted small">Noch keine Beschaeftigung angelegt.</p>
        ) : (
          <ul className="vac-list">
            {employments.map((e) => (
              <li key={e.id}>
                <span>
                  <strong>{e.name}</strong>
                  {e.arbeitgeber ? ' — ' + e.arbeitgeber : ''}
                  {' — '}
                  {e.weeklyHours} Std./Woche
                </span>
                <button className="link-btn" type="button" onClick={() => openEdit(e)}>
                  bearbeiten
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          className="btn btn-block"
          type="button"
          onClick={() => void handleAddEmployment()}
        >
          Weitere Beschaeftigung anlegen
        </button>

        {editingId && editDraft && (
          <div className="emp-edit">
            <h3 className="sub-head">Beschaeftigung bearbeiten</h3>
            <label className="field">
              <span>Anzeigename</span>
              <input
                type="text"
                value={editDraft.name}
                onChange={(ev) => setEmpField('name', ev.target.value)}
              />
            </label>
            <label className="field">
              <span>Arbeitgeber</span>
              <input
                type="text"
                value={editDraft.arbeitgeber}
                onChange={(ev) => setEmpField('arbeitgeber', ev.target.value)}
              />
            </label>
            <label className="field">
              <span>Personalnummer / ID</span>
              <input
                type="text"
                value={editDraft.personalnummer}
                onChange={(ev) => setEmpField('personalnummer', ev.target.value)}
              />
            </label>
            <label className="field">
              <span>Abteilung / Position</span>
              <input
                type="text"
                value={editDraft.abteilung}
                onChange={(ev) => setEmpField('abteilung', ev.target.value)}
              />
            </label>
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
          <span>Urlaubsanspruch laut Vertrag (Tage/Jahr)</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.5"
            min="0"
            placeholder={`leer = gesetzlich (${annualEntitlement(emp).statutory})`}
            value={emp.contractVacationDays ?? ''}
            onChange={(e) => {
              const raw = e.target.value.trim();
              if (raw === '') {
                setEmpField('contractVacationDays', null);
                return;
              }
              const n = Number(raw);
              setEmpField(
                'contractVacationDays',
                Number.isFinite(n) && n > 0 ? n : null,
              );
            }}
          />
        </label>
        {emp.contractVacationDays != null && !annualEntitlement(emp).fromContract && (
          <p className="muted small">
            Unter dem gesetzlichen Minimum ({annualEntitlement(emp).statutory} Tage/Jahr)
            gilt der gesetzliche Urlaubsanspruch.
          </p>
        )}
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
        <label className="field">
          <span>Mit dem Gehalt abgegoltene Ueberstunden (Std./Monat)</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.5"
            min="0"
            placeholder="leer = keine"
            value={emp.includedOvertimeHoursPerMonth ?? ''}
            onChange={(e) => {
              const raw = e.target.value.trim();
              if (raw === '') {
                setEmpField('includedOvertimeHoursPerMonth', null);
                return;
              }
              const n = Number(raw);
              setEmpField(
                'includedOvertimeHoursPerMonth',
                Number.isFinite(n) && n > 0 ? n : null,
              );
            }}
          />
        </label>
        <p className="muted small">
          Ueberstunden bis zu dieser Zahl je Monat sind mit dem Gehalt abgegolten
          und zaehlen nicht ins Arbeitszeitkonto. Minusstunden aus Vormonaten
          werden damit nicht verrechnet; im Eintritts- und Austrittsmonat gilt die
          Zahl anteilig.
        </p>
        {editingId && editDraft && (
          <ClockodoSettings
            employmentId={editingId}
            value={editDraft.clockodo}
            onChange={(next) => setEmpField('clockodo', next)}
          />
        )}
        <p className="muted small">
          Monats-Soll:{' '}
          {decimalHours(fullMonthlyTargetMs(emp.weeklyHours))
            .toFixed(2)
            .replace('.', ',')}{' '}
          Std. ·{' '}
          {emp.contractVacationDays != null
            ? `Vertrag: ${formatDays(emp.contractVacationDays)}/Jahr · gesetzl. Minimum: ${annualEntitlement(emp).statutory} Tage/Jahr (BUrlG).`
            : `gesetzl. Urlaub: ${annualEntitlement(emp).statutory} Tage/Jahr (BUrlG).`}
        </p>
            <button className="btn btn-primary" type="button" onClick={() => void handleSaveEmployment()}>
              {empFlash ? '✓ Gespeichert' : 'Aenderungen speichern'}
            </button>
            <button
              className="btn danger-outline"
              type="button"
              onClick={() => void handleDeleteEmployment()}
            >
              Beschaeftigung loeschen
            </button>
            <button className="btn" type="button" onClick={closeEdit}>
              Bearbeiten abbrechen
            </button>
          </div>
        )}

        <h3 className="sub-head">Genommene Urlaubstage</h3>
        <p className="muted small">
          Jeder Eintrag zaehlt als 1 Urlaubstag, mindert den Resturlaub des
          jeweiligen Jahres und entlastet das Arbeitszeitkonto um bis zu{' '}
          {vacEmp
            ? decimalHours(dailyTargetMs(vacEmp)).toFixed(2).replace('.', ',')
            : '0,00'}{' '}
          Std. Ist an dem Tag schon Zeit erfasst, wird nur die Differenz
          gutgeschrieben — ein Tag zaehlt nie doppelt.
        </p>
        <label className="field">
          <span>Urlaub fuer Beschaeftigung</span>
          <select
            value={vacTargetId}
            onChange={(e) => setVacEmpId(e.target.value)}
          >
            {employments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
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

        <p className="muted small vac-or">oder ganzen Zeitraum eintragen:</p>
        <div className="vac-range">
          <label className="field">
            <span>von</span>
            <input
              type="date"
              value={vacFrom}
              onChange={(e) => {
                setVacFrom(e.target.value);
                setVacRangeMsg('');
              }}
            />
          </label>
          <label className="field">
            <span>bis</span>
            <input
              type="date"
              value={vacTo}
              onChange={(e) => {
                setVacTo(e.target.value);
                setVacRangeMsg('');
              }}
            />
          </label>
        </div>
        <button
          className="btn btn-block"
          disabled={rangeDays.length === 0}
          onClick={() => void handleAddVacationRange()}
        >
          {rangeDays.length > 0
            ? `${rangeDays.length} Arbeitstag(e) eintragen`
            : 'Zeitraum eintragen'}
        </button>
        <p className="muted small">
          {rangeTooLong
            ? `Der Zeitraum ist zu lang (max. ${MAX_VACATION_RANGE_DAYS} Tage am Stueck). Bitte Datum pruefen.`
            : vacRangeMsg ||
              'Sonntage werden immer uebersprungen, Samstage ab 6 Arbeitstagen/Woche mitgezaehlt. Feiertage kennt die App nicht — einzelne Tage danach gegebenenfalls wieder entfernen.'}
        </p>

        {vacDays.length === 0 ? (
          <p className="muted small">Noch keine Urlaubstage erfasst.</p>
        ) : (
          <ul className="vac-list">
            {vacDays.map((d) => (
              <li key={d.date}>
                <span>
                  {formatDateWithWeekday(d.date)}
                  <span className="muted small"> ({empLabel(d.employmentId)})</span>
                </span>
                <button
                  className="link-btn danger"
                  type="button"
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
        <p className="muted small">
          Ausnahme: Schaltest du bei einer Beschaeftigung die Uebertragung an
          Clockodo ein, verbindet sich die App mit deinem Clockodo-Konto und
          uebertraegt die Eintraege dieser Beschaeftigung (Zeiten, Pausen als
          Luecken, Taetigkeit, Kunde, Projekt, Leistung). Der API-Schluessel
          liegt verschluesselt auf dem Geraet und steht in keinem Backup.
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
          Klarzeit {__APP_VERSION__} · Offline Single-User · Capacitor + React.
        </p>
      </section>
    </div>
  );
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
