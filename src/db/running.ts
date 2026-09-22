import { Preferences } from '@capacitor/preferences';
import type { RunningSession } from '../domain/types';
import { getActiveEmploymentId, INITIAL_EMPLOYMENT_ID } from './employment';

const KEY = 'running';

function normalizeRunning(raw: unknown): RunningSession | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const x = raw as Record<string, unknown>;
  if (typeof x.start !== 'number' || typeof x.activity !== 'string') return null;
  const employmentId =
    typeof x.employmentId === 'string' && x.employmentId.trim() !== ''
      ? x.employmentId
      : INITIAL_EMPLOYMENT_ID;
  return { start: x.start, activity: x.activity, employmentId };
}

export async function getRunning(): Promise<RunningSession | null> {
  const { value } = await Preferences.get({ key: KEY });
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    const session = normalizeRunning(parsed);
    if (!session) return null;
    if (
      typeof (parsed as Record<string, unknown>).employmentId !== 'string' ||
      (parsed as Record<string, unknown>).employmentId === ''
    ) {
      await setRunning(session);
    }
    return session;
  } catch {
    return null;
  }
}

export async function setRunning(session: RunningSession): Promise<void> {
  const employmentId =
    session.employmentId?.trim() !== ''
      ? session.employmentId
      : await getActiveEmploymentId();
  await Preferences.set({
    key: KEY,
    value: JSON.stringify({ ...session, employmentId }),
  });
}

export async function clearRunning(): Promise<void> {
  await Preferences.remove({ key: KEY });
}
