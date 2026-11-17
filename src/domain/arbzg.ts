import { startOfDay } from 'date-fns';
import { workSegments } from './clockodo-transfer';
import { formatDuration, HOUR, MINUTE, netMs } from './time';
import type { TimeEntry } from './types';

/** Kleinste Pause, die als Ruhepause zaehlt: "jeweils mindestens 15 Minuten" (§ 4 Satz 2 ArbZG). */
const RUHEPAUSE_MIN_MS = 15 * MINUTE;
/** "auf bis zu zehn Stunden" (§ 3 ArbZG). */
const HOECHST_MS = 10 * HOUR;
/** "Laenger als sechs Stunden hintereinander" nicht ohne Ruhepause (§ 4 Satz 3 ArbZG). */
const AM_STUECK_MS = 6 * HOUR;
/** "ununterbrochene Ruhezeit von mindestens elf Stunden" (§ 5 Abs. 1 ArbZG). */
const RUHEZEIT_MS = 11 * HOUR;

/**
 * Hinweise nach dem Arbeitszeitgesetz fuer einen Kalendertag (AUF-037) -- nur Hinweise, keine Sperre.
 * Gerechnet wird ueber alle Beschaeftigungen zusammen: "Arbeitszeiten bei mehreren Arbeitgebern sind
 * zusammenzurechnen" (§ 2 Abs. 1 Satz 1 ArbZG). Ein Eintrag zaehlt zu dem Tag, an dem er beginnt.
 * Geprueft: mehr als 10 Stunden (§ 3), Pausen 30/45 Minuten (§ 4 Satz 1), mehr als 6 Stunden am
 * Stueck (§ 4 Satz 3, nur wo die Pausen mit Uhrzeit bekannt sind), Ruhezeit seit der Arbeit davor
 * (§ 5 Abs. 1).
 */
export function arbzgHints(entries: readonly TimeEntry[], day: number): string[] {
  const tagStart = startOfDay(day).getTime();
  const tag = entries
    .filter((e) => startOfDay(e.start).getTime() === tagStart)
    .sort((a, b) => a.start - b.start);
  if (tag.length === 0) return [];
  const arbeitMs = tag.reduce((s, e) => s + netMs(e), 0);
  const luecken = tag.slice(1).reduce((s, e, i) => {
    const luecke = e.start - tag[i].end;
    return luecke >= RUHEPAUSE_MIN_MS ? s + luecke : s;
  }, 0);
  const pauseMin = Math.round((tag.reduce((s, e) => s + pausenMs(e), 0) + luecken) / MINUTE);
  const noetig = arbeitMs > 9 * HOUR ? 45 : arbeitMs > 6 * HOUR ? 30 : 0;
  const ruhe = ruhezeitMs(entries, tag[0].start);
  return [
    ...(arbeitMs > HOECHST_MS
      ? [`Mehr als 10 Stunden gearbeitet (${formatDuration(arbeitMs)}) – § 3 ArbZG`]
      : []),
    ...(pauseMin < noetig
      ? [`Pausen ${pauseMin} statt mindestens ${noetig} Minuten – § 4 ArbZG`]
      : []),
    ...(laengsterBlockMs(tag) > AM_STUECK_MS
      ? ['Mehr als 6 Stunden ohne Ruhepause – § 4 ArbZG']
      : []),
    ...(ruhe !== undefined && ruhe < RUHEZEIT_MS
      ? [`Ruhezeit nur ${formatDuration(ruhe)} statt mindestens 11 Stunden – § 5 ArbZG`]
      : []),
  ];
}

/** Pause eines Eintrags: mit Uhrzeit nur Abschnitte ab 15 Minuten, sonst die eingetragenen Minuten. */
function pausenMs(e: TimeEntry): number {
  if (!e.breaks || e.breaks.length === 0) return e.breakMinutes * MINUTE;
  const teile = workSegments(e);
  return teile.slice(1).reduce((s, t, i) => {
    const luecke = t.start - teile[i].end;
    return luecke >= RUHEPAUSE_MIN_MS ? s + luecke : s;
  }, 0);
}

/**
 * Laengste Arbeit am Stueck: Abschnitte mit weniger als 15 Minuten dazwischen gelten als einer.
 * Eintraege mit Pause ohne Uhrzeit bleiben aussen vor -- wo die Pause lag, ist unbekannt.
 */
function laengsterBlockMs(tag: readonly TimeEntry[]): number {
  const teile = tag
    .filter((e) => !(e.breakMinutes > 0 && (!e.breaks || e.breaks.length === 0)))
    .flatMap((e) => workSegments(e))
    .sort((a, b) => a.start - b.start);
  const bloecke = teile.reduce<{ start: number; end: number }[]>((out, t) => {
    const letzter = out[out.length - 1];
    if (letzter !== undefined && t.start - letzter.end < RUHEPAUSE_MIN_MS) {
      return [...out.slice(0, -1), { start: letzter.start, end: Math.max(letzter.end, t.end) }];
    }
    return [...out, t];
  }, []);
  return bloecke.reduce((m, b) => Math.max(m, b.end - b.start), 0);
}

/** Ruhezeit vor `beginn` seit dem Ende der Arbeit an einem frueheren Tag; ohne solche undefined. */
function ruhezeitMs(entries: readonly TimeEntry[], beginn: number): number | undefined {
  const tagStart = startOfDay(beginn).getTime();
  const ende = entries
    .filter((e) => e.start < tagStart && e.end <= beginn)
    .reduce<number | undefined>((m, e) => (m === undefined || e.end > m ? e.end : m), undefined);
  return ende === undefined ? undefined : beginn - ende;
}
