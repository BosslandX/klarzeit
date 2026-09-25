import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

const MISSING = 'Item with given key does not exist';

function storageKey(employmentId: string): string {
  return `clockodo-key-${employmentId}`;
}

export async function getClockodoKey(
  employmentId: string,
): Promise<string | null> {
  try {
    const { value } = await SecureStoragePlugin.get({
      key: storageKey(employmentId),
    });
    return value ?? null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === MISSING) return null;
    throw e;
  }
}

export async function setClockodoKey(
  employmentId: string,
  key: string,
): Promise<void> {
  await SecureStoragePlugin.set({ key: storageKey(employmentId), value: key });
}

export async function removeClockodoKey(employmentId: string): Promise<void> {
  try {
    await SecureStoragePlugin.remove({ key: storageKey(employmentId) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === MISSING) return;
    throw e;
  }
}
