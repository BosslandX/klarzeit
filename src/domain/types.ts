import type { ClockodoEntryRef, ClockodoSync } from './clockodo';

/** Personenbezogene Stammdaten (Single-User). Erscheint im Report-Kopf. */
export interface Profile {
  vorname: string;
  nachname: string;
  personalnummer: string;
  arbeitgeber: string;
  abteilung: string;
}

/** Herkunft eines Eintrags: per Stoppuhr erfasst oder manuell nachgetragen. */
export type EntrySource = 'tracked' | 'manual';

/** Eine Pause mit Uhrzeit (epoch ms). */
export interface BreakInterval {
  start: number;
  end: number;
}

/** Ein abgeschlossener Arbeitszeit-Eintrag. Zeiten als Epoch-Millisekunden. */
export interface TimeEntry {
  id?: number; // Dexie Auto-Increment Primaerschluessel
  employmentId: string; // Zugehoerige Beschaeftigung
  start: number; // Beginn (epoch ms)
  end: number; // Ende (epoch ms)
  /** Pausen mit Uhrzeit; fehlt das Feld, sind keine Pausenzeiten bekannt (vor 1.7). */
  breaks?: BreakInterval[];
  breakMinutes: number; // Pause in Minuten (wird von der Dauer abgezogen)
  /** Clockodo-Kunde/Projekt/Leistung; fehlt/null = keine Auswahl. */
  clockodo?: ClockodoEntryRef | null;
  /** Clockodo-Übertragungsstand; fehlt = nie übertragen. */
  clockodoSync?: ClockodoSync;
  activity: string; // Taetigkeit / Beschreibung
  note: string; // optionale Notiz
  source: EntrySource;
  createdAt: number;
  updatedAt: number;
}

/** Laufende, noch nicht gestoppte Erfassung (uebersteht App-Neustart). */
export interface RunningSession {
  employmentId: string;
  start: number; // epoch ms
  activity: string;
}
