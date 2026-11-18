import { useEffect, useMemo, useRef, useState } from 'react';
import type { BreakInterval, EntrySource } from '../../domain/types';
import type { ClockodoEntryRef, ClockodoLists } from '../../domain/clockodo';
import { entrySelectionStart, withStaleOption } from '../../domain/clockodo';
import { resolveBreakMinutes, validateBreaks } from '../../domain/breaks';
import { VERANLASSUNG_MAX } from '../../domain/overtime-authorization';
import {
  breakTimeOnEntry,
  followStartDate,
  toTimeInput,
} from '../../domain/entry-dates';
import {
  fromDatetimeLocal,
  toDatetimeLocal,
  formatDuration,
  netMs,
} from '../../domain/time';
import {
  getActiveEmploymentId,
  setActiveEmployment,
  useEmployments,
} from '../../db/employment';
import { getClockodoLists } from '../../db/clockodo-lists';

export interface EntryDraft {
  start: number;
  end: number;
  breaks: BreakInterval[];
  breakMinutes: number;
  activity: string;
  note: string;
  source: EntrySource;
  employmentId?: string;
  clockodo: ClockodoEntryRef | null;
  /** Veranlassung von Ueberstunden (AUF-036); leer = keine Angabe. */
  overtimeAuthorization: string;
}

interface Props {
  title: string;
  initial: EntryDraft;
  saveLabel?: string;
  onCancel: () => void;
  onSave: (draft: EntryDraft) => Promise<void> | void;
}

/** Wert fuer ein <input type="datetime-local">; leer, wenn das Feld geleert wurde. */
function dateTimeInputValue(ms: number): string {
  return Number.isNaN(ms) ? '' : toDatetimeLocal(ms);
}

/** Eine Pause im Formular: nur Uhrzeiten ("HH:mm", leer = noch nicht gesetzt). */
interface BreakRow {
  start: string;
  end: string;
}

function isCompleteBreak(b: BreakInterval): boolean {
  return Number.isFinite(b.start) && Number.isFinite(b.end);
}

export function EntryFormModal({
  title,
  initial,
  saveLabel = 'Speichern',
  onCancel,
  onSave,
}: Props) {
  const { employments, loading: empLoading } = useEmployments();
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [breakRows, setBreakRows] = useState<BreakRow[]>(() =>
    initial.breaks.map((b) => ({
      start: toTimeInput(b.start),
      end: toTimeInput(b.end),
    })),
  );
  // Beginn vor der letzten Aenderung; ein geleertes Feld zaehlt nicht.
  const lastStart = useRef(initial.start);
  const [legacyMinutes, setLegacyMinutes] = useState(() =>
    initial.breaks.length === 0 && initial.breakMinutes > 0
      ? initial.breakMinutes
      : 0,
  );
  const [activity, setActivity] = useState(initial.activity);
  const [note, setNote] = useState(initial.note);
  const [veranlassung, setVeranlassung] = useState(initial.overtimeAuthorization);
  const [employmentId, setEmploymentId] = useState(initial.employmentId ?? '');
  const [clockodoSel, setClockodoSel] = useState<ClockodoEntryRef | null>(
    initial.clockodo,
  );
  const [clockodoLists, setClockodoLists] = useState<ClockodoLists | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial.employmentId) {
      setEmploymentId(initial.employmentId);
      return;
    }
    if (empLoading) return;
    void getActiveEmploymentId().then((id) => setEmploymentId(id));
  }, [initial.employmentId, empLoading]);

  const employmentConfig = useMemo(() => {
    const emp = employments.find((e) => e.id === employmentId);
    return emp?.clockodo ?? null;
  }, [employments, employmentId]);

  useEffect(() => {
    if (!employmentId) return;
    void getClockodoLists(employmentId).then(setClockodoLists);
  }, [employmentId]);

  useEffect(() => {
    if (empLoading || !employmentId) return;
    // Die gespeicherte Auswahl gehoert zur Beschaeftigung des Eintrags; nach einem
    // Wechsel gilt die Vorgabe der neuen Beschaeftigung.
    const eigene =
      initial.employmentId === undefined || initial.employmentId === employmentId;
    setClockodoSel(
      (eigene ? initial.clockodo : null) ?? entrySelectionStart(employmentConfig),
    );
  }, [
    initial.start,
    initial.end,
    initial.clockodo,
    initial.employmentId,
    employmentConfig,
    empLoading,
    employmentId,
  ]);

  // Das Datum einer Pause kommt aus Beginn und Ende des Eintrags.
  const breaks = useMemo<BreakInterval[]>(
    () =>
      breakRows.map((r) => ({
        start: breakTimeOnEntry(start, end, r.start),
        end: breakTimeOnEntry(start, end, r.end),
      })),
    [breakRows, start, end],
  );

  const completeBreaks = useMemo(
    () => breaks.filter(isCompleteBreak),
    [breaks],
  );

  const effectiveBreakMinutes = useMemo(
    () => resolveBreakMinutes(completeBreaks, legacyMinutes),
    [completeBreaks, legacyMinutes],
  );

  const dauerMs = useMemo(
    () => netMs({ start, end, breakMinutes: effectiveBreakMinutes }),
    [start, end, effectiveBreakMinutes],
  );

  const showLegacyHint =
    legacyMinutes > 0 && completeBreaks.length === 0;

  const showEmploymentPick = employments.length > 1;
  const showClockodo = employmentConfig != null;

  const customerOptions = useMemo(() => {
    const base = clockodoLists?.customers ?? [];
    return withStaleOption(base, clockodoSel?.customersId ?? null);
  }, [clockodoLists, clockodoSel?.customersId]);

  const projectOptions = useMemo(() => {
    if (clockodoSel == null) return [];
    const base = clockodoLists
      ? clockodoLists.projects.filter(
          (p) => p.customersId === clockodoSel.customersId,
        )
      : [];
    return withStaleOption(base, clockodoSel.projectsId);
  }, [clockodoLists, clockodoSel]);

  const serviceOptions = useMemo(() => {
    const base = clockodoLists?.services ?? [];
    return withStaleOption(base, clockodoSel?.servicesId ?? null);
  }, [clockodoLists, clockodoSel?.servicesId]);

  const handleEmploymentChange = async (id: string) => {
    setEmploymentId(id);
    const emp = employments.find((e) => e.id === id);
    setClockodoSel(entrySelectionStart(emp?.clockodo ?? null));
    try {
      await setActiveEmployment(id);
    } catch {
      /* unbekannte ID sollte im Select nicht vorkommen */
    }
  };

  const handleStartChange = (value: string) => {
    const next = fromDatetimeLocal(value);
    if (Number.isFinite(next)) {
      setEnd(followStartDate(lastStart.current, next, end));
      lastStart.current = next;
    }
    setStart(next);
  };

  const addBreakRow = () => {
    setBreakRows((prev) => [...prev, { start: '', end: '' }]);
  };

  const updateBreak = (index: number, patch: Partial<BreakRow>) => {
    setBreakRows((prev) =>
      prev.map((b, i) => (i === index ? { ...b, ...patch } : b)),
    );
  };

  const removeBreak = (index: number) => {
    setBreakRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (Number.isNaN(start) || Number.isNaN(end)) {
      setError('Bitte Beginn und Ende vollstaendig angeben.');
      return;
    }
    if (end <= start) {
      setError('Das Ende muss nach dem Beginn liegen.');
      return;
    }
    for (const b of breaks) {
      const hasStart = Number.isFinite(b.start);
      const hasEnd = Number.isFinite(b.end);
      if (hasStart !== hasEnd || (!hasStart && !hasEnd)) {
        setError('Bitte Beginn und Ende jeder Pause angeben.');
        return;
      }
    }
    const sorted = [...completeBreaks].sort((a, b) => a.start - b.start);
    const breakErr = validateBreaks({ start, end }, sorted);
    if (breakErr) {
      setError(breakErr);
      return;
    }
    // Deckt auch alte Eintraege ohne Pausenzeiten ab, die validateBreaks nicht sieht.
    const breakMinutes = resolveBreakMinutes(sorted, legacyMinutes);
    if (breakMinutes * 60_000 >= end - start) {
      setError('Die Pause ist laenger als die erfasste Zeitspanne.');
      return;
    }
    if (!employmentId) {
      setError('Bitte eine Beschaeftigung waehlen.');
      return;
    }
    let clockodoOut: ClockodoEntryRef | null = null;
    if (
      employmentConfig != null &&
      clockodoSel != null &&
      clockodoSel.customersId > 0 &&
      clockodoSel.servicesId > 0
    ) {
      clockodoOut = {
        customersId: clockodoSel.customersId,
        projectsId: clockodoSel.projectsId,
        servicesId: clockodoSel.servicesId,
      };
    }
    setError(null);
    setSaving(true);
    try {
      await onSave({
        start,
        end,
        breaks: sorted,
        breakMinutes,
        activity: activity.trim(),
        note: note.trim(),
        source: initial.source,
        employmentId,
        clockodo: clockodoOut,
        overtimeAuthorization: veranlassung.trim(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.');
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="modal-title">{title}</h2>

        {showEmploymentPick && (
          <label className="field">
            <span>Beschaeftigung</span>
            <select
              value={employmentId}
              onChange={(e) => void handleEmploymentChange(e.target.value)}
            >
              {employments.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="field">
          <span>Beginn</span>
          <input
            type="datetime-local"
            value={dateTimeInputValue(start)}
            onChange={(e) => handleStartChange(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Ende</span>
          <input
            type="datetime-local"
            value={dateTimeInputValue(end)}
            onChange={(e) => setEnd(fromDatetimeLocal(e.target.value))}
          />
        </label>

        <div className="field">
          <span>Pausen</span>
          {breakRows.map((b, i) => (
            <div key={i} className="break-row">
              <label>
                Pause von
                <input
                  type="time"
                  value={b.start}
                  onChange={(e) => updateBreak(i, { start: e.target.value })}
                />
              </label>
              <label>
                bis
                <input
                  type="time"
                  value={b.end}
                  onChange={(e) => updateBreak(i, { end: e.target.value })}
                />
              </label>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => removeBreak(i)}
              >
                Entfernen
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost" onClick={addBreakRow}>
            + Pause
          </button>
        </div>

        {showLegacyHint && (
          <div className="legacy-break-hint">
            Pause: {legacyMinutes} min ohne Uhrzeit (aelterer Eintrag).{' '}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setLegacyMinutes(0)}
            >
              Entfernen
            </button>
          </div>
        )}

        <div className="modal-duration">
          Pause gesamt: {effectiveBreakMinutes} min
        </div>

        {showClockodo && (
          <div className="clockodo-entry-fields">
            <h4 className="sub-head">Clockodo</h4>
            {!clockodoLists && (
              <p className="muted small">
                {
                  'Clockodo-Listen fehlen – in Mehr > Beschaeftigung > Verbindung testen.'
                }
              </p>
            )}
            {clockodoSel && (
              <>
                <label className="field">
                  <span>Kunde</span>
                  <select
                    value={clockodoSel.customersId || ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      const customersId = v ? Number(v) : 0;
                      setClockodoSel((prev) =>
                        prev
                          ? {
                              ...prev,
                              customersId,
                              projectsId: null,
                            }
                          : null,
                      );
                    }}
                  >
                    <option value="">—</option>
                    {customerOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Projekt</span>
                  <select
                    value={clockodoSel.projectsId ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      setClockodoSel((prev) =>
                        prev
                          ? {
                              ...prev,
                              projectsId: v ? Number(v) : null,
                            }
                          : null,
                      );
                    }}
                  >
                    <option value="">kein Projekt</option>
                    {projectOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Leistung</span>
                  <select
                    value={clockodoSel.servicesId || ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      const servicesId = v ? Number(v) : 0;
                      setClockodoSel((prev) =>
                        prev ? { ...prev, servicesId } : null,
                      );
                    }}
                  >
                    <option value="">—</option>
                    {serviceOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>
        )}

        <label className="field">
          <span>Taetigkeit</span>
          <input
            type="text"
            placeholder="Woran wurde gearbeitet?"
            value={activity}
            onChange={(e) => setActivity(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Notiz (optional)</span>
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Veranlassung von Ueberstunden (optional)</span>
          <input
            type="text"
            maxLength={VERANLASSUNG_MAX}
            placeholder="z. B. angeordnet von der Teamleitung am 03.11. per E-Mail"
            value={veranlassung}
            onChange={(e) => setVeranlassung(e.target.value)}
          />
        </label>
        <p className="muted small">
          Wer Ueberstundenverguetung einklagt, muss auch ihre Veranlassung durch den Arbeitgeber
          darlegen: wer sie wann und wie angeordnet, gebilligt oder geduldet hat (BAG, Urteil vom
          04.05.2022 – 5 AZR 359/21).
        </p>

        <div className="modal-duration">
          Dauer: <strong>{formatDuration(dauerMs)}</strong>
        </div>

        {error && <p className="error-text">{error}</p>}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel} disabled={saving}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '…' : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
