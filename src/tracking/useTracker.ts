import { useCallback, useEffect, useRef, useState } from 'react';
import { clearRunning, getRunning, setRunning } from '../db/running';
import type { RunningSession } from '../domain/types';

export interface Tracker {
  running: RunningSession | null;
  elapsedMs: number;
  loading: boolean;
  start: (activity: string) => Promise<void>;
  /** Beendet die laufende Session und gibt ihre Startzeit zurueck (oder null). */
  finish: () => Promise<RunningSession | null>;
  cancel: () => Promise<void>;
  updateActivity: (activity: string) => void;
}

/** Verwaltet die laufende (noch nicht gestoppte) Erfassung; uebersteht App-Neustart. */
export function useTracker(): Tracker {
  const [running, setRunningState] = useState<RunningSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [elapsedMs, setElapsedMs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let active = true;
    getRunning().then((r) => {
      if (active) {
        setRunningState(r);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (!running) {
      setElapsedMs(0);
      return;
    }
    const tick = () => setElapsedMs(Date.now() - running.start);
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [running]);

  const start = useCallback(async (activity: string) => {
    const session: RunningSession = { start: Date.now(), activity };
    await setRunning(session);
    setRunningState(session);
  }, []);

  // State-Updater bleibt seiteneffektfrei (StrictMode-sicher).
  const updateActivity = useCallback((activity: string) => {
    setRunningState((prev) => (prev ? { ...prev, activity } : prev));
  }, []);

  // Laufende Taetigkeit entkoppelt + entprellt persistieren: vermeidet doppelte
  // Bridge-Writes pro Tastendruck und behandelt Schreibfehler sichtbar.
  useEffect(() => {
    if (!running) return;
    const id = setTimeout(() => {
      setRunning(running).catch((err) => {
        console.error('Persistieren der laufenden Taetigkeit fehlgeschlagen:', err);
      });
    }, 300);
    return () => clearTimeout(id);
  }, [running]);

  const finish = useCallback(async (): Promise<RunningSession | null> => {
    const current = await getRunning();
    await clearRunning();
    setRunningState(null);
    return current;
  }, []);

  const cancel = useCallback(async () => {
    await clearRunning();
    setRunningState(null);
  }, []);

  return { running, elapsedMs, loading, start, finish, cancel, updateActivity };
}
