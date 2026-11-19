import { useState } from 'react';
import { startOfMonth } from 'date-fns';
import { useProfile } from '../../db/profile';
import {
  addEmployment,
  removeEmployment,
  updateEmployment,
  useEmployments,
  useVacationDays,
} from '../../db/employment';

import type { Employment } from '../../domain/employment';
import { SickPeriodsSection } from '../components/SickPeriodsSection';
import { useSickPeriods } from '../../db/sickness';
import { historyAfterChange } from '../../domain/contract-change';
import { UpdateSection } from '../components/UpdateSection';
import { removeClockodoKey } from '../../clockodo/key-store';
import { removeClockodoLists } from '../../db/clockodo-lists';
import { removeClockodoLock } from '../../db/clockodo-lock';
import { ProfileSection } from '../components/ProfileSection';
import { EmploymentEditForm } from '../components/EmploymentEditForm';
import { VacationSection } from '../components/VacationSection';
import { BackupSection } from '../components/BackupSection';

export function MoreScreen() {
  const { profile, loading, save } = useProfile();
  const [aenderungAb, setAenderungAb] = useState<number | null>(() =>
    startOfMonth(Date.now()).getTime(),
  );
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
    refresh: refreshVac,
    setNote: setVacNote,
  } = useVacationDays();
  const { periods: sickPeriods, refresh: refreshSick } = useSickPeriods();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Employment | null>(null);
  const [empFlash, setEmpFlash] = useState(false);
  const [vacEmpId, setVacEmpId] = useState('');

  const vacTargetId =
    vacEmpId || employments[0]?.id || '';
  const vacEmp =
    employments.find((e) => e.id === vacTargetId) ?? employments[0];

  const openEdit = (e: Employment) => {
    setEditingId(e.id);
    setEditDraft({ ...e });
    setAenderungAb(startOfMonth(Date.now()).getTime());
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
    const historie = vorher ? historyAfterChange(vorher, patch, aenderungAb) : patch.contractHistory;
    if (historie === null) {
      window.alert('"Gilt ab" muss nach dem Beginn und nach dem letzten frueheren Vertragsstand liegen.');
      return;
    }
    await updateEmployment(editingId, { ...patch, contractHistory: historie });
    if (vorher?.clockodo && patch.clockodo === null) {
      await removeClockodoKey(editingId);
      await removeClockodoLists(editingId);
      await removeClockodoLock(editingId);
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

  if (loading || empListLoading) return <div className="screen center muted">Lade…</div>;

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Mehr</h1>
      </header>

      <ProfileSection profile={profile} save={save} />

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
          <EmploymentEditForm
            editingId={editingId}
            editDraft={editDraft}
            setEditDraft={setEditDraft}
            saved={employments.find((e) => e.id === editingId)}
            aenderungAb={aenderungAb}
            setAenderungAb={setAenderungAb}
            empFlash={empFlash}
            onSave={() => void handleSaveEmployment()}
            onDelete={() => void handleDeleteEmployment()}
            onCancel={closeEdit}
          />
        )}

        <VacationSection
          employments={employments}
          vacTargetId={vacTargetId}
          vacEmp={vacEmp}
          setVacEmpId={setVacEmpId}
          vacDays={vacDays}
          addVac={addVac}
          addVacMany={addVacMany}
          removeVac={removeVac}
          refreshVac={refreshVac}
          setVacNote={setVacNote}
          sickPeriods={sickPeriods}
        />

        <SickPeriodsSection
          employment={vacEmp}
          periods={sickPeriods}
          showName={employments.length > 1}
          onChange={refreshSick}
        />
      </section>

      <BackupSection employments={employments} />

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
          Luecken, Taetigkeit, Kunde, Projekt, Leistung) auf Knopfdruck oder,
          wenn „Automatisch uebertragen" eingeschaltet ist, beim Speichern und
          beim Oeffnen der App; auf Knopfdruck beantragt sie die offenen
          Urlaubstage, liest den Stand deiner Urlaubsantraege zurueck und zieht
          einen Antrag auf Wunsch zurueck.
          Der API-Schluessel
          liegt verschluesselt auf dem Geraet und steht in keinem Backup.
        </p>
      </section>

      <UpdateSection />

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
