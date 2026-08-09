import { Preferences } from '@capacitor/preferences';
import type { RunningSession } from '../domain/types';

const KEY = 'running';

export async function getRunning(): Promise<RunningSession | null> {
  const { value } = await Preferences.get({ key: KEY });
  if (!value) return null;
  try {
    return JSON.parse(value) as RunningSession;
  } catch {
    return null;
  }
}

export async function setRunning(session: RunningSession): Promise<void> {
  await Preferences.set({ key: KEY, value: JSON.stringify(session) });
}

export async function clearRunning(): Promise<void> {
  await Preferences.remove({ key: KEY });
}
