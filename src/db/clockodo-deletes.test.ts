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

import {
  addClockodoDeletes,
  getClockodoDeletes,
  removeClockodoDelete,
} from './clockodo-deletes';

describe('clockodo deletes', () => {
  beforeEach(() => {
    prefStore.clear();
  });

  it('Loeschvermerke ohne Doppelte, lesen, einzeln entfernen', async () => {
    await addClockodoDeletes('emp-1', [701, 702]);
    await addClockodoDeletes('emp-1', [702, 703]);
    expect(await getClockodoDeletes('emp-1')).toEqual([701, 702, 703]);
    await removeClockodoDelete('emp-1', 702);
    expect(await getClockodoDeletes('emp-1')).toEqual([701, 703]);
    expect(await getClockodoDeletes('emp-2')).toEqual([]);
  });
});
