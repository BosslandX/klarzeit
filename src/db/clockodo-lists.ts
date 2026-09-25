import { Preferences } from '@capacitor/preferences';
import type { ClockodoLists } from '../domain/clockodo';

function prefKey(employmentId: string): string {
  return `clockodoLists:${employmentId}`;
}

function isValidLists(raw: unknown): ClockodoLists | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const x = raw as Record<string, unknown>;
  if (typeof x.fetchedAt !== 'number' || !Number.isFinite(x.fetchedAt)) {
    return null;
  }
  if (!Array.isArray(x.customers) || !Array.isArray(x.projects)) {
    return null;
  }
  if (!Array.isArray(x.services)) return null;
  return {
    fetchedAt: x.fetchedAt as number,
    customers: x.customers as ClockodoLists['customers'],
    projects: x.projects as ClockodoLists['projects'],
    services: x.services as ClockodoLists['services'],
  };
}

export async function getClockodoLists(
  employmentId: string,
): Promise<ClockodoLists | null> {
  const { value } = await Preferences.get({ key: prefKey(employmentId) });
  if (!value) return null;
  try {
    return isValidLists(JSON.parse(value));
  } catch {
    return null;
  }
}

export async function saveClockodoLists(
  employmentId: string,
  lists: ClockodoLists,
): Promise<void> {
  await Preferences.set({
    key: prefKey(employmentId),
    value: JSON.stringify(lists),
  });
}

export async function removeClockodoLists(
  employmentId: string,
): Promise<void> {
  await Preferences.remove({ key: prefKey(employmentId) });
}
