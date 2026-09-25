import {
  ClockodoError,
  createEntry,
  deleteClockodoEntry,
  type ClockodoHttp,
} from './client';
import { getClockodoKey } from './key-store';
import type { ClockodoSync } from '../domain/clockodo';
import {
  buildEntryPayloads,
  entrySyncHash,
  transferStatus,
} from '../domain/clockodo-transfer';
import type { TimeEntry } from '../domain/types';
import {
  getClockodoDeletes,
  removeClockodoDelete,
} from '../db/clockodo-deletes';
import { getEmployments } from '../db/employment';
import { setEntryClockodoSync } from '../db/entries';
import { db } from '../db/db';

export interface TransferResult {
  sent: number;
  deleted: number;
  skipped: { beforeStart: number; untimedBreak: number; incomplete: number };
  errors: { entryId?: number; clockodoId?: number; message: string }[];
  stopped: string | null;
}

function emptyResult(): TransferResult {
  return {
    sent: 0,
    deleted: 0,
    skipped: { beforeStart: 0, untimedBreak: 0, incomplete: 0 },
    errors: [],
    stopped: null,
  };
}

function isFatal(err: ClockodoError): boolean {
  return err.kind === 'auth' || err.kind === 'network' || err.kind === 'rate';
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function entriesForEmployment(
  employmentId: string,
): Promise<TimeEntry[]> {
  return db.entries
    .where('employmentId')
    .equals(employmentId)
    .sortBy('start');
}

async function rollbackCreated(
  auth: { apiUser: string; apiKey: string },
  ids: number[],
  http?: ClockodoHttp,
): Promise<void> {
  for (const id of ids) {
    try {
      await deleteClockodoEntry(auth, id, http);
    } catch {
      /* still */
    }
  }
}

export async function transferEmployment(
  employmentId: string,
  opts?: { http?: ClockodoHttp; now?: () => number },
): Promise<TransferResult> {
  const result = emptyResult();
  const now = opts?.now ?? (() => Date.now());
  const http = opts?.http;

  const list = await getEmployments();
  const employment = list.find((e) => e.id === employmentId);
  const config = employment?.clockodo ?? null;
  if (config === null) {
    result.stopped = 'Clockodo ist fuer diese Beschaeftigung nicht eingeschaltet.';
    return result;
  }
  if (!config.apiUser.trim()) {
    result.stopped = 'Clockodo-Login fehlt.';
    return result;
  }
  const apiKey = await getClockodoKey(employmentId);
  if (!apiKey) {
    result.stopped = 'API-Schluessel fehlt.';
    return result;
  }
  const auth = { apiUser: config.apiUser.trim(), apiKey };

  const pendingDeletes = await getClockodoDeletes(employmentId);
  for (const clockodoId of pendingDeletes) {
    try {
      await deleteClockodoEntry(auth, clockodoId, http);
      await removeClockodoDelete(employmentId, clockodoId);
      result.deleted++;
    } catch (e) {
      if (e instanceof ClockodoError && isFatal(e)) {
        result.stopped = e.message;
        return result;
      }
      result.errors.push({
        clockodoId,
        message: errorMessage(e),
      });
    }
  }

  const entries = await entriesForEmployment(employmentId);
  for (const entry of entries) {
    if (entry.id == null) continue;
    const status = transferStatus(entry, config);
    if (status === 'none') continue;
    if (status === 'before-start') {
      result.skipped.beforeStart++;
      continue;
    }
    if (status === 'untimed-break') {
      result.skipped.untimedBreak++;
      continue;
    }
    if (status === 'incomplete') {
      result.skipped.incomplete++;
      continue;
    }
    if (status === 'synced') continue;

    if (status === 'changed') {
      const sync = entry.clockodoSync;
      if (!sync || sync.ids.length === 0) continue;
      let remaining = [...sync.ids];
      let deleteFailed = false;
      for (const cid of sync.ids) {
        try {
          await deleteClockodoEntry(auth, cid, http);
          remaining = remaining.filter((x) => x !== cid);
          if (remaining.length === 0) {
            await setEntryClockodoSync(entry.id, null);
          } else {
            await setEntryClockodoSync(entry.id, {
              ids: remaining,
              hash: sync.hash,
              at: sync.at,
            });
          }
          result.deleted++;
        } catch (e) {
          if (e instanceof ClockodoError && isFatal(e)) {
            result.stopped = e.message;
            return result;
          }
          result.errors.push({
            entryId: entry.id,
            clockodoId: cid,
            message: errorMessage(e),
          });
          deleteFailed = true;
          break;
        }
      }
      if (deleteFailed) continue;
    }

    const ref = entry.clockodo;
    if (!ref) continue;
    const payloads = buildEntryPayloads(entry, ref, config.billable);
    const created: number[] = [];
    let sendFailed = false;
    for (const payload of payloads) {
      try {
        const id = await createEntry(auth, payload, http);
        created.push(id);
      } catch (e) {
        if (e instanceof ClockodoError && isFatal(e)) {
          await rollbackCreated(auth, created, http);
          result.stopped = e.message;
          return result;
        }
        await rollbackCreated(auth, created, http);
        await setEntryClockodoSync(entry.id, null);
        result.errors.push({
          entryId: entry.id,
          message: errorMessage(e),
        });
        sendFailed = true;
        break;
      }
    }
    if (sendFailed) continue;

    const syncState: ClockodoSync = {
      ids: created,
      hash: entrySyncHash(entry, ref, config.billable),
      at: now(),
    };
    await setEntryClockodoSync(entry.id, syncState);
    result.sent++;
  }

  return result;
}
