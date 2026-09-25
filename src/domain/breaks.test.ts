import { describe, expect, it } from 'vitest';
import {
  breakMinutesOf,
  resolveBreakMinutes,
  validateBreaks,
} from './breaks';
import type { BreakInterval } from './types';

function E() {
  return {
    start: new Date(2026, 6, 6, 8, 0).getTime(),
    end: new Date(2026, 6, 6, 16, 30).getTime(),
  };
}

function P(h1: number, m1: number, h2: number, m2: number): BreakInterval {
  return {
    start: new Date(2026, 6, 6, h1, m1).getTime(),
    end: new Date(2026, 6, 6, h2, m2).getTime(),
  };
}

describe('breaks', () => {
  it('breakMinutesOf summiert Minuten', () => {
    expect(breakMinutesOf([])).toBe(0);
    expect(breakMinutesOf([P(12, 0, 12, 30)])).toBe(30);
    expect(breakMinutesOf([P(10, 0, 10, 15), P(12, 0, 12, 30)])).toBe(45);
  });

  it('validateBreaks: gueltige unsortierte Pausen', () => {
    expect(validateBreaks(E(), [P(12, 0, 12, 30), P(10, 0, 10, 15)])).toBeNull();
  });

  it('validateBreaks: Pause endet nicht nach Beginn', () => {
    expect(validateBreaks(E(), [P(12, 30, 12, 0)])).toBe(
      'Eine Pause endet nicht nach ihrem Beginn.',
    );
  });

  it('validateBreaks: Pause ausserhalb des Eintrags', () => {
    expect(validateBreaks(E(), [P(7, 30, 8, 15)])).toBe(
      'Eine Pause liegt ausserhalb von Beginn und Ende.',
    );
    expect(validateBreaks(E(), [P(16, 0, 16, 45)])).toBe(
      'Eine Pause liegt ausserhalb von Beginn und Ende.',
    );
  });

  it('validateBreaks: Pausen ueberschneiden sich', () => {
    expect(validateBreaks(E(), [P(12, 0, 12, 30), P(12, 15, 12, 45)])).toBe(
      'Zwei Pausen ueberschneiden sich.',
    );
  });

  it('validateBreaks: Pause so lang wie der Eintrag', () => {
    expect(validateBreaks(E(), [P(8, 0, 16, 30)])).toBe(
      'Die Pause ist laenger als die erfasste Zeitspanne.',
    );
  });

  it('resolveBreakMinutes ohne Pausen behaelt Altwert', () => {
    expect(resolveBreakMinutes([], 30)).toBe(30);
  });

  it('resolveBreakMinutes mit Pausen nimmt die Summe', () => {
    expect(resolveBreakMinutes([P(10, 0, 10, 15)], 30)).toBe(15);
  });
});
