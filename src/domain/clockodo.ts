export interface ClockodoConfig {
  apiUser: string;
  syncFrom: number;
  defaultCustomersId: number | null;
  defaultProjectsId: number | null;
  defaultServicesId: number | null;
  billable: 0 | 1 | null;
  /** Automatisch uebertragen (beim Speichern und beim Oeffnen der App); fehlt = aus */
  autoTransfer?: boolean;
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
    ...(x.autoTransfer === true ? { autoTransfer: true } : {}),
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

/** openapi AbsenceStatus: 0 beantragt, 1 genehmigt, 2 abgelehnt, 3 Genehmigung zurueckgenommen, 4 storniert */
export type ClockodoAbsenceStatus = 0 | 1 | 2 | 3 | 4;

/** Clockodo-Antrag: ID, zuletzt bekannter Status, Zeitpunkt des Abgleichs */
export interface ClockodoAbsenceRef {
  id: number;
  status: ClockodoAbsenceStatus;
  at: number;
}

export function isClockodoAbsenceStatus(v: unknown): v is ClockodoAbsenceStatus {
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  const n = Math.trunc(v);
  return n === v && n >= 0 && n <= 4;
}

export function cleanClockodoAbsenceRef(raw: unknown): ClockodoAbsenceRef | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const x = raw as Record<string, unknown>;
  const id = positiveInt(x.id);
  if (id === null) return null;
  if (!isClockodoAbsenceStatus(x.status)) return null;
  if (typeof x.at !== 'number' || !Number.isFinite(x.at)) return null;
  return { id, status: x.status, at: x.at };
}

/** Gemerkte Sperrfrist aus Clockodo (`edit_lock_dyn`): `days` null = keine Sperrfrist, `at` = gelesen am */
export interface ClockodoLock {
  days: number | null;
  at: number;
}

/** Sperrfrist in Tagen (openapi `edit_lock_dyn`): eine positive ganze Zahl, sonst null. */
export function cleanLockDays(v: unknown): number | null {
  return positiveInt(v);
}

/** Gemerkte Sperrfrist pruefen; kaputt oder unvollstaendig heisst unbekannt (null). */
export function cleanClockodoLock(raw: unknown): ClockodoLock | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const x = raw as Record<string, unknown>;
  if (typeof x.at !== 'number' || !Number.isFinite(x.at)) return null;
  const at = x.at;
  if (x.days === null) return { days: null, at };
  const days = cleanLockDays(x.days);
  if (days === null) return null;
  return { days, at };
}

/**
 * Auswahlliste samt der gespeicherten ID, wenn die Liste sie nicht mehr fuehrt. Keine Scheinoption
 * fuer „nicht gewaehlt“ (0 oder null; AUF-039).
 */
export function withStaleOption(
  items: { id: number; name: string }[],
  selectedId: number | null,
): { id: number; name: string }[] {
  if (selectedId == null || selectedId <= 0 || items.some((i) => i.id === selectedId)) {
    return items;
  }
  return [...items, { id: selectedId, name: `ID ${selectedId}` }];
}

/**
 * Startwert der Clockodo-Auswahl im Formular: die Vorgaben der Beschaeftigung, auch wenn nur ein
 * Teil gesetzt ist; 0 heisst „nicht gewaehlt“. Ein Projekt nur mit seinem Kunden (AUF-039).
 */
export function entrySelectionStart(config: ClockodoConfig | null): ClockodoEntryRef {
  const voll = defaultEntryRef(config);
  if (voll !== null) return voll;
  const kunde = config?.defaultCustomersId ?? null;
  return {
    customersId: kunde ?? 0,
    projectsId: kunde !== null ? (config?.defaultProjectsId ?? null) : null,
    servicesId: config?.defaultServicesId ?? 0,
  };
}

