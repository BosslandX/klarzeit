import { useState } from 'react';
import type { Tracker } from '../../tracking/useTracker';
import { addEntry } from '../../db/entries';
import { useEntriesInRange } from '../../db/entries';
import { dayPeriod, totalMs } from '../../domain/aggregate';
import { formatClock, formatDuration, formatStopwatch } from '../../domain/time';
import { IconPlay, IconStop } from '../components/Icons';
import { EntryFormModal, type EntryDraft } from '../components/EntryFormModal';

interface Props {
  tracker: Tracker;
}

export function HomeScreen({ tracker }: Props) {
  const { running, elapsedMs, loading, start, cancel, updateActivity } = tracker;
  const [activity, setActivity] = useState('');
  const [stopDraft, setStopDraft] = useState<EntryDraft | null>(null);

  const today = dayPeriod(Date.now());
  const todayEntries = useEntriesInRange(today.from, today.to) ?? [];
  const todaySaved = totalMs(todayEntries);

  const handleStart = async () => {
    try {
      await start(activity.trim());
      setActivity('');
    } catch (e) {
      window.alert(
        `Start fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  const openStop = () => {
    if (!running) return;
    setStopDraft({
      start: running.start,
      end: Date.now(),
      breakMinutes: 0,
      activity: running.activity,
      note: '',
      source: 'tracked',
    });
  };

  const saveStop = async (draft: EntryDraft) => {
    await addEntry(draft);
    await cancel();
    setStopDraft(null);
  };

  if (loading) {
    return <div className="screen center muted">Lade…</div>;
  }

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Klarzeit</h1>
      </header>

      {running ? (
        <div className="tracker-card running">
          <div className="tracker-label">Laeuft seit {formatClock(running.start)}</div>
          <div className="stopwatch">{formatStopwatch(elapsedMs)}</div>
          <input
            className="activity-input"
            type="text"
            placeholder="Taetigkeit (jederzeit anpassbar)"
            value={running.activity}
            onChange={(e) => updateActivity(e.target.value)}
          />
          <button className="btn btn-stop btn-big" onClick={openStop}>
            <IconStop /> Stoppen &amp; speichern
          </button>
          <button className="btn btn-ghost" onClick={() => void cancel()}>
            Verwerfen
          </button>
        </div>
      ) : (
        <div className="tracker-card">
          <div className="tracker-label">Bereit zur Erfassung</div>
          <div className="stopwatch muted">00:00:00</div>
          <input
            className="activity-input"
            type="text"
            placeholder="Taetigkeit (optional)"
            value={activity}
            onChange={(e) => setActivity(e.target.value)}
          />
          <button className="btn btn-start btn-big" onClick={handleStart}>
            <IconPlay /> Erfassung starten
          </button>
        </div>
      )}

      <div className="info-card">
        <span>Heute bereits erfasst</span>
        <strong>{formatDuration(todaySaved)}</strong>
        <small>{todayEntries.length} Eintrag(e)</small>
      </div>

      {stopDraft && (
        <EntryFormModal
          title="Erfassung abschliessen"
          initial={stopDraft}
          saveLabel="Speichern"
          onCancel={() => setStopDraft(null)}
          onSave={saveStop}
        />
      )}
    </div>
  );
}
