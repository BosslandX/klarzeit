import { useEffect, useMemo, useState } from 'react';
import type { BreakInterval, EntrySource } from '../../domain/types';
import { resolveBreakMinutes, validateBreaks } from '../../domain/breaks';
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

export interface EntryDraft {
  start: number;
  end: number;
  breaks: BreakInterval[];
  breakMinutes: number;
  activity: string;
  note: string;
  source: EntrySource;
  employmentId?: string;
}

interface Props {
  title: string;
  initial: EntryDraft;
  saveLabel?: string;
  onCancel: () => void;
  onSave: (draft: EntryDraft) => Promise<void> | void;
}

function breakInputValue(ms: number): string {
  return Number.isNaN(ms) ? '' : toDatetimeLocal(ms);
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
  const [breaks, setBreaks] = useState<BreakInterval[]>(
    initial.breaks.length ? initial.breaks : [],
  );
  const [legacyMinutes, setLegacyMinutes] = useState(() =>
    initial.breaks.length === 0 && initial.breakMinutes > 0
      ? initial.breakMinutes
      : 0,
  );
  const [activity, setActivity] = useState(initial.activity);
  const [note, setNote] = useState(initial.note);
  const [employmentId, setEmploymentId] = useState(initial.employmentId ?? '');
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

  const handleEmploymentChange = async (id: string) => {
    setEmploymentId(id);
    try {
      await setActiveEmployment(id);
    } catch {
      /* unbekannte ID sollte im Select nicht vorkommen */
    }
  };

  const addBreakRow = () => {
    setBreaks((prev) => [...prev, { start: NaN, end: NaN }]);
  };

  const updateBreak = (index: number, patch: Partial<BreakInterval>) => {
    setBreaks((prev) =>
      prev.map((b, i) => (i === index ? { ...b, ...patch } : b)),
    );
  };

  const removeBreak = (index: number) => {
    setBreaks((prev) => prev.filter((_, i) => i !== index));
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
            value={toDatetimeLocal(start)}
            onChange={(e) => setStart(fromDatetimeLocal(e.target.value))}
          />
        </label>

        <label className="field">
          <span>Ende</span>
          <input
            type="datetime-local"
            value={toDatetimeLocal(end)}
            onChange={(e) => setEnd(fromDatetimeLocal(e.target.value))}
          />
        </label>

        <div className="field">
          <span>Pausen</span>
          {breaks.map((b, i) => (
            <div key={i} className="break-row">
              <label>
                Pause von
                <input
                  type="datetime-local"
                  value={breakInputValue(b.start)}
                  onChange={(e) =>
                    updateBreak(i, { start: fromDatetimeLocal(e.target.value) })
                  }
                />
              </label>
              <label>
                bis
                <input
                  type="datetime-local"
                  value={breakInputValue(b.end)}
                  onChange={(e) =>
                    updateBreak(i, { end: fromDatetimeLocal(e.target.value) })
                  }
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
