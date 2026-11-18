import type { ClockodoConfig, ClockodoEntryRef } from './clockodo';
import type { BreakInterval, TimeEntry } from './types';
import { formatDateTime } from './time';

export interface ClockodoEntryPayload {
  customers_id: number;
  services_id: number;
  projects_id?: number;
  billable?: 0 | 1;
  time_since: string;
  time_until: string;
  text?: string;
}

export type TransferStatus =
  | 'none'
  | 'done'
  | 'before-start'
  | 'untimed-break'
  | 'incomplete'
  | 'pending'
  | 'changed'
  | 'synced';

function clampBreaks(
  entry: Pick<TimeEntry, 'start' | 'end' | 'breaks'>,
): BreakInterval[] {
  const breaks = entry.breaks;
  if (!breaks || breaks.length === 0) return [];
  const sorted = [...breaks].sort((a, b) => a.start - b.start);
  const out: BreakInterval[] = [];
  for (const b of sorted) {
    const start = Math.max(b.start, entry.start);
    const end = Math.min(b.end, entry.end);
    if (end > start) out.push({ start, end });
  }
  return out;
}

export function workSegments(
  entry: Pick<TimeEntry, 'start' | 'end' | 'breaks'>,
): { start: number; end: number }[] {
  const breaks = clampBreaks(entry);
  if (breaks.length === 0) {
    return entry.end > entry.start
      ? [{ start: entry.start, end: entry.end }]
      : [];
  }
  const segments: { start: number; end: number }[] = [];
  let cursor = entry.start;
  for (const b of breaks) {
    if (b.start > cursor) {
      segments.push({ start: cursor, end: b.start });
    }
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < entry.end) {
    segments.push({ start: cursor, end: entry.end });
  }
  return segments.filter((s) => s.end > s.start);
}

export function toClockodoTime(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function entryText(
  entry: Pick<TimeEntry, 'activity' | 'note'>,
): string | null {
  const parts: string[] = [];
  const activity = entry.activity.trim();
  const note = entry.note.trim();
  if (activity) parts.push(activity);
  if (note) parts.push(note);
  if (parts.length === 0) return null;
  return parts.join(' – ');
}

export function buildEntryPayloads(
  entry: Pick<TimeEntry, 'start' | 'end' | 'breaks' | 'activity' | 'note'>,
  ref: ClockodoEntryRef,
  billable: 0 | 1 | null,
): ClockodoEntryPayload[] {
  const text = entryText(entry);
  return workSegments(entry).map((seg) => {
    const payload: ClockodoEntryPayload = {
      customers_id: ref.customersId,
      services_id: ref.servicesId,
      time_since: toClockodoTime(seg.start),
      time_until: toClockodoTime(seg.end),
    };
    if (ref.projectsId !== null) {
      payload.projects_id = ref.projectsId;
    }
    if (billable !== null) {
      payload.billable = billable;
    }
    if (text !== null) {
      payload.text = text;
    }
    return payload;
  });
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a32(str: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function entrySyncHash(
  entry: Pick<TimeEntry, 'start' | 'end' | 'breaks' | 'activity' | 'note'>,
  ref: ClockodoEntryRef,
  billable: 0 | 1 | null,
): string {
  const payloads = buildEntryPayloads(entry, ref, billable);
  return fnv1a32(JSON.stringify(payloads));
}

export function transferStatus(
  entry: TimeEntry,
  config: ClockodoConfig | null,
): TransferStatus {
  if (config === null) return 'none';
  // Von Hand in Clockodo erledigt: gilt endgueltig, auch nach einer Aenderung (AUF-040).
  if (entry.clockodoDone !== undefined) return 'done';
  if (entry.start < config.syncFrom) return 'before-start';
  const breaks = entry.breaks;
  if (
    entry.breakMinutes > 0 &&
    (breaks === undefined || breaks.length === 0)
  ) {
    return 'untimed-break';
  }
  if (!entry.clockodo) return 'incomplete';
  if (!entry.clockodoSync) return 'pending';
  const hash = entrySyncHash(entry, entry.clockodo, config.billable);
  if (entry.clockodoSync.hash !== hash) return 'changed';
  return 'synced';
}

/** Zaehlung im Clockodo-Kasten von „Eintraege“ (AUF-039). */
export interface TransferBuckets {
  open: number;
  untimed: number;
  incomplete: number;
  beforeStart: number;
}

/** Eintraege einer Beschaeftigung nach Stand; vor „Uebertragen ab“ zaehlt mit (AUF-039). */
export function countTransferBuckets(
  list: readonly TimeEntry[],
  employmentId: string,
  config: ClockodoConfig,
): TransferBuckets {
  let open = 0;
  let untimed = 0;
  let incomplete = 0;
  let beforeStart = 0;
  for (const e of list) {
    if (e.employmentId !== employmentId) continue;
    const s = transferStatus(e, config);
    if (s === 'pending' || s === 'changed') open++;
    else if (s === 'untimed-break') untimed++;
    else if (s === 'incomplete') incomplete++;
    else if (s === 'before-start') beforeStart++;
  }
  return { open, untimed, incomplete, beforeStart };
}

/**
 * „als erledigt markieren“ nur an offenen, nie uebertragenen Eintraegen (AUF-040): ohne
 * Uebertragungsstand und noch nicht uebertragen, ohne Auswahl oder mit Pause ohne Uhrzeit.
 */
export function canMarkClockodoDone(entry: TimeEntry, config: ClockodoConfig | null): boolean {
  if (entry.clockodoSync) return false;
  const s = transferStatus(entry, config);
  return s === 'pending' || s === 'incomplete' || s === 'untimed-break';
}

/** Rueckfrage vor dem Markieren (done) oder Aufheben (AUF-040). */
export function clockodoDoneQuestion(entry: Pick<TimeEntry, 'start'>, done: boolean): string {
  const tag = formatDateTime(entry.start);
  return done
    ? `Eintrag vom ${tag} als in Clockodo erledigt markieren?
` +
        'Klarzeit sendet ihn danach nie mehr, auch nicht nach einer Aenderung.'
    : `Eintrag vom ${tag} wieder als offen fuehren?
` +
        'Ist er vollstaendig, sendet Klarzeit ihn beim naechsten Uebertragen.';
}
