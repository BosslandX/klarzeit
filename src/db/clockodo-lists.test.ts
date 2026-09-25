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
  getClockodoLists,
  removeClockodoLists,
  saveClockodoLists,
} from './clockodo-lists';

const SAMPLE = {
  fetchedAt: 1,
  customers: [{ id: 1, name: 'A' }],
  projects: [{ id: 2, name: 'P', customersId: 1 }],
  services: [{ id: 3, name: 'S' }],
};

describe('clockodo lists cache', () => {
  beforeEach(() => {
    prefStore.clear();
  });

  it('Listen-Zwischenspeicher: Rundreise und kaputte Daten', async () => {
    await saveClockodoLists('emp-1', SAMPLE);
    expect(await getClockodoLists('emp-1')).toEqual(SAMPLE);
    prefStore.set('clockodoLists:emp-2', 'kaputt');
    expect(await getClockodoLists('emp-2')).toBeNull();
    expect(await getClockodoLists('emp-9')).toBeNull();
    await removeClockodoLists('emp-1');
    expect(await getClockodoLists('emp-1')).toBeNull();
  });
});
