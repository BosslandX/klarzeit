import { Preferences } from '@capacitor/preferences';
import { useCallback, useEffect, useState } from 'react';
import { cleanClockodoLock, type ClockodoLock } from '../domain/clockodo';

function prefKey(employmentId: string): string {
  return `clockodoLock:${employmentId}`;
}

export async function getClockodoLock(employmentId: string): Promise<ClockodoLock | null> {
  const { value } = await Preferences.get({ key: prefKey(employmentId) });
  if (!value) return null;
  try {
    return cleanClockodoLock(JSON.parse(value));
  } catch {
    return null;
  }
}

export async function saveClockodoLock(
  employmentId: string,
  lock: ClockodoLock,
): Promise<void> {
  await Preferences.set({
    key: prefKey(employmentId),
    value: JSON.stringify({ days: lock.days, at: lock.at }),
  });
}

export async function removeClockodoLock(employmentId: string): Promise<void> {
  await Preferences.remove({ key: prefKey(employmentId) });
}

/** Gemerkte Sperrfristen der Beschaeftigungen; fehlt eine ID, ist ihr Stand noch nicht geladen. */
export function useClockodoLocks(employmentIds: readonly string[]): {
  locks: Record<string, ClockodoLock | null>;
  reload: () => Promise<void>;
} {
  const [locks, setLocks] = useState<Record<string, ClockodoLock | null>>({});
  // Als Text, weil die Aufrufer das Array bei jedem Rendern neu bauen -- mit dem Array als
  // Abhaengigkeit liefe das Laden endlos. Gelesen werden die IDs darum auch aus dem Text.
  const idsKey = JSON.stringify(employmentIds);

  const reload = useCallback(async () => {
    const next: Record<string, ClockodoLock | null> = {};
    for (const id of JSON.parse(idsKey) as string[]) {
      next[id] = await getClockodoLock(id);
    }
    setLocks(next);
  }, [idsKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { locks, reload };
}
