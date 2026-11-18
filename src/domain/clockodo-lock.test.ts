import { describe, expect, it } from 'vitest';
import { cleanClockodoLock, cleanLockDays, type ClockodoConfig } from './clockodo';
import { entrySyncHash } from './clockodo-transfer';
import type { TimeEntry } from './types';
import {
  clockodoEntryLabel,
  countLockStates,
  lastSendDay,
  lockDaysText,
  lockHint,
  lockState,
  lockedEntryMessage,
} from './clockodo-lock';

const REF = { customersId: 11, projectsId: null, servicesId: 31 };
const CFG: ClockodoConfig = {
  apiUser: 'testnutzer',
  syncFrom: new Date(2026, 9, 1).getTime(),
  defaultCustomersId: 11,
  defaultProjectsId: null,
  defaultServicesId: 31,
  billable: null,
};
const um = (m: number, d: number, h = 0, min = 0) => new Date(2026, m - 1, d, h, min).getTime();
/** Samstag, 10.10.2026, 12:00 */
const NOW = um(10, 10, 12);
const LOCK3 = { days: 3, at: 1 };

function eintrag(m: number, d: number, over: Partial<TimeEntry> = {}): TimeEntry {
  return {
    employmentId: 'emp-1',
    start: um(m, d, 8),
    end: um(m, d, 16),
    breakMinutes: 0,
    activity: 'Doku',
    note: '',
    source: 'manual',
    createdAt: 1,
    updatedAt: 1,
    clockodo: REF,
    ...over,
  };
}

function uebertragen(e: TimeEntry): TimeEntry {
  return { ...e, clockodoSync: { ids: [5], hash: entrySyncHash(e, REF, CFG.billable), at: 1 } };
}

describe('Clockodo-Sperrfrist (AUF-024)', () => {
  it('cleanLockDays und cleanClockodoLock', () => {
    expect(cleanLockDays(3)).toBe(3);
    expect(cleanLockDays(91)).toBe(91);
    for (const v of [0, -1, 2.5, '3', null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(cleanLockDays(v)).toBeNull();
    }
    expect(cleanClockodoLock({ days: 3, at: 5 })).toEqual({ days: 3, at: 5 });
    expect(cleanClockodoLock({ days: null, at: 5 })).toEqual({ days: null, at: 5 });
    for (const raw of [{ days: 0, at: 5 }, { days: 3 }, { at: 5 }, { days: '3', at: 5 }, 'kaputt', null]) {
      expect(cleanClockodoLock(raw)).toBeNull();
    }
  });

  it('lastSendDay: Eintragstag plus Sperrtage minus 1, in Kalendertagen', () => {
    expect(lastSendDay(um(10, 8, 14), 3)).toBe(um(10, 10));
    expect(lastSendDay(um(10, 8, 14), 1)).toBe(um(10, 8));
    expect(lastSendDay(um(9, 30, 23, 59), 3)).toBe(um(10, 2));
    expect(lastSendDay(um(10, 1, 7), 91)).toBe(um(12, 30));
  });

  it('lastSendDay ueber das Ende der Sommerzeit (25.10.2026)', () => {
    expect(lastSendDay(um(10, 23, 9), 3)).toBe(um(10, 25));
    expect(lastSendDay(um(10, 24, 9), 3)).toBe(um(10, 26));
    expect(lastSendDay(um(10, 24, 9), 8)).toBe(um(10, 31));
  });

  it('lockState je Tag, auch am Tag der Zeitumstellung', () => {
    const e = um(10, 23, 9);
    expect(lockState(e, 3, um(10, 23, 18))).toBe('ok');
    expect(lockState(e, 3, um(10, 24, 0))).toBe('due-tomorrow');
    expect(lockState(e, 3, um(10, 25, 0))).toBe('due-today');
    expect(lockState(e, 3, um(10, 25, 23, 30))).toBe('due-today');
    expect(lockState(e, 3, um(10, 26, 0))).toBe('locked');
    expect(lockState(e, 1, um(10, 23, 23, 59))).toBe('due-today');
    expect(lockState(e, 1, um(10, 24, 0))).toBe('locked');
  });

  it('countLockStates zaehlt nur offene Eintraege dieser Beschaeftigung', () => {
    const entries = [
      eintrag(10, 10),
      eintrag(10, 9),
      eintrag(10, 8, { clockodo: undefined }),
      eintrag(10, 8, { note: 'neu', clockodoSync: { ids: [5], hash: 'alt', at: 1 } }),
      eintrag(10, 7, { breakMinutes: 30 }),
      uebertragen(eintrag(10, 7)),
      eintrag(9, 30),
      eintrag(10, 9, { employmentId: 'emp-2' }),
    ];
    expect(countLockStates(entries, 'emp-1', CFG, 3, NOW)).toEqual({
      open: 5,
      dueTomorrow: 1,
      dueToday: 2,
      locked: 1,
    });
    expect(countLockStates(entries, 'emp-1', CFG, null, NOW)).toEqual({
      open: 5,
      dueTomorrow: 0,
      dueToday: 0,
      locked: 0,
    });
    expect(countLockStates(entries, 'emp-2', CFG, 3, NOW)).toEqual({
      open: 1,
      dueTomorrow: 1,
      dueToday: 0,
      locked: 0,
    });
  });

  it('lockHint: unbekannt, keine Sperrfrist, gesperrt, heute, morgen', () => {
    const leer = { open: 0, dueTomorrow: 0, dueToday: 0, locked: 0 };
    expect(lockHint(leer, null)).toBeNull();
    expect(lockHint({ ...leer, open: 2 }, null)).toBe(
      'Clockodo-Sperrfrist unbekannt: einmal uebertragen oder die Verbindung testen.',
    );
    expect(lockHint({ ...leer, open: 2, locked: 2 }, { days: null, at: 1 })).toBeNull();
    expect(lockHint({ ...leer, open: 3 }, LOCK3)).toBeNull();
    expect(lockHint({ open: 5, dueTomorrow: 1, dueToday: 2, locked: 1 }, LOCK3)).toBe(
      '1 Eintrag in Clockodo gesperrt – Vorgesetzten fragen. Heute letzter Tag fuer 2 Eintraege – jetzt uebertragen. Morgen letzter Tag fuer 1 Eintrag.',
    );
    expect(lockHint({ ...leer, open: 4, locked: 2 }, LOCK3)).toBe(
      '2 Eintraege in Clockodo gesperrt – Vorgesetzten fragen.',
    );
    expect(lockHint({ ...leer, open: 2, dueToday: 1 }, LOCK3)).toBe(
      'Heute letzter Tag fuer 1 Eintrag – jetzt uebertragen.',
    );
  });

  it('clockodoEntryLabel: Stand mit Frist, gesperrt statt offen', () => {
    const lab = (e: TimeEntry, lock: { days: number | null; at: number } | null = LOCK3) =>
      clockodoEntryLabel(e, CFG, lock, NOW);
    expect(clockodoEntryLabel(eintrag(10, 9), null, LOCK3, NOW)).toBeNull();
    expect(lab(eintrag(10, 10))).toBe('noch nicht uebertragen');
    expect(lab(eintrag(10, 9))).toBe('noch nicht uebertragen – morgen letzter Tag');
    expect(lab(eintrag(10, 8, { clockodo: undefined }))).toBe(
      'Clockodo-Auswahl fehlt – heute letzter Tag',
    );
    expect(lab(eintrag(10, 8, { clockodoSync: { ids: [5], hash: 'alt', at: 1 } }))).toBe(
      'geaendert – heute letzter Tag',
    );
    expect(lab(eintrag(10, 7, { breakMinutes: 30 }))).toBe('in Clockodo gesperrt');
    expect(lab(eintrag(10, 7))).toBe('in Clockodo gesperrt');
    expect(lab(uebertragen(eintrag(10, 7)))).toBe('in Clockodo');
    expect(lab(eintrag(9, 30))).toBe('vor „Uebertragen ab“ – wird nicht uebertragen');
    expect(lab(eintrag(10, 7), null)).toBe('noch nicht uebertragen');
    expect(lab(eintrag(10, 7), { days: null, at: 1 })).toBe('noch nicht uebertragen');
  });

  it('lockedEntryMessage nur bei 403 jenseits der Frist', () => {
    const alt = um(10, 7, 8);
    const heute = um(10, 8, 8);
    expect(lockedEntryMessage(403, alt, LOCK3, NOW)).toBe(
      'In Clockodo gesperrt (Sperrfrist 3 Tage) – Vorgesetzten fragen.',
    );
    expect(lockedEntryMessage(403, alt, { days: 1, at: 1 }, NOW)).toBe(
      'In Clockodo gesperrt (Sperrfrist 1 Tag) – Vorgesetzten fragen.',
    );
    expect(lockedEntryMessage(403, heute, LOCK3, NOW)).toBeNull();
    expect(lockedEntryMessage(422, alt, LOCK3, NOW)).toBeNull();
    expect(lockedEntryMessage(undefined, alt, LOCK3, NOW)).toBeNull();
    expect(lockedEntryMessage(403, alt, null, NOW)).toBeNull();
    expect(lockedEntryMessage(403, alt, { days: null, at: 1 }, NOW)).toBeNull();
  });

  it('lockDaysText', () => {
    expect(lockDaysText(3)).toBe('Sperrfrist in Clockodo: 3 Tage.');
    expect(lockDaysText(1)).toBe('Sperrfrist in Clockodo: 1 Tag.');
    expect(lockDaysText(null)).toBe('Clockodo meldet keine Sperrfrist.');
  });
});
