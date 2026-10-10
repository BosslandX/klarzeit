import { useEffect, useMemo, useState } from 'react';
import type { Tracker } from '../../tracking/useTracker';
import { addEntry, useAllEntriesDesc, useEntriesInRange } from '../../db/entries';
import {
  getActiveEmploymentId,
  setActiveEmployment,
  useEmployments,
} from '../../db/employment';
import { useClockodoLocks } from '../../db/clockodo-lock';
import { countLockStates, lockHint } from '../../domain/clockodo-lock';
import { dayPeriod, totalMs } from '../../domain/aggregate';
import { formatClock, formatDuration, formatStopwatch } from '../../domain/time';
import { IconPlay, IconStop } from '../components/Icons';
import { EntryFormModal, type EntryDraft } from '../components/EntryFormModal';

interface Props {
  tracker: Tracker;
}

export function HomeScreen({ tracker }: Props) {
  const { running, elapsedMs, loading, start, cancel, updateActivity } = tracker;
  const { employments, loading: empLoading } = useEmployments();
  const [activity, setActivity] = useState('');
  const [captureEmploymentId, setCaptureEmploymentId] = useState('');
  const [stopDraft, setStopDraft] = useState<EntryDraft | null>(null);

  useEffect(() => {
    if (empLoading) return;
    void getActiveEmploymentId().then((id) => setCaptureEmploymentId(id));
  }, [empLoading, employments.length]);

  const alleEintraege = useAllEntriesDesc() ?? [];
  const clockodoEmployments = useMemo(
    () => employments.filter((e) => e.clockodo != null),
    [employments],
  );
  const { locks } = useClockodoLocks(clockodoEmployments.map((e) => e.id));

  const today = dayPeriod(Date.now());
  const todayEntries = useEntriesInRange(today.from, today.to) ?? [];
  const todaySaved = totalMs(todayEntries);

  const showEmploymentPick = employments.length > 1;
  const runningEmployment = running
    ? employments.find((e) => e.id === running.employmentId)
    : undefined;

  const handleEmploymentChange = async (id: string) => {
    setCaptureEmploymentId(id);
    try {
      await setActiveEmployment(id);
    } catch {
      /* Select enthaelt nur gueltige IDs */
    }
  };

  const handleStart = async () => {
    try {
      const eid =
        captureEmploymentId || (await getActiveEmploymentId());
      await start(activity.trim(), eid);
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
      breaks: [],
      breakMinutes: 0,
      activity: running.activity,
      note: '',
      source: 'tracked',
      employmentId: running.employmentId,
      clockodo: null,
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

      {clockodoEmployments.map((emp) => {
        if (!(emp.id in locks)) return null;
        const lock = locks[emp.id];
        const counts = countLockStates(
          alleEintraege,
          emp.id,
          emp.clockodo!,
          lock?.days ?? null,
          Date.now(),
        );
        /* Gesperrte zaehlen unter Erfassung nicht — Hinweis ließe sich sonst nicht wegklicken */
        const hinweis = lockHint({ ...counts, locked: 0 }, lock);
        return hinweis ? (
          <p key={`lock-${emp.id}`} className="error-text">
            Clockodo – {emp.name}: {hinweis}
          </p>
        ) : null;
      })}

      {running ? (
        <div className="tracker-card running">
          <div className="tracker-label">Laeuft seit {formatClock(running.start)}</div>
          {showEmploymentPick && runningEmployment && (
            <div className="tracker-employment muted">{runningEmployment.name}</div>
          )}
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
          {showEmploymentPick && (
            <label className="field">
              <span>Beschaeftigung</span>
              <select
                value={captureEmploymentId}
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
