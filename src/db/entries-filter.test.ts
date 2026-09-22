import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  getEntriesInRange,
  getEntriesInRangeForEmployment,
} from './entries';

describe('Zeitraum-Abfrage je Beschaeftigung', () => {
  beforeEach(async () => {
    await Dexie.delete('zeiterfassung');
    db.close();
    await db.open();
  });

  it('getEntriesInRangeForEmployment liefert nur Eintraege der gemeinten Beschaeftigung', async () => {
    const from = 1_700_000_000_000;
    const to = 1_700_100_000_000;
    await db.entries.bulkAdd([
      {
        employmentId: 'emp-a',
        start: from + 1,
        end: from + 2,
        breakMinutes: 0,
        activity: 'A',
        note: '',
        source: 'manual',
        createdAt: from,
        updatedAt: from,
      },
      {
        employmentId: 'emp-b',
        start: from + 3,
        end: from + 4,
        breakMinutes: 0,
        activity: 'B',
        note: '',
        source: 'manual',
        createdAt: from,
        updatedAt: from,
      },
    ]);
    const all = await getEntriesInRange(from, to);
    const onlyA = await getEntriesInRangeForEmployment(from, to, 'emp-a');
    expect(all).toHaveLength(2);
    expect(onlyA).toHaveLength(1);
    expect(onlyA[0].employmentId).toBe('emp-a');
  });
});
