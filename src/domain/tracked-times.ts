import type { TimeEntry, TrackedTimes } from './types';

/**
 * Patch fuer das Bearbeiten eines Eintrags (AUF-035): Aendert sich bei einem Stoppuhr-Eintrag zum
 * ersten Mal Beginn oder Ende, merkt der Patch die bisherigen Zeiten als `trackedTimes`. Spaetere
 * Aenderungen lassen die gemerkten Zeiten stehen; ein nachgetragener Eintrag bekommt keine.
 */
export function withTrackedTimes(
  entry: TimeEntry,
  patch: Partial<TimeEntry>,
): Partial<TimeEntry> {
  if (entry.source !== 'tracked' || entry.trackedTimes !== undefined) return patch;
  const start = patch.start ?? entry.start;
  const end = patch.end ?? entry.end;
  if (start === entry.start && end === entry.end) return patch;
  return { ...patch, trackedTimes: { start: entry.start, end: entry.end } };
}

/** Die gemerkten Stoppuhr-Zeiten, wenn sie von den heutigen abweichen; sonst undefined. */
export function changedTrackedTimes(entry: TimeEntry): TrackedTimes | undefined {
  const t = entry.trackedTimes;
  if (entry.source !== 'tracked' || t === undefined) return undefined;
  return t.start !== entry.start || t.end !== entry.end ? t : undefined;
}

/** Stoppuhr-Zeiten aus einem Backup: endliche Zahlen, Ende nach Beginn; sonst undefined. */
export function cleanTrackedTimes(raw: unknown): TrackedTimes | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const x = raw as Record<string, unknown>;
  const { start, end } = x;
  if (typeof start !== 'number' || !Number.isFinite(start)) return undefined;
  if (typeof end !== 'number' || !Number.isFinite(end) || end <= start) return undefined;
  return { start, end };
}
