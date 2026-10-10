import { beforeEach, describe, expect, it, vi } from 'vitest';

const prefStore = new Map<string, string>();

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({
      value: prefStore.has(key) ? prefStore.get(key)! : null,
    }),
    set: async ({ key, value }: { key: string; value: string }) => {
      prefStore.set(key, value);
    },
    remove: async ({ key }: { key: string }) => {
      prefStore.delete(key);
    },
  },
}));

import { getClockodoLock, removeClockodoLock, saveClockodoLock } from './clockodo-lock';

describe('Sperrfrist merken (AUF-024)', () => {
  beforeEach(() => {
    prefStore.clear();
  });

  it('Sperrfrist: Rundreise je Beschaeftigung, kaputte Daten, Entfernen', async () => {
    await saveClockodoLock('emp-1', { days: 3, at: 1 });
    await saveClockodoLock('emp-2', { days: null, at: 2 });
    expect(prefStore.get('clockodoLock:emp-1')).toBe('{"days":3,"at":1}');
    expect(await getClockodoLock('emp-1')).toEqual({ days: 3, at: 1 });
    expect(await getClockodoLock('emp-2')).toEqual({ days: null, at: 2 });
    prefStore.set('clockodoLock:emp-3', 'kaputt');
    prefStore.set('clockodoLock:emp-4', '{"days":0,"at":1}');
    expect(await getClockodoLock('emp-3')).toBeNull();
    expect(await getClockodoLock('emp-4')).toBeNull();
    expect(await getClockodoLock('emp-9')).toBeNull();
    await removeClockodoLock('emp-1');
    expect(await getClockodoLock('emp-1')).toBeNull();
    expect(await getClockodoLock('emp-2')).toEqual({ days: null, at: 2 });
  });
});
