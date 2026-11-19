import { describe, expect, it } from 'vitest';
import type { VacationDay } from './employment';
import { VACATION_NOTE_MAX, withVacationNote } from './vacation-note';

const TAG = new Date(2026, 10, 4).getTime();
const FOLGETAG = new Date(2026, 10, 5).getTime();
const TAGE: readonly VacationDay[] = [
  { employmentId: 'emp-1', date: TAG, note: '' },
  { employmentId: 'emp-2', date: TAG, note: 'zweite' },
  {
    employmentId: 'emp-1',
    date: FOLGETAG,
    note: 'alt',
    halfDay: true,
    clockodoAbsence: { id: 9, status: 1, at: 1 },
  },
];

describe('Notiz am Urlaubstag (AUF-049)', () => {
  it('setzt die Notiz nur am Tag dieser Beschaeftigung, getrimmt', () => {
    const out = withVacationNote(TAGE, 'emp-1', TAG, '  Brueckentag  ');
    expect(out.map((d) => d.note)).toEqual(['Brueckentag', 'zweite', 'alt']);
    expect(out[1]).toBe(TAGE[1]);
    expect(out[2]).toBe(TAGE[2]);
    expect(TAGE[0].note).toBe('');
  });

  it('eine leere Notiz loescht sie, halber Tag und Clockodo-Antrag bleiben', () => {
    const out = withVacationNote(TAGE, 'emp-1', FOLGETAG, '   ');
    expect(out[2]).toEqual({
      employmentId: 'emp-1',
      date: FOLGETAG,
      note: '',
      halfDay: true,
      clockodoAbsence: { id: 9, status: 1, at: 1 },
    });
  });

  it('kuerzt auf VACATION_NOTE_MAX Zeichen', () => {
    const out = withVacationNote(TAGE, 'emp-1', TAG, 'x'.repeat(VACATION_NOTE_MAX + 5));
    expect(out[0].note).toBe('x'.repeat(VACATION_NOTE_MAX));
  });

  it('ein unbekannter Tag aendert nichts', () => {
    expect(withVacationNote(TAGE, 'emp-1', new Date(2026, 10, 6).getTime(), 'neu')).toEqual(TAGE);
  });
});
