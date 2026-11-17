import { describe, expect, it } from 'vitest';
import { arbzgHints } from './arbzg';
import type { TimeEntry } from './types';

const H = 3_600_000;
const M = 60_000;
const tag = new Date(2026, 10, 10).getTime(); // Di 10.11.2026
const e = (
  von: number,
  bis: number,
  breakMinutes = 0,
  extra: Partial<TimeEntry> = {},
): TimeEntry => ({
  employmentId: 'emp-1',
  start: tag + von,
  end: tag + bis,
  breakMinutes,
  activity: '',
  note: '',
  source: 'manual',
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

describe('Hinweise nach dem Arbeitszeitgesetz (AUF-037)', () => {
  it('mehr als 10 Stunden Arbeitszeit am Tag', () => {
    expect(arbzgHints([e(7 * H, 18 * H, 45)], tag)).toEqual([
      'Mehr als 10 Stunden gearbeitet (10:15 h) – § 3 ArbZG',
    ]);
  });

  it('Pausen: 30 Minuten ab 6, 45 ab 9 Stunden; Luecken ab 15 Minuten zaehlen mit', () => {
    expect(arbzgHints([e(8 * H, 15 * H, 20)], tag)).toEqual([
      'Pausen 20 statt mindestens 30 Minuten – § 4 ArbZG',
    ]);
    expect(arbzgHints([e(7 * H, 17 * H, 30)], tag)).toEqual([
      'Pausen 30 statt mindestens 45 Minuten – § 4 ArbZG',
    ]);
    expect(arbzgHints([e(8 * H, 12 * H), e(12 * H + 30 * M, 15 * H + 30 * M)], tag)).toEqual([]);
    expect(arbzgHints([e(8 * H, 12 * H), e(12 * H + 10 * M, 15 * H + 10 * M)], tag)).toEqual([
      'Pausen 0 statt mindestens 30 Minuten – § 4 ArbZG',
      'Mehr als 6 Stunden ohne Ruhepause – § 4 ArbZG',
    ]);
  });

  it('mehr als 6 Stunden am Stueck, nur wo die Pausen mit Uhrzeit bekannt sind', () => {
    const spaetePause = { breaks: [{ start: tag + 14 * H + 30 * M, end: tag + 15 * H }] };
    expect(arbzgHints([e(8 * H, 16 * H, 30, spaetePause)], tag)).toEqual([
      'Mehr als 6 Stunden ohne Ruhepause – § 4 ArbZG',
    ]);
    expect(arbzgHints([e(8 * H, 16 * H, 30)], tag)).toEqual([]);
  });

  it('Ruhezeit unter 11 Stunden seit der Arbeit am Vortag', () => {
    const gestern = e(-10 * H, -1 * H); // 09.11. 14:00 bis 23:00
    expect(arbzgHints([gestern, e(8 * H, 12 * H)], tag)).toEqual([
      'Ruhezeit nur 9:00 h statt mindestens 11 Stunden – § 5 ArbZG',
    ]);
    expect(arbzgHints([e(-10 * H, -4 * H), e(8 * H, 12 * H)], tag)).toEqual([]);
  });

  it('zwei Beschaeftigungen werden zusammengerechnet', () => {
    const zwei = [e(8 * H, 13 * H), e(13 * H + 30 * M, 19 * H + 30 * M, 0, { employmentId: 'emp-2' })];
    expect(arbzgHints(zwei, tag)).toEqual([
      'Mehr als 10 Stunden gearbeitet (11:00 h) – § 3 ArbZG',
      'Pausen 30 statt mindestens 45 Minuten – § 4 ArbZG',
    ]);
  });

  it('normaler Tag und Tag ohne Eintrag: keine Hinweise', () => {
    expect(arbzgHints([e(8 * H, 16 * H + 30 * M, 30)], tag)).toEqual([]);
    expect(arbzgHints([e(8 * H, 16 * H + 30 * M, 30)], tag + 24 * H)).toEqual([]);
  });
});
