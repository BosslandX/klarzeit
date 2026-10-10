import { Capacitor, CapacitorHttp } from '@capacitor/core';
import {
  cleanLockDays,
  isClockodoAbsenceStatus,
  type ClockodoAbsenceStatus,
  type ClockodoLists,
} from '../domain/clockodo';
import type { ClockodoEntryPayload } from '../domain/clockodo-transfer';

export const CLOCKODO_API = 'https://my.clockodo.com/api';

export interface ClockodoAuth {
  apiUser: string;
  apiKey: string;
}

export interface ClockodoRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  headers: Record<string, string>;
  params?: Record<string, string>;
  data?: unknown;
}

export type ClockodoHttp = (
  req: ClockodoRequest,
) => Promise<{ status: number; data: unknown }>;

export type ClockodoErrorKind =
  | 'auth'
  | 'forbidden'
  | 'rate'
  | 'validation'
  | 'collision'
  | 'server'
  | 'network'
  | 'format';

export class ClockodoError extends Error {
  readonly kind: ClockodoErrorKind;
  readonly status?: number;

  constructor(kind: ClockodoErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'ClockodoError';
    this.kind = kind;
    this.status = status;
  }
}

export function clockodoHeaders(auth: ClockodoAuth): Record<string, string> {
  return {
    'X-ClockodoApiUser': auth.apiUser,
    'X-ClockodoApiKey': auth.apiKey,
    'X-Clockodo-External-Application': `Klarzeit;${auth.apiUser}`,
    Accept: 'application/json',
  };
}

function parseData(data: unknown): unknown {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      throw new ClockodoError('format', 'Unerwartete Antwort von Clockodo.');
    }
  }
  return data;
}

function mapStatus(status: number): ClockodoError | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401) {
    return new ClockodoError(
      'auth',
      'Anmeldung bei Clockodo fehlgeschlagen: E-Mail oder API-Schluessel pruefen.',
      status,
    );
  }
  if (status === 403) {
    return new ClockodoError(
      'forbidden',
      'Keine Berechtigung bei Clockodo.',
      status,
    );
  }
  if (status === 429) {
    return new ClockodoError(
      'rate',
      'Zu viele Anfragen an Clockodo, bitte spaeter erneut versuchen.',
      status,
    );
  }
  if (status === 400 || status === 422) {
    return new ClockodoError(
      'validation',
      `Clockodo hat die Anfrage abgelehnt (Status ${status}).`,
      status,
    );
  }
  return new ClockodoError(
    'server',
    `Clockodo meldet einen Fehler (Status ${status}).`,
    status,
  );
}

async function defaultHttp(
  req: ClockodoRequest,
): Promise<{ status: number; data: unknown }> {
  if (!Capacitor.isNativePlatform()) {
    throw new ClockodoError(
      'network',
      'Clockodo ist nur in der Android-App erreichbar.',
    );
  }
  try {
    const res = await CapacitorHttp.request({
      method: req.method,
      url: req.url,
      headers: req.headers,
      params: req.params,
      data: req.data,
    });
    return { status: res.status, data: res.data };
  } catch {
    throw new ClockodoError('network', 'Keine Verbindung zu Clockodo.');
  }
}

async function clockodoGet(
  auth: ClockodoAuth,
  path: string,
  params?: Record<string, string>,
  http: ClockodoHttp = defaultHttp,
): Promise<unknown> {
  let res: { status: number; data: unknown };
  try {
    res = await http({
      method: 'GET',
      url: `${CLOCKODO_API}${path}`,
      headers: clockodoHeaders(auth),
      params,
    });
  } catch (e) {
    if (e instanceof ClockodoError) throw e;
    throw new ClockodoError('network', 'Keine Verbindung zu Clockodo.');
  }
  const err = mapStatus(res.status);
  if (err) throw err;
  return parseData(res.data);
}

export async function fetchMe(
  auth: ClockodoAuth,
  http?: ClockodoHttp,
): Promise<{ id: number; name: string; editLockDays: number | null }> {
  const body = await clockodoGet(auth, '/v4/users/me', undefined, http);
  if (typeof body !== 'object' || body === null) {
    throw new ClockodoError('format', 'Unerwartete Antwort von Clockodo.');
  }
  const data = (body as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) {
    throw new ClockodoError('format', 'Unerwartete Antwort von Clockodo.');
  }
  const d = data as Record<string, unknown>;
  if (typeof d.id !== 'number' || typeof d.name !== 'string') {
    throw new ClockodoError('format', 'Unerwartete Antwort von Clockodo.');
  }
  return {
    id: d.id,
    name: d.name,
    editLockDays: cleanLockDays(d.edit_lock_dyn),
  };
}

interface Paging {
  count_pages?: number;
}

function cleanCustomer(raw: unknown): { id: number; name: string } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const x = raw as Record<string, unknown>;
  if (x.active !== true) return null;
  if (typeof x.id !== 'number' || !Number.isInteger(x.id)) return null;
  if (typeof x.name !== 'string') return null;
  return { id: x.id, name: x.name };
}

function cleanProject(
  raw: unknown,
): { id: number; name: string; customersId: number } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const x = raw as Record<string, unknown>;
  if (x.active !== true) return null;
  if (typeof x.id !== 'number' || !Number.isInteger(x.id)) return null;
  if (typeof x.name !== 'string') return null;
  if (typeof x.customers_id !== 'number' || !Number.isInteger(x.customers_id)) {
    return null;
  }
  return { id: x.id, name: x.name, customersId: x.customers_id };
}

function cleanService(raw: unknown): { id: number; name: string } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const x = raw as Record<string, unknown>;
  if (x.active !== true) return null;
  if (typeof x.id !== 'number' || !Number.isInteger(x.id)) return null;
  if (typeof x.name !== 'string') return null;
  return { id: x.id, name: x.name };
}

async function fetchPagedList<T>(
  auth: ClockodoAuth,
  path: string,
  clean: (raw: unknown) => T | null,
  http: ClockodoHttp,
): Promise<T[]> {
  const out: T[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const body = await clockodoGet(
      auth,
      path,
      { items_per_page: '1000', page: String(page) },
      http,
    );
    if (typeof body !== 'object' || body === null) {
      throw new ClockodoError('format', 'Unerwartete Antwort von Clockodo.');
    }
    const rec = body as { data?: unknown; paging?: Paging };
    const chunk = Array.isArray(rec.data) ? rec.data : [];
    for (const item of chunk) {
      const c = clean(item);
      if (c) out.push(c);
    }
    const cp = rec.paging?.count_pages;
    totalPages =
      typeof cp === 'number' && Number.isFinite(cp) && cp >= 1 ? cp : 1;
    page += 1;
  } while (page <= totalPages);
  return out;
}

export async function fetchLists(
  auth: ClockodoAuth,
  http?: ClockodoHttp,
  now: number = Date.now(),
): Promise<ClockodoLists> {
  const h = http ?? defaultHttp;
  const customers = await fetchPagedList(
    auth,
    '/v3/customers',
    cleanCustomer,
    h,
  );
  const projects = await fetchPagedList(
    auth,
    '/v4/projects',
    cleanProject,
    h,
  );
  const services = await fetchPagedList(
    auth,
    '/v4/services',
    cleanService,
    h,
  );
  const sortName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, 'de');
  customers.sort(sortName);
  projects.sort(sortName);
  services.sort(sortName);
  return {
    fetchedAt: now,
    customers,
    projects,
    services,
  };
}

function positiveEntryId(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.trunc(v);
  if (n <= 0 || n !== v) return null;
  return n;
}

async function clockodoRequest(
  auth: ClockodoAuth,
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  data?: unknown,
  http: ClockodoHttp = defaultHttp,
): Promise<{ status: number; data: unknown }> {
  let res: { status: number; data: unknown };
  try {
    res = await http({
      method,
      url: `${CLOCKODO_API}${path}`,
      headers: {
        ...clockodoHeaders(auth),
        ...(method === 'POST' || method === 'PUT'
          ? { 'Content-Type': 'application/json' }
          : {}),
      },
      data,
    });
  } catch (e) {
    if (e instanceof ClockodoError) throw e;
    throw new ClockodoError('network', 'Keine Verbindung zu Clockodo.');
  }
  return { status: res.status, data: res.data };
}

export async function createEntry(
  auth: ClockodoAuth,
  payload: ClockodoEntryPayload,
  http?: ClockodoHttp,
): Promise<number> {
  const h = http ?? defaultHttp;
  const res = await clockodoRequest(auth, 'POST', '/v2/entries', payload, h);
  const err = mapStatus(res.status);
  if (err) throw err;
  // Erst der Status, dann die Form: ein Fehlerstatus mit Nicht-JSON-Antwort muss als
  // dieser Fehler ankommen (401 -> auth, damit ein Lauf abbricht), nicht als 'format'.
  const body = parseData(res.data);
  if (typeof body !== 'object' || body === null) {
    throw new ClockodoError('format', 'Unerwartete Antwort von Clockodo.');
  }
  const entry = (body as { entry?: unknown }).entry;
  if (typeof entry !== 'object' || entry === null) {
    throw new ClockodoError('format', 'Unerwartete Antwort von Clockodo.');
  }
  const id = positiveEntryId((entry as { id?: unknown }).id);
  if (id === null) {
    throw new ClockodoError('format', 'Unerwartete Antwort von Clockodo.');
  }
  return id;
}

export async function deleteClockodoEntry(
  auth: ClockodoAuth,
  id: number,
  http?: ClockodoHttp,
): Promise<void> {
  const h = http ?? defaultHttp;
  const res = await clockodoRequest(
    auth,
    'DELETE',
    `/v2/entries/${id}`,
    undefined,
    h,
  );
  if (res.status === 404) return;
  const err = mapStatus(res.status);
  if (err) throw err;
}

/** openapi: type 1 = Holiday from the quota */
const ABSENCE_TYPE_HOLIDAY_QUOTA = 1;
/** openapi AbsenceStatus: 0 = Enquired (beantragt) */
const ABSENCE_STATUS_ENQUIRED = 0;
/** openapi AbsenceStatus: 4 = Cancelled (storniert) */
const ABSENCE_STATUS_CANCELLED = 4;

const DATE_INPUT = /^\d{4}-\d{2}-\d{2}$/;

export interface ClockodoAbsence {
  id: number;
  dateSince: string;
  dateUntil: string;
  status: ClockodoAbsenceStatus;
  countDays: number | null;
}

function absenceDateString(v: unknown): string | null {
  if (typeof v !== 'string' || !DATE_INPUT.test(v)) return null;
  return v;
}

function readAbsence(raw: unknown): ClockodoAbsence | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const x = raw as Record<string, unknown>;
  const id = positiveEntryId(x.id);
  const dateSince = absenceDateString(x.date_since);
  const dateUntil = absenceDateString(x.date_until);
  if (id === null || dateSince === null || dateUntil === null) return null;
  if (!isClockodoAbsenceStatus(x.status)) return null;
  let countDays: number | null = null;
  if (typeof x.count_days === 'number' && Number.isFinite(x.count_days)) {
    countDays = x.count_days;
  }
  return { id, dateSince, dateUntil, status: x.status, countDays };
}

/** Fehlertypen aus beiden Fehlerformen (`errors[].type`, `errors[].error.type`), auch aus JSON-Text. */
function extractErrorTypes(data: unknown): string[] {
  let body = data;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return [];
    }
  }
  if (typeof body !== 'object' || body === null) return [];
  const errors = (body as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return [];
  const types: string[] = [];
  for (const item of errors) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.type === 'string') types.push(rec.type);
    const inner = rec.error;
    if (
      typeof inner === 'object' &&
      inner !== null &&
      typeof (inner as { type?: unknown }).type === 'string'
    ) {
      types.push((inner as { type: string }).type);
    }
  }
  return types;
}

function mapAbsenceError(status: number, data: unknown): ClockodoError | null {
  if (status >= 200 && status < 300) return null;
  const mapped = mapStatus(status);
  if (mapped && (mapped.kind === 'auth' || mapped.kind === 'rate')) return mapped;
  const types = extractErrorTypes(data);
  if (status === 409 || types.includes('AbsenceCollision')) {
    return new ClockodoError(
      'collision',
      'Der Zeitraum ueberschneidet sich mit einer Abwesenheit in Clockodo.',
      status,
    );
  }
  if (
    types.includes('StatusIsForbidden') ||
    types.includes('CannotManageAbsencesOfUser')
  ) {
    return new ClockodoError(
      'forbidden',
      'Clockodo laesst einen Urlaubsantrag fuer diesen Zugang nicht zu.',
      status,
    );
  }
  if (types.includes('AbsenceHasToBeDeclined')) {
    return new ClockodoError(
      'forbidden',
      'Der Antrag muss in Clockodo erst abgelehnt werden.',
      status,
    );
  }
  if (types.includes('UntilMustBeInSameYear')) {
    return new ClockodoError(
      'validation',
      'Ein Urlaubsantrag darf nicht ueber den Jahreswechsel gehen.',
      status,
    );
  }
  return mapStatus(status);
}

/** Die Abwesenheit aus der Antwort von POST/PUT, auch aus JSON-Text; sonst ein Formatfehler. */
function absenceFromBody(raw: unknown): ClockodoAbsence {
  let body = raw;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      throw new ClockodoError('format', 'Unerwartete Antwort von Clockodo.');
    }
  }
  if (typeof body !== 'object' || body === null) {
    throw new ClockodoError('format', 'Unerwartete Antwort von Clockodo.');
  }
  const data = (body as { data?: unknown }).data;
  const absence = readAbsence(data);
  if (absence === null) {
    throw new ClockodoError('format', 'Unerwartete Antwort von Clockodo.');
  }
  return absence;
}

export async function createAbsence(
  auth: ClockodoAuth,
  request: { usersId: number; dateSince: string; dateUntil: string },
  http?: ClockodoHttp,
): Promise<ClockodoAbsence> {
  const h = http ?? defaultHttp;
  const res = await clockodoRequest(
    auth,
    'POST',
    '/v4/absences',
    {
      users_id: request.usersId,
      date_since: request.dateSince,
      date_until: request.dateUntil,
      type: ABSENCE_TYPE_HOLIDAY_QUOTA,
      status: ABSENCE_STATUS_ENQUIRED,
    },
    h,
  );
  const err = mapAbsenceError(res.status, res.data);
  if (err) throw err;
  return absenceFromBody(res.data);
}

export async function fetchAbsences(
  auth: ClockodoAuth,
  request: { usersId: number; year: number },
  http?: ClockodoHttp,
): Promise<ClockodoAbsence[]> {
  const h = http ?? defaultHttp;
  let body: unknown;
  try {
    body = await clockodoGet(
      auth,
      '/v4/absences',
      {
        'filter[users_id]': String(request.usersId),
        'filter[year]': String(request.year),
        'filter[type]': '1',
      },
      h,
    );
  } catch (e) {
    if (e instanceof ClockodoError) throw e;
    throw new ClockodoError('network', 'Keine Verbindung zu Clockodo.');
  }
  if (typeof body !== 'object' || body === null) {
    throw new ClockodoError('format', 'Unerwartete Antwort von Clockodo.');
  }
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    throw new ClockodoError('format', 'Unerwartete Antwort von Clockodo.');
  }
  const out: ClockodoAbsence[] = [];
  for (const item of data) {
    const a = readAbsence(item);
    if (a === null) {
      throw new ClockodoError('format', 'Unerwartete Antwort von Clockodo.');
    }
    out.push(a);
  }
  return out;
}

/** Loescht eine Abwesenheit in Clockodo; `false` heisst: dort schon nicht mehr vorhanden (404). */
export async function deleteAbsence(
  auth: ClockodoAuth,
  id: number,
  http?: ClockodoHttp,
): Promise<boolean> {
  const h = http ?? defaultHttp;
  const res = await clockodoRequest(
    auth,
    'DELETE',
    `/v4/absences/${id}`,
    undefined,
    h,
  );
  if (res.status === 404) return false;
  const err = mapAbsenceError(res.status, res.data);
  if (err) throw err;
  return true;
}

/** Storniert eine Abwesenheit (PUT mit Status 4); `null` heisst: dort schon nicht mehr vorhanden (404). */
export async function cancelAbsence(
  auth: ClockodoAuth,
  id: number,
  http?: ClockodoHttp,
): Promise<ClockodoAbsence | null> {
  const h = http ?? defaultHttp;
  const res = await clockodoRequest(
    auth,
    'PUT',
    `/v4/absences/${id}`,
    { status: ABSENCE_STATUS_CANCELLED },
    h,
  );
  if (res.status === 404) return null;
  const err = mapAbsenceError(res.status, res.data);
  if (err) throw err;
  return absenceFromBody(res.data);
}
