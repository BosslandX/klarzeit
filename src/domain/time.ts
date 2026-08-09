import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import type { TimeEntry } from './types';

export const MINUTE = 60_000;
export const HOUR = 3_600_000;

/** Netto-Arbeitszeit eines Eintrags in Millisekunden (Brutto minus Pause). */
export function netMs(
  entry: Pick<TimeEntry, 'start' | 'end' | 'breakMinutes'>,
): number {
  const gross = entry.end - entry.start;
  const net = gross - entry.breakMinutes * MINUTE;
  return net > 0 ? net : 0;
}

/** Formatiert eine Dauer als "8:30 h" (Stunden:Minuten). */
export function formatDuration(ms: number): string {
  const totalMin = Math.round(ms / MINUTE);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, '0')} h`;
}

/**
 * Vorzeichenbehaftete Dauer fuer Salden, z.B. "+3:20 h", "-1:05 h", "0:00 h".
 * Verwendet ASCII-Minus (CP1252-/jsPDF-sicher).
 */
export function formatSignedDuration(ms: number): string {
  const rounded = Math.round(ms / MINUTE) * MINUTE;
  const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
  return sign + formatDuration(Math.abs(rounded));
}

/** Live-Timer-Format "01:23:45" (Stunden:Minuten:Sekunden). */
export function formatStopwatch(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** Dezimalstunden auf 2 Stellen, z.B. 8.50 */
export function decimalHours(ms: number): number {
  return Math.round((ms / HOUR) * 100) / 100;
}

/** Tagesanzahl mit korrekter Einheit, z.B. "1 Tag", "5 Tage", "4,67 Tage". */
export function formatDays(n: number): string {
  const num = Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
  return `${num} ${n === 1 ? 'Tag' : 'Tage'}`;
}

export function formatClock(epoch: number): string {
  return format(epoch, 'HH:mm', { locale: de });
}

export function formatDate(epoch: number): string {
  return format(epoch, 'dd.MM.yyyy', { locale: de });
}

export function formatDateShort(epoch: number): string {
  return format(epoch, 'EE, dd.MM.', { locale: de });
}

export function formatDateTime(epoch: number): string {
  return format(epoch, 'dd.MM.yyyy HH:mm', { locale: de });
}

/** Wert fuer ein <input type="datetime-local">, z.B. "2026-06-02T08:30". */
export function toDatetimeLocal(epoch: number): string {
  return format(epoch, "yyyy-MM-dd'T'HH:mm");
}

/**
 * Wandelt den Wert eines <input type="datetime-local"> in Epoch-ms (lokale Zeit).
 * Gibt bei leerer/ungueltiger Eingabe bewusst NaN zurueck (kein stiller Fallback
 * auf "jetzt") — der Aufrufer muss NaN als Fehler behandeln.
 * Hinweis: An Sommer-/Winterzeit-Umstelltagen kann eine Wanduhrzeit doppelt oder
 * gar nicht existieren; die Konversion kann dann um +/-1 h abweichen.
 */
export function fromDatetimeLocal(value: string): number {
  return new Date(value).getTime();
}

/**
 * Wandelt den Wert eines <input type="date"> ("yyyy-MM-dd") in Epoch-ms zur
 * LOKALEN Mitternacht. (new Date("yyyy-MM-dd") wuerde UTC-Mitternacht liefern
 * und in manchen Zeitzonen einen Tag verschieben.) NaN bei ungueltiger Eingabe.
 */
export function fromDateInput(value: string): number {
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return Number.NaN;
  return new Date(y, m - 1, d).getTime();
}
