import { Preferences } from '@capacitor/preferences';

function prefKey(employmentId: string): string {
  return `clockodoDeletes:${employmentId}`;
}

function parseIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const v of raw) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const n = Math.trunc(v);
    if (n > 0 && n === v) out.push(n);
  }
  return out;
}

export async function getClockodoDeletes(
  employmentId: string,
): Promise<number[]> {
  const { value } = await Preferences.get({ key: prefKey(employmentId) });
  if (!value) return [];
  try {
    return parseIds(JSON.parse(value));
  } catch {
    return [];
  }
}

export async function addClockodoDeletes(
  employmentId: string,
  ids: number[],
): Promise<void> {
  const existing = await getClockodoDeletes(employmentId);
  const seen = new Set(existing);
  const next = [...existing];
  for (const id of ids) {
    if (id > 0 && !seen.has(id)) {
      seen.add(id);
      next.push(id);
    }
  }
  await Preferences.set({
    key: prefKey(employmentId),
    value: JSON.stringify(next),
  });
}

export async function removeClockodoDelete(
  employmentId: string,
  id: number,
): Promise<void> {
  const existing = await getClockodoDeletes(employmentId);
  const next = existing.filter((x) => x !== id);
  if (next.length === existing.length) return;
  if (next.length === 0) {
    await Preferences.remove({ key: prefKey(employmentId) });
  } else {
    await Preferences.set({
      key: prefKey(employmentId),
      value: JSON.stringify(next),
    });
  }
}
