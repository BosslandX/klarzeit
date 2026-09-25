import { MINUTE } from './time';
import type { BreakInterval } from './types';

export function breakMinutesOf(breaks: readonly BreakInterval[]): number {
  const totalMs = breaks.reduce((sum, b) => sum + (b.end - b.start), 0);
  return Math.round(totalMs / MINUTE);
}

export function validateBreaks(
  entry: { start: number; end: number },
  breaks: readonly BreakInterval[],
): string | null {
  for (const b of breaks) {
    if (b.end <= b.start) {
      return 'Eine Pause endet nicht nach ihrem Beginn.';
    }
  }
  for (const b of breaks) {
    if (b.start < entry.start || b.end > entry.end) {
      return 'Eine Pause liegt ausserhalb von Beginn und Ende.';
    }
  }
  const sorted = [...breaks].sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].end > sorted[i + 1].start) {
      return 'Zwei Pausen ueberschneiden sich.';
    }
  }
  const totalMs = breaks.reduce((sum, b) => sum + (b.end - b.start), 0);
  if (totalMs >= entry.end - entry.start) {
    return 'Die Pause ist laenger als die erfasste Zeitspanne.';
  }
  return null;
}

export function resolveBreakMinutes(
  breaks: readonly BreakInterval[],
  legacyMinutes: number,
): number {
  if (breaks.length > 0) {
    return breakMinutesOf(breaks);
  }
  return legacyMinutes;
}
