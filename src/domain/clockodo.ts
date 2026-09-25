export interface ClockodoConfig {
  apiUser: string;
  syncFrom: number;
  defaultCustomersId: number | null;
  defaultProjectsId: number | null;
  defaultServicesId: number | null;
  billable: 0 | 1 | null;
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
