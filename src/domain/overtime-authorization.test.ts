import { describe, expect, it } from 'vitest';
import {
  cleanOvertimeAuthorization,
  overtimeAuthorizationLine,
  VERANLASSUNG_MAX,
} from './overtime-authorization';
import type { TimeEntry } from './types';

const eintrag: TimeEntry = {
  employmentId: 'emp-1',
  start: 0,
  end: 3_600_000,
  breakMinutes: 0,
  activity: 'Montage',
  note: '',
  source: 'manual',
  createdAt: 0,
  updatedAt: 0,
};

describe('Veranlassung von Ueberstunden (AUF-036)', () => {
  it('cleanOvertimeAuthorization: getrimmt, hoechstens 300 Zeichen, leer ist keine', () => {
    expect(VERANLASSUNG_MAX).toBe(300);
    expect(cleanOvertimeAuthorization('  angeordnet  ')).toBe('angeordnet');
    expect(cleanOvertimeAuthorization('x'.repeat(301))).toBe('x'.repeat(300));
    expect(cleanOvertimeAuthorization('   ')).toBeUndefined();
    expect(cleanOvertimeAuthorization(42)).toBeUndefined();
    expect(cleanOvertimeAuthorization(undefined)).toBeUndefined();
  });

  it('overtimeAuthorizationLine: Zeile nur mit Veranlassung', () => {
    expect(overtimeAuthorizationLine({ ...eintrag, overtimeAuthorization: ' gebilligt per Mail ' })).toBe(
      'Veranlassung: gebilligt per Mail',
    );
    expect(overtimeAuthorizationLine({ ...eintrag, overtimeAuthorization: '' })).toBeUndefined();
    expect(overtimeAuthorizationLine(eintrag)).toBeUndefined();
  });
});
