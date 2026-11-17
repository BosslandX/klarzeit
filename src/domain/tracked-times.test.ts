import { describe, expect, it } from 'vitest';
import { changedTrackedTimes, cleanTrackedTimes, withTrackedTimes } from './tracked-times';
import type { TimeEntry } from './types';

const H = 3_600_000;
const tag = new Date(2026, 10, 9).getTime();
const stoppuhr: TimeEntry = {
  id: 1,
  employmentId: 'emp-1',
  start: tag + 8 * H,
  end: tag + 16 * H,
  breakMinutes: 30,
  activity: 'Montage',
  note: '',
  source: 'tracked',
  createdAt: 0,
  updatedAt: 0,
};
const gemerkt = { start: tag + 8 * H, end: tag + 16 * H };

describe('Geaenderte Stoppuhr-Eintraege (AUF-035)', () => {
  it('withTrackedTimes: merkt die Stoppuhr-Zeiten bei der ersten Aenderung von Beginn oder Ende', () => {
    expect(withTrackedTimes(stoppuhr, { start: tag + 7 * H })).toEqual({
      start: tag + 7 * H,
      trackedTimes: gemerkt,
    });
    expect(withTrackedTimes(stoppuhr, { end: tag + 17 * H, note: 'x' })).toEqual({
      end: tag + 17 * H,
      note: 'x',
      trackedTimes: gemerkt,
    });
    // Gleiche Zeiten, schon gemerkte Zeiten, nachgetragener Eintrag: der Patch bleibt, wie er ist.
    expect(withTrackedTimes(stoppuhr, { start: tag + 8 * H, note: 'x' })).toEqual({
      start: tag + 8 * H,
      note: 'x',
    });
    const schonGeaendert = { ...stoppuhr, start: tag + 7 * H, trackedTimes: gemerkt };
    expect(withTrackedTimes(schonGeaendert, { start: tag + 6 * H })).toEqual({ start: tag + 6 * H });
    expect(withTrackedTimes({ ...stoppuhr, source: 'manual' }, { start: tag + 7 * H })).toEqual({
      start: tag + 7 * H,
    });
  });

  it('changedTrackedTimes: nur wenn die heutigen Zeiten von der Stoppuhr abweichen', () => {
    expect(changedTrackedTimes({ ...stoppuhr, end: tag + 17 * H, trackedTimes: gemerkt })).toEqual(
      gemerkt,
    );
    expect(changedTrackedTimes({ ...stoppuhr, trackedTimes: gemerkt })).toBeUndefined();
    expect(changedTrackedTimes(stoppuhr)).toBeUndefined();
    expect(
      changedTrackedTimes({ ...stoppuhr, source: 'manual', end: tag + 17 * H, trackedTimes: gemerkt }),
    ).toBeUndefined();
  });

  it('cleanTrackedTimes: endliche Zahlen, Ende nach Beginn', () => {
    expect(cleanTrackedTimes({ start: 1, end: 2, x: 3 })).toEqual({ start: 1, end: 2 });
    expect(cleanTrackedTimes({ start: 2, end: 2 })).toBeUndefined();
    expect(cleanTrackedTimes({ start: Number.NaN, end: 2 })).toBeUndefined();
    expect(cleanTrackedTimes({ start: '1', end: 2 })).toBeUndefined();
    expect(cleanTrackedTimes(null)).toBeUndefined();
  });
});
