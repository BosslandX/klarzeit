import { useMemo, useState } from 'react';
import type { EntrySource } from '../../domain/types';
import {
  fromDatetimeLocal,
  toDatetimeLocal,
  formatDuration,
  netMs,
} from '../../domain/time';

export interface EntryDraft {
  start: number;
  end: number;
  breakMinutes: number;
  activity: string;
  note: string;
  source: EntrySource;
}

interface Props {
  title: string;
  initial: EntryDraft;
  saveLabel?: string;
  onCancel: () => void;
  onSave: (draft: EntryDraft) => Promise<void> | void;
}

export function EntryFormModal({
  title,
  initial,
  saveLabel = 'Speichern',
  onCancel,
  onSave,
}: Props) {
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [breakMinutes, setBreakMinutes] = useState(initial.breakMinutes);
  const [activity, setActivity] = useState(initial.activity);
  const [note, setNote] = useState(initial.note);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dauerMs = useMemo(
    () => netMs({ start, end, breakMinutes }),
    [start, end, breakMinutes],
  );

  const handleSave = async () => {
    if (Number.isNaN(start) || Number.isNaN(end)) {
      setError('Bitte Beginn und Ende vollstaendig angeben.');
      return;
    }
    if (end <= start) {
      setError('Das Ende muss nach dem Beginn liegen.');
      return;
    }
    if (breakMinutes * 60_000 >= end - start) {
      setError('Die Pause ist laenger als die erfasste Zeitspanne.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave({
        start,
        end,
        breakMinutes: Math.max(0, breakMinutes || 0),
        activity: activity.trim(),
        note: note.trim(),
        source: initial.source,
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

        <label className="field">
          <span>Pause (Minuten)</span>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={breakMinutes}
            onChange={(e) => setBreakMinutes(Number(e.target.value) || 0)}
          />
        </label>

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
