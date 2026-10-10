import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import type { ClockodoHttp } from './client';
import { refreshClockodoLock } from './lock';
import { transferEmployment, type TransferResult } from './transfer';
import type { Employment } from '../domain/employment';
import { getEmployments } from '../db/employment';

/** Beschaeftigungen, die automatisch uebertragen: Clockodo an und der Schalter an. */
export function autoTransferEmploymentIds(list: readonly Employment[]): string[] {
  const ids: string[] = [];
  for (const e of list) {
    if (e.clockodo?.autoTransfer === true) ids.push(e.id);
  }
  return ids;
}

/** Nur fuer diese Sitzung: nach einem Neustart zeigt der erste Lauf den Stand neu. */
const letzte = new Map<string, TransferResult>();
const hoerer = new Set<() => void>();

/** Letztes Ergebnis des automatischen Uebertragens je Beschaeftigung (nur in dieser Sitzung). */
export function lastAutoTransferResults(): Record<string, TransferResult> {
  return Object.fromEntries(letzte);
}

/** Meldet jeden abgeschlossenen automatischen Lauf; liefert die Abmeldung. */
export function onAutoTransferResults(listener: () => void): () => void {
  hoerer.add(listener);
  return () => {
    hoerer.delete(listener);
  };
}

function leeresErgebnis(stopped: string): TransferResult {
  return {
    sent: 0,
    deleted: 0,
    skipped: { beforeStart: 0, untimedBreak: 0, incomplete: 0 },
    errors: [],
    stopped,
  };
}

/**
 * Uebertraegt jede Beschaeftigung mit eingeschaltetem automatischem Uebertragen: erst die
 * Sperrfrist auffrischen, dann uebertragen, gesperrte Eintraege auslassen. Scheitert eine
 * Beschaeftigung, wird der Fehler ihr Abbruchgrund, und die naechste laeuft trotzdem.
 */
export async function runAutoTransfer(opts?: {
  http?: ClockodoHttp;
  now?: () => number;
}): Promise<Record<string, TransferResult>> {
  const out: Record<string, TransferResult> = {};
  const ids = autoTransferEmploymentIds(await getEmployments());
  for (const id of ids) {
    let result: TransferResult;
    try {
      await refreshClockodoLock(id, opts);
      result = await transferEmployment(id, {
        http: opts?.http,
        now: opts?.now,
        skipLocked: true,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result = leeresErgebnis(msg);
    }
    out[id] = result;
    letzte.set(id, result);
  }
  for (const h of hoerer) h();
  return out;
}

/** Hinweis zum letzten automatischen Lauf einer Beschaeftigung; null, wenn er durchging. */
export function autoTransferHint(result: TransferResult | undefined): string | null {
  if (result === undefined) return null;
  if (result.stopped != null) {
    return `Automatisches Uebertragen abgebrochen: ${result.stopped}`;
  }
  if (result.errors.length > 0) {
    const n = result.errors.length;
    return `Automatisches Uebertragen: ${n} Fehler – „An Clockodo uebertragen“ unter „Eintraege“ zeigt die Gruende.`;
  }
  return null;
}

export function startAutoTransfer(): void {
  if (!Capacitor.isNativePlatform()) return;
  // Scheitert schon das Lesen der Beschaeftigungen, versucht es der naechste Ausloeser wieder.
  void runAutoTransfer().catch(() => undefined);
}

export function useAutoTransferResults(): Record<string, TransferResult> {
  const [stand, setStand] = useState(lastAutoTransferResults);
  useEffect(() => {
    return onAutoTransferResults(() => setStand(lastAutoTransferResults()));
  }, []);
  return stand;
}
