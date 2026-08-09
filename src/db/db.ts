import Dexie, { type Table } from 'dexie';
import type { TimeEntry } from '../domain/types';

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
    // ++id = Auto-Increment-PK; start/end/source = Indizes fuer Zeitraum-Queries
    this.version(1).stores({
      entries: '++id, start, end, source',
    });
  }
}

export const db = new ZeitDB();
