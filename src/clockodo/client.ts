import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { ClockodoLists } from '../domain/clockodo';

export const CLOCKODO_API = 'https://my.clockodo.com/api';

export interface ClockodoAuth {
  apiUser: string;
  apiKey: string;
}

export interface ClockodoRequest {
  method: 'GET';
  url: string;
  headers: Record<string, string>;
  params?: Record<string, string>;
}

export type ClockodoHttp = (
  req: ClockodoRequest,
) => Promise<{ status: number; data: unknown }>;

export type ClockodoErrorKind =
  | 'auth'
  | 'forbidden'
  | 'rate'
  | 'validation'
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
): Promise<{ id: number; name: string }> {
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
  return { id: d.id, name: d.name };
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
