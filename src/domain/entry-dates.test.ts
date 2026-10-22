import { describe, expect, it } from 'vitest';
import { validateBreaks } from './breaks';
import { breakTimeOnEntry, followStartDate, toTimeInput } from './entry-dates';

/** Oktober 2026, lokale Zeit; die Sommerzeit endet am 25.10.2026. */
function um(tag: number, h: number, m = 0): number {
  return new Date(2026, 9, tag, h, m).getTime();
}

const TAG = { start: um(21, 8), end: um(21, 16, 30) };
const NACHT = { start: um(20, 22), end: um(21, 6) };

describe('Ende folgt dem Beginn (AUF-026)', () => {
  it('followStartDate: Beginn auf gestern, das Ende rueckt mit', () => {
    expect(followStartDate(um(22, 9), um(21, 8, 30), um(22, 17))).toBe(um(21, 17));
  });

  it('followStartDate: nur die Uhrzeit des Beginns geaendert, das Ende bleibt', () => {
    expect(followStartDate(um(22, 9), um(22, 7), um(22, 17))).toBe(um(22, 17));
  });

  it('followStartDate: eine Nachtschicht behaelt ihren Folgetag', () => {
    expect(followStartDate(um(20, 22), um(19, 22), um(21, 6))).toBe(um(20, 6));
  });

  it('followStartDate: ueber die Zeitumstellung bleibt die Uhrzeit des Endes', () => {
    expect(followStartDate(um(24, 8), um(25, 8), um(24, 17))).toBe(um(25, 17));
    expect(followStartDate(um(25, 8), um(24, 8), um(25, 17))).toBe(um(24, 17));
  });

  it('followStartDate: ohne gueltige Zeiten bleibt das Ende, wie es ist', () => {
    expect(followStartDate(Number.NaN, um(21, 8), um(22, 17))).toBe(um(22, 17));
    expect(followStartDate(um(22, 9), Number.NaN, um(22, 17))).toBe(um(22, 17));
    expect(followStartDate(um(22, 9), um(21, 9), Number.NaN)).toBeNaN();
  });
});

describe('Pausen ohne Datum (AUF-026)', () => {
  it('toTimeInput: Uhrzeit fuer das Zeitfeld, leer ohne Wert', () => {
    expect(toTimeInput(um(21, 8, 5))).toBe('08:05');
    expect(toTimeInput(um(21, 23, 59))).toBe('23:59');
    expect(toTimeInput(Number.NaN)).toBe('');
  });

  it('breakTimeOnEntry: die Pause liegt am Tag des Eintrags', () => {
    expect(breakTimeOnEntry(TAG.start, TAG.end, '12:00')).toBe(um(21, 12));
    expect(breakTimeOnEntry(TAG.start, TAG.end, '08:00')).toBe(um(21, 8));
    expect(breakTimeOnEntry(TAG.start, TAG.end, '16:30')).toBe(um(21, 16, 30));
  });

  it('breakTimeOnEntry: Nachtschicht, nach Mitternacht am Folgetag', () => {
    expect(breakTimeOnEntry(NACHT.start, NACHT.end, '23:45')).toBe(um(20, 23, 45));
    expect(breakTimeOnEntry(NACHT.start, NACHT.end, '00:15')).toBe(um(21, 0, 15));
    expect(breakTimeOnEntry(NACHT.start, NACHT.end, '06:00')).toBe(um(21, 6));
  });

  it('breakTimeOnEntry: vor dem Beginn und nicht im Folgetag bleibt sie am Tag des Beginns', () => {
    expect(breakTimeOnEntry(TAG.start, TAG.end, '07:30')).toBe(um(21, 7, 30));
    expect(breakTimeOnEntry(NACHT.start, NACHT.end, '07:00')).toBe(um(20, 7));
  });

  it('breakTimeOnEntry: leer, ungueltig oder ohne Beginn ergibt NaN', () => {
    for (const v of ['', '7:30', '24:00', '12:60', 'x']) {
      expect(breakTimeOnEntry(TAG.start, TAG.end, v)).toBeNaN();
    }
    expect(breakTimeOnEntry(Number.NaN, TAG.end, '12:00')).toBeNaN();
  });

  it('breakTimeOnEntry: Rundreise ueber toTimeInput laesst jede Pause, wie sie ist', () => {
    const pausen = [
      { e: TAG, start: um(21, 12), end: um(21, 12, 30) },
      { e: NACHT, start: um(20, 23, 45), end: um(21, 0, 15) },
      { e: NACHT, start: um(21, 3), end: um(21, 3, 30) },
    ];
    for (const p of pausen) {
      expect(breakTimeOnEntry(p.e.start, p.e.end, toTimeInput(p.start))).toBe(p.start);
      expect(breakTimeOnEntry(p.e.start, p.e.end, toTimeInput(p.end))).toBe(p.end);
    }
  });

  it('breakTimeOnEntry mit validateBreaks: eine Pause vor dem Beginn liegt ausserhalb', () => {
    const pause = {
      start: breakTimeOnEntry(TAG.start, TAG.end, '07:30'),
      end: breakTimeOnEntry(TAG.start, TAG.end, '08:15'),
    };
    expect(validateBreaks(TAG, [pause])).toBe(
      'Eine Pause liegt ausserhalb von Beginn und Ende.',
    );
  });

  it('Beginn auf gestern: Ende und Pausen gehen mit', () => {
    const start = um(20, 8);
    const end = followStartDate(um(21, 8), start, um(21, 16, 30));
    expect(end).toBe(um(20, 16, 30));
    expect(breakTimeOnEntry(start, end, '12:00')).toBe(um(20, 12));
    expect(breakTimeOnEntry(start, end, '12:30')).toBe(um(20, 12, 30));
  });
});
