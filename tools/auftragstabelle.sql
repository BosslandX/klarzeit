-- ============================================================================
-- Der Auftragsstand. Wird an das tracker_schema.sql des Profils ANGEHAENGT.
--
-- WARUM DAS IN DIESELBE DATENBANK GEHOERT wie die Befunde: sonst gaebe es zwei
-- Statuszahlen-Quellen, und die Frage "welcher Befund stammt aus welchem Lauf?"
-- waere nur noch aus Dateinamen zu erraten. Genau diese Trennung hat im Vorbild
-- dazu gefuehrt, dass ein Statusdokument elf Sessions zurueckhing, ohne dass es
-- jemandem auffiel.
--
-- WAS HIER NICHT STEHT und ausdruecklich nicht hierher gehoert: eine Spalte
-- "fortschritt_prozent" oder aehnliches. Eine Prozentzahl fasst Achsen zusammen,
-- die getrennt bleiben muessen. Der inhaltliche Stand wird ueber v_stand und
-- v_abdeckung gezaehlt, nicht hier abgelegt.
-- ============================================================================

CREATE TABLE auftrag (
    nr          TEXT PRIMARY KEY NOT NULL
                CHECK (nr GLOB '[0-9][0-9][0-9]'),
    kurzname    TEXT NOT NULL CHECK (length(trim(kurzname)) >= 2),
    -- Der Zweig und der Arbeitsort, damit hinterher nachvollziehbar ist, WO
    -- gearbeitet wurde. Beide werden von tools/auftrag.ps1 gebildet.
    zweig       TEXT,
    arbeitsort  TEXT,
    modell      TEXT NOT NULL DEFAULT 'composer-2.5',
    gestartet   TEXT NOT NULL CHECK (gestartet GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'),
    beendet     TEXT,
    exitcode    INTEGER,

    -- Der Zustand. 'gefahren' heisst NUR, dass der Agent gelaufen ist -- nicht,
    -- dass etwas Brauchbares herauskam. Erst 'abgenommen' sagt das, und dafuer
    -- muss tools/abnahme.py gruen gewesen sein UND ein Mensch die Anker an der
    -- Quelle nachgelesen haben.
    zustand     TEXT NOT NULL DEFAULT 'gestartet'
                CHECK (zustand IN ('gestartet','gefahren','abgelehnt','abgenommen','abgebrochen')),

    lieferung   TEXT,
    abnahme_exit INTEGER,

    -- Der Fingerabdruck-Befund. Leer heisst NICHT "war sauber", sondern
    -- "nicht eingetragen" -- deshalb steht die Unterscheidung im CHECK.
    ausbruch    TEXT,
    ausbruch_geprueft INTEGER NOT NULL DEFAULT 0 CHECK (ausbruch_geprueft IN (0,1)),

    bemerkung   TEXT,

    -- Ein abgenommener Auftrag ohne Lieferung ist ein Widerspruch.
    CHECK (zustand <> 'abgenommen' OR (lieferung IS NOT NULL AND abnahme_exit = 0)),
    -- Und einer, dessen Fingerabdruck nie angesehen wurde, ist nicht abgenommen:
    -- die Lieferung kann tadellos sein, waehrend der Lauf nebenher geschrieben hat.
    CHECK (zustand <> 'abgenommen' OR ausbruch_geprueft = 1),
    CHECK (beendet IS NULL OR beendet >= gestartet)
);

-- Welcher Befund stammt aus welchem Lauf. Ohne das ist ein Befund heimatlos,
-- sobald zwei Auftraege denselben Gegenstand beruehren.
CREATE TABLE befund_herkunft (
    befund_id   INTEGER NOT NULL REFERENCES befund(id),
    auftrag_nr  TEXT NOT NULL REFERENCES auftrag(nr),
    PRIMARY KEY (befund_id, auftrag_nr)
);

-- Zaehlung der Auftraege. Wie v_stand: die einzige Quelle fuer diese Zahlen.
CREATE VIEW v_auftraege AS
SELECT zustand, COUNT(*) AS n FROM auftrag GROUP BY zustand;

-- Die Abdeckung je Werk: wie viele Stellen sind auf welcher Achse wie weit.
-- DAS ist die Lesetiefe -- und sie wird je Achse GETRENNT gezaehlt, nie summiert.
CREATE VIEW v_abdeckung AS
SELECT g.werk, b.achse, b.marker, COUNT(*) AS n
FROM befund b JOIN gegenstand g ON g.id = b.gegenstand_id
WHERE g.werk IS NOT NULL
GROUP BY g.werk, b.achse, b.marker;
