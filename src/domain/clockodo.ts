export interface ClockodoConfig {
  apiUser: string;
  syncFrom: number;
  defaultCustomersId: number | null;
  defaultProjectsId: number | null;
  defaultServicesId: number | null;
  billable: 0 | 1 | null;
}

export interface ClockodoEntryRef {
  customersId: number;
  projectsId: number | null;
  servicesId: number;
}

export interface ClockodoLists {
  fetchedAt: number;
  customers: { id: number; name: string }[];
  projects: { id: number; name: string; customersId: number }[];
  services: { id: number; name: string }[];
}

function positiveInt(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.trunc(v);
  if (n <= 0 || n !== v) return null;
  return n;
}

export function cleanClockodoConfig(raw: unknown): ClockodoConfig | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const x = raw as Record<string, unknown>;
  if (typeof x.syncFrom !== 'number' || !Number.isFinite(x.syncFrom)) {
    return null;
  }
  const apiUser = typeof x.apiUser === 'string' ? x.apiUser.trim() : '';
  const billable =
    x.billable === 0 || x.billable === 1 ? (x.billable as 0 | 1) : null;
  return {
    apiUser,
    syncFrom: x.syncFrom,
    defaultCustomersId: positiveInt(x.defaultCustomersId),
    defaultProjectsId: positiveInt(x.defaultProjectsId),
    defaultServicesId: positiveInt(x.defaultServicesId),
    billable,
  };
}

export function cleanClockodoEntryRef(raw: unknown): ClockodoEntryRef | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const x = raw as Record<string, unknown>;
  const customersId = positiveInt(x.customersId);
  const servicesId = positiveInt(x.servicesId);
  if (customersId === null || servicesId === null) return null;
  if (x.projectsId === undefined || x.projectsId === null) {
    return { customersId, projectsId: null, servicesId };
  }
  const projectsId = positiveInt(x.projectsId);
  if (projectsId === null) return null;
  return { customersId, projectsId, servicesId };
}

export interface ClockodoSync {
  ids: number[];
  hash: string;
  at: number;
}

export function cleanClockodoSync(raw: unknown): ClockodoSync | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const x = raw as Record<string, unknown>;
  if (!Array.isArray(x.ids) || x.ids.length === 0) return null;
  const ids: number[] = [];
  for (const id of x.ids) {
    const n = positiveInt(id);
    if (n === null) return null;
    ids.push(n);
  }
  if (typeof x.hash !== 'string' || x.hash.trim() === '') return null;
  if (typeof x.at !== 'number' || !Number.isFinite(x.at)) return null;
  return { ids, hash: x.hash, at: x.at };
}

export function defaultEntryRef(config: ClockodoConfig | null): ClockodoEntryRef | null {
  if (config === null) return null;
  if (config.defaultCustomersId === null || config.defaultServicesId === null) {
    return null;
  }
  return {
    customersId: config.defaultCustomersId,
    projectsId: config.defaultProjectsId,
    servicesId: config.defaultServicesId,
  };
}
