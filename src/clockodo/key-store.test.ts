import { beforeEach, describe, expect, it, vi } from 'vitest';

const secureStore = new Map<string, string>();
const MISSING = 'Item with given key does not exist';

vi.mock('capacitor-secure-storage-plugin', () => ({
  SecureStoragePlugin: {
    get: async ({ key }: { key: string }) => {
      if (!secureStore.has(key)) throw new Error(MISSING);
      return { value: secureStore.get(key)! };
    },
    set: async ({ key, value }: { key: string; value: string }) => {
      secureStore.set(key, value);
    },
    remove: async ({ key }: { key: string }) => {
      if (!secureStore.has(key)) throw new Error(MISSING);
      secureStore.delete(key);
    },
  },
}));

import {
  getClockodoKey,
  removeClockodoKey,
  setClockodoKey,
} from './key-store';

describe('clockodo key store', () => {
  beforeEach(() => {
    secureStore.clear();
  });

  it('Schluessel speichern, lesen, fehlend, loeschen', async () => {
    await setClockodoKey('emp-1', 'KEY123');
    expect(await getClockodoKey('emp-1')).toBe('KEY123');
    expect(await getClockodoKey('emp-2')).toBeNull();
    await removeClockodoKey('emp-1');
    expect(await getClockodoKey('emp-1')).toBeNull();
    await expect(removeClockodoKey('emp-1')).resolves.toBeUndefined();
  });
});
