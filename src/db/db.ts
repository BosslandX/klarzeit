import Dexie, { type Table } from 'dexie';
import type { TimeEntry } from '../domain/types';

export const MIGRATION_EMPLOYMENT_ID = 'emp-1';

/**
 * Lokale, app-private IndexedDB via Dexie.
 * Dauerhafte Speicherung wird beim App-Start via navigator.storage.persist()
 * angefordert (best-effort, siehe main.tsx) und schuetzt vor automatischer
 * Eviction unter Speicherdruck. Gegen manuelles "Speicher leeren" hilft nur
 * das Backup (siehe MoreScreen).
 */
export class ZeitDB extends Dexie {
  entries!: Table<TimeEntry, number>;

  constructor() {
    // Der DB-Name ist ein interner Bezeichner und bleibt beim Rebranding auf
    // "Klarzeit" bewusst stabil: eine Umbenennung wuerde bestehende Datenbanken
    // unerreichbar machen, ohne irgendeinen Vorteil zu bringen.
    super('zeiterfassung');
    this.version(1).stores({
      entries: '++id, start, end, source',
    });
    this.version(2)
      .stores({
        entries: '++id, start, end, source, employmentId',
      })
      .upgrade(async (tx) => {
        await tx
          .table('entries')
          .toCollection()
          .modify((entry) => {
            if (entry.employmentId == null || entry.employmentId === '') {
              entry.employmentId = MIGRATION_EMPLOYMENT_ID;
            }
          });
      });
  }
}

export const db = new ZeitDB();
