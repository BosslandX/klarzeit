import { addDays, differenceInCalendarDays, format, set } from 'date-fns';

/**
 * Ende nach einer Aenderung des Beginns: Wechselt der Beginn den Kalendertag, rueckt das
 * Ende um dieselbe Zahl Tage mit und behaelt seine Uhrzeit, auch ueber eine Zeitumstellung.
 * Aendert sich nur die Uhrzeit des Beginns, bleibt das Ende; eine Nachtschicht behaelt so
 * ihren Folgetag. Ohne gueltige Zeiten bleibt das Ende, wie es ist.
 */
export function followStartDate(
  prevStart: number,
  nextStart: number,
  end: number,
): number {
  if (
    !Number.isFinite(prevStart) ||
    !Number.isFinite(nextStart) ||
    !Number.isFinite(end)
  ) {
    return end;
  }
  const days = differenceInCalendarDays(nextStart, prevStart);
  return days === 0 ? end : addDays(end, days).getTime();
}

/** Wert fuer ein <input type="time">, z.B. "08:05"; leer ohne gueltigen Zeitpunkt. */
export function toTimeInput(epoch: number): string {
  return Number.isFinite(epoch) ? format(epoch, 'HH:mm') : '';
}

/**
 * Uhrzeit einer Pause ("HH:mm") als Zeitpunkt im Eintrag: am Tag des Beginns; liegt sie dort
 * vor dem Beginn, am Folgetag -- aber nur, wenn sie dann nicht nach dem Ende liegt
 * (Nachtschicht). Sonst bleibt sie am Tag des Beginns, und validateBreaks meldet sie als
 * ausserhalb. NaN bei leerer oder ungueltiger Eingabe und ohne gueltigen Beginn.
 */
export function breakTimeOnEntry(
  entryStart: number,
  entryEnd: number,
  value: string,
): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!m || !Number.isFinite(entryStart)) return Number.NaN;
  const sameDay = set(entryStart, {
    hours: Number(m[1]),
    minutes: Number(m[2]),
    seconds: 0,
    milliseconds: 0,
  }).getTime();
  if (sameDay >= entryStart) return sameDay;
  const nextDay = addDays(sameDay, 1).getTime();
  return nextDay <= entryEnd ? nextDay : sameDay;
}
