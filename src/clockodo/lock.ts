import type { ClockodoHttp } from './client';
import { fetchMe } from './client';
import type { ClockodoLock } from '../domain/clockodo';
import { saveClockodoLock } from '../db/clockodo-lock';
import { clockodoZugang } from './vacation-transfer';

/**
 * Liest die Sperrfrist der Beschaeftigung aus Clockodo und merkt sie sich. Ohne Zugang oder wenn
 * die Abfrage scheitert, bleibt die gemerkte stehen, und es kommt null zurueck -- das Uebertragen
 * danach meldet einen Verbindungsfehler selbst.
 */
export async function refreshClockodoLock(
  employmentId: string,
  opts?: { http?: ClockodoHttp; now?: () => number },
): Promise<ClockodoLock | null> {
  const zugang = await clockodoZugang(employmentId);
  if (!zugang.ok) return null;
  const now = opts?.now ?? Date.now;
  try {
    const me = await fetchMe(zugang.auth, opts?.http);
    const lock: ClockodoLock = { days: me.editLockDays, at: now() };
    await saveClockodoLock(employmentId, lock);
    return lock;
  } catch {
    return null;
  }
}
