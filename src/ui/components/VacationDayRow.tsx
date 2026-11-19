import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import type { Employment, VacationDay } from '../../domain/employment';
import { VACATION_NOTE_MAX } from '../../domain/vacation-note';
import { holidayNameOn } from '../../domain/holidays';
import { sickPeriodOn, type SickPeriod } from '../../domain/sickness';
import {
  absenceStatusLabel,
  CLOCKODO_SICK_HINT,
  isSickInClockodoVacation,
  isVacationDayRemovable,
} from '../../domain/clockodo-absence';
import { formatDateWithWeekday } from '../../domain/time';
import {
  vacationWithdrawQuestion,
  vacationWithdrawSummary,
  withdrawVacationRequest,
} from '../../clockodo/vacation-transfer';

export function VacationDayRow({
  day,
  days,
  employmentLabel,
  employment,
  onRemove,
  onWithdrawn,
  onNoteChange,
  sickPeriods,
}: {
  day: VacationDay;
  days: readonly VacationDay[];
  employmentLabel: string;
  employment: Employment | undefined;
  onRemove: () => void;
  onWithdrawn: () => Promise<void>;
  onNoteChange: (note: string) => Promise<void>;
  sickPeriods: readonly SickPeriod[];
}) {
  const native = Capacitor.isNativePlatform();
  const showClockodo = employment?.clockodo != null;
  const feiertag = holidayNameOn(employment?.publicHolidays, day.date);
  const krank = sickPeriodOn(sickPeriods, day.employmentId, day.date);
  const [busy, setBusy] = useState(false);
  const removable = isVacationDayRemovable(day);
  const absenceId = day.clockodoAbsence?.id;
  const showWithdraw = !removable && showClockodo && absenceId !== undefined;
  // Notiz in Bearbeitung (AUF-049); null = keine. Auch ein beantragter Tag, der sich nicht entfernen laesst, bekommt
  // so eine Notiz.
  const [noteDraft, setNoteDraft] = useState<string | null>(null);

  const handleSaveNote = async () => {
    if (noteDraft === null) return;
    setBusy(true);
    try {
      await onNoteChange(noteDraft);
      setNoteDraft(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      window.alert(`Notiz nicht gespeichert: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const handleWithdraw = async () => {
    if (absenceId === undefined) return;
    const ok = window.confirm(
      vacationWithdrawQuestion(days, day.employmentId, absenceId),
    );
    if (!ok) return;
    setBusy(true);
    try {
      const r = await withdrawVacationRequest(day.employmentId, absenceId);
      window.alert(vacationWithdrawSummary(r));
      await onWithdrawn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      window.alert(`Zurueckziehen fehlgeschlagen: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  if (noteDraft !== null) {
    return (
      <li>
        <span className="vac-note-edit">
          {formatDateWithWeekday(day.date)}
          <input
            type="text"
            aria-label="Notiz zum Urlaubstag"
            placeholder="Notiz, bleibt in Klarzeit"
            maxLength={VACATION_NOTE_MAX}
            value={noteDraft}
            autoFocus
            onChange={(e) => setNoteDraft(e.target.value)}
          />
        </span>
        <span className="vac-actions">
          <button className="link-btn" type="button" disabled={busy} onClick={() => void handleSaveNote()}>
            speichern
          </button>
          <button className="link-btn" type="button" disabled={busy} onClick={() => setNoteDraft(null)}>
            abbrechen
          </button>
        </span>
      </li>
    );
  }

  return (
    <li>
      <span>
        {formatDateWithWeekday(day.date)}
        <span className="muted small"> ({employmentLabel})</span>
        {day.halfDay && <span className="muted small"> · halber Tag</span>}
        {feiertag !== undefined && (
          <span className="muted small">
            {' '}
            · Feiertag ({feiertag}), zaehlt nicht als Urlaub
          </span>
        )}
        {krank !== undefined && (
          <span className="muted small">
            {' '}
            ·{' '}
            {krank.certificate
              ? 'krank mit Bescheinigung, zaehlt nicht als Urlaub (§ 9 BUrlG)'
              : 'krank ohne Bescheinigung, zaehlt als Urlaub'}
          </span>
        )}
        {showClockodo && (
          <span className="muted small">
            {' '}
            · Clockodo: {absenceStatusLabel(day.clockodoAbsence)}
            {isSickInClockodoVacation(day, sickPeriods) && ` – ${CLOCKODO_SICK_HINT}`}
          </span>
        )}
        {day.note.trim() !== '' && <span className="muted small"> · Notiz: {day.note.trim()}</span>}
      </span>
      <span className="vac-actions">
        <button className="link-btn" type="button" onClick={() => setNoteDraft(day.note)}>
          Notiz
        </button>
        {removable ? (
          <button className="link-btn danger" type="button" onClick={onRemove}>
            entfernen
          </button>
        ) : showWithdraw ? (
          <button
            className="link-btn danger"
            type="button"
            disabled={busy || !native}
            title={native ? undefined : 'Zurueckziehen nur in der Android-App'}
            onClick={() => void handleWithdraw()}
          >
            zurueckziehen
          </button>
        ) : (
          <span className="muted small">erst in Clockodo zurueckziehen</span>
        )}
      </span>
    </li>
  );
}
