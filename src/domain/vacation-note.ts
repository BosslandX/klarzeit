import type { VacationDay } from './employment';

/** Hoechstlaenge der Notiz an einem Urlaubstag in Zeichen (AUF-049). */
export const VACATION_NOTE_MAX = 200;

/**
 * Setzt die Notiz eines Urlaubstags (AUF-049): nur am Tag dieser Beschaeftigung, getrimmt und auf
 * `VACATION_NOTE_MAX` Zeichen gekuerzt; leer loescht sie. Die uebrigen Tage bleiben dieselben Objekte. Die Notiz
 * bleibt in Klarzeit: Sie steht nicht im PDF, und an Clockodo geht sie nicht (`note` dort saehe der Arbeitgeber).
 */
export function withVacationNote(
  days: readonly VacationDay[],
  employmentId: string,
  date: number,
  note: string,
): VacationDay[] {
  const text = note.trim().slice(0, VACATION_NOTE_MAX);
  return days.map((d) =>
    d.employmentId === employmentId && d.date === date ? { ...d, note: text } : d,
  );
}
