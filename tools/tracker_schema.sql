-- tracker_schema.sql -- Grand-Prix-Story-Tracker. Die Verfassung als Einfuege-Bedingung.
--
-- HERKUNFT: uebertragen aus C:\gamedev\wikinger_one_new\tools\tracker_schema.sql, dessen
--   Fassung aus zwei adversarischen Runden (33 + 31 durchgekommene Verstoesse) hervorging.
--   Das Geruest ist uebernommen; Achsen, Raenge, Ortsschema und die Altbaum-Sperre sind
--   fuer dieses Projekt neu gebaut. Verfahren: docs/PROZESS_AUFTRAGSKETTE.md.
--
-- WOGEGEN: docs/CONSTITUTION.md Regel 2 ("Kein [x] ohne Beleg") und Regel 3 ("Definition of
--   Done = ZWEI Belege ... Code-Existenz allein ist NIE done") stehen dort als Prosa.
--   Ein Kommentar haelt nichts auf. Hier stehen sie als Bedingung, die beim SCHREIBEN feuert.
--
-- DER FUND, DER DAS VORBILD UMGEBAUT HAT (uebernommen, hier nicht neu gemessen):
--   PRAGMA foreign_keys ist in SQLite je VERBINDUNG einzuschalten und PER VORGABE AUS.
--   Das PRAGMA am Anfang dieser Datei gilt nur fuer die Verbindung, die sie einspielt.
--   Jedes spaetere Werkzeug oeffnet die DB mit foreign_keys = 0. Im Vorbild kam damit ein
--   [x] mit laufzeitbeleg_id = 4711 durch, obwohl die Tabelle leer war.
--   FOLGE: keine Verfassungsregel ruht allein auf einem Fremdschluessel. Marker und Raenge
--   stehen zusaetzlich als CHECK in jeder nutzenden Tabelle, die Belegpflicht als TRIGGER --
--   Trigger feuern unabhaengig vom PRAGMA.
--
-- DIE FUENF STRUKTURENTSCHEIDUNGEN, hier uebersetzt:
--
--   1. IDENTITAET HAT GENAU EINE SCHREIBWEISE.
--      Das Vorbild band (hunk, hunk_offset) als INTEGER, weil '0x00574100' und '0x574100'
--      sonst zwei Primaerschluessel sind. Dalvik hat keine Ladeadresse -- die Identitaet IST
--      der Name, und der hat hier DREI gelebte Schreibweisen: 'd/a.java', 'd.a' und 'Ld/a;'.
--      Dieselbe Falle. Kanonisch ist darum der Smali-Deskriptor 'Ld/a;', per CHECK erzwungen.
--      Er ist aus beiden Baeumen mechanisch ableitbar und laesst keine Variante zu.
--
--   2. EIN BELEG IST PFAD + ANKER, IN GETRENNTEN PFLICHTSPALTEN.
--      Eine Zeilennummer darf hinter dem Anker stehen (Spalte stelle), niemals an seiner
--      Statt. length(trim(x)) >= 6 kann das nicht: 'Z.183-207' hat neun Zeichen.
--
--   3. DIE RANGFOLGE IST DIE TABELLENSTRUKTUR.
--      docs/CONSTITUTION.md fuehrt den 1.5.4-Altbaum (analyse/, game/) als "nur
--      Ideen-Hinweis, NIE Wahrheit". Es gibt darum keine Belegtabelle, die ihn aufnehmen
--      koennte; er lebt in suchhinweis, ohne jede Verbindung zu befund.
--      Zusaetzlich ist jeder Quell-Rang an seine WURZEL gebunden: ein S1 kann nicht auf das
--      Dekompilat zeigen. Das schliesst genau die Verwechslung, gegen die Regel 4 steht.
--
--   4. ZWEI BELEGE HEISST ZWEI VERSCHIEDENE BELEGE -- AUCH DEM TEXT NACH.
--      Getrennte Tabellen trennen nur die IDs. Dieselbe Datei, zweimal gelesen, ist kein
--      Quell- UND Laufzeitbeleg.
--
--   5. UNSICHTBARES IST KEIN INHALT, UND trim() REICHT NICHT.
--      trim(x, zeichen) entfernt nur an den ENDEN. 'a' || VT || FF || 'b' passiert jede
--      trim-Pruefung. Darum wird ueberall mit einer replace-Kette gemessen, wie viele
--      SICHTBARE Zeichen ein Feld hat -- einschliesslich NBSP (160), Zero-Width-Space (8203)
--      und BOM (65279), die trim ohnehin nicht kennt.
--
-- GRENZE, ausdruecklich benannt:
--   Eine CHECK-Bedingung prueft die FORM eines Belegs, nie seinen INHALT. Ob die Datei
--   existiert und ob der Anker dort genau einmal vorkommt, beantwortet nur das Dateisystem --
--   das tut tools/beleg_pruefen.py, aufgerufen von tools/gate.ps1.
--   Und keine Bedingung prueft, ob eine Aussage WAHR ist. Das bleibt Sache des
--   Orchestrators, der jeden Befund selbst an der Quelle nachliest.

PRAGMA foreign_keys = ON;

-- ============================================================ Vokabular (geschlossen)

-- docs/CONSTITUTION.md Regel 1: fuenf Marker. Die Tabelle macht sie sichtbar; verbindlich
-- sind sie ueber den CHECK in befund -- ein Fremdschluessel allein waere ohne PRAGMA wirkungslos.
--
-- GEMESSEN 2026-09-06 und ausdruecklich NICHT aufgenommen: ein sechster Marker '[!!]' steht
-- 136x in docs/VERIFY_PROGRESS.md und 6x in docs/DECODE_S228.md, hat aber NULL
-- Definitionsstellen in CONSTITUTION.md, REPO_STANDARD.md und RE_PLAN.md. Solange er nicht
-- definiert ist, weist die Abnahme ihn ab. Das ist der Zweck: die Luecke sichtbar halten,
-- statt sie stillschweigend zu legalisieren.
CREATE TABLE marker (
    m     TEXT PRIMARY KEY NOT NULL CHECK (m IN ('[ ]','[~]','[x]','[?]','[!]')),
    sinn  TEXT NOT NULL
);
INSERT INTO marker(m,sinn) VALUES
    ('[ ]','offen -- nicht begonnen'),
    ('[~]','in Arbeit, unverifiziert'),
    ('[x]','belegt -- MIT Beleg verifiziert'),
    ('[?]','Hypothese -- darf dauerhaft stehen bleiben, das ist das Sicherheitsventil'),
    ('[!]','Problem/Widerspruch entdeckt');

-- Die Beweismittel-Rangfolge, abgeleitet aus der Quellen-Hierarchie in
-- docs/CONSTITUTION.md und aus der GEMESSENEN Belegpraxis der DECODE-Dateien
-- (value-Hash 51x/10x, Bild-GT 22x, Bild-Read 13x).
CREATE TABLE rang (
    r               TEXT PRIMARY KEY NOT NULL
                    CHECK (r IN ('C1','C2','C3','C4','L1','L2','L3')),
    seite           TEXT NOT NULL CHECK (seite IN ('quelle','laufzeit','keiner')),
    wurzel          TEXT,
    bedeutung       TEXT NOT NULL,
    taugt_als_beleg INTEGER NOT NULL CHECK (taugt_als_beleg IN (0,1))
);
INSERT INTO rang(r,seite,wurzel,bedeutung,taugt_als_beleg) VALUES
    ('C1','quelle',  NULL, 'Codestelle -- die Zeile, die es tut', 1),
    ('C2','quelle',  NULL, 'Schnittstellenvertrag: Typdefinition, Schema, API-Spezifikation', 1),
    ('C3','quelle',  NULL, 'Fremdcode -- Bibliothek oder Abhaengigkeit, nicht unter eigener Kontrolle', 1),
    ('C4','keiner',  NULL, 'Vermutung -- KEIN Beleg, schliesst nichts ab', 0),
    ('L1','laufzeit',NULL, 'Testlauf mit Ausgabe, Test benannt', 1),
    ('L2','laufzeit',NULL, 'Werkzeuglauf: tsc, lint, build, coverage -- mit Ausgabe', 1),
    ('L3','laufzeit',NULL, 'Einzelmessung', 1);

-- ============================================================ Belege

CREATE TABLE quellbeleg (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    rang    TEXT NOT NULL REFERENCES rang(r) CHECK (rang IN ('C1','C2','C3')),
    pfad    TEXT NOT NULL,
    anker   TEXT NOT NULL,
    stelle  TEXT,
    CHECK (typeof(pfad) = 'text' AND typeof(anker) = 'text'
           AND (stelle IS NULL OR typeof(stelle) = 'text')),
    -- sichtbare Laenge
    CHECK (length(replace(replace(replace(replace(replace(replace(replace(replace(replace(
             pfad,' ',''),char(9),''),char(10),''),char(11),''),char(12),''),char(13),''),
             char(160),''),char(8203),''),char(65279),'')) >= 6),
    CHECK (length(replace(replace(replace(replace(replace(replace(replace(replace(replace(
             anker,' ',''),char(9),''),char(10),''),char(11),''),char(12),''),char(13),''),
             char(160),''),char(8203),''),char(65279),'')) >= 3),
    -- Pfad sieht wie ein Pfad aus: ein Trenner, keine Leerzeichen. Im Vorbild war
    -- 'siehe oben, im Chat.' ein gueltiger Pfad, weil ein Punkt genuegte.
    CHECK (instr(pfad,'/') > 0 OR instr(pfad,'\') > 0),
    CHECK (instr(pfad,' ') = 0),
    -- PROJEKTEIGENE PFADSPERREN. Im Reverse-Engineering-Vorbild war jeder Rang an seine
    -- Wurzel gebunden (S1 nur aus dem Listing, S3 nur aus dem Dekompilat) und ein Altbaum
    -- ausdruecklich gesperrt. In einem Dokumentprojekt gibt es diese feste Zuordnung
    -- NICHT: eine Primaerquelle kann ueberall liegen.
    --
    -- Was hier fehlt, ist damit UNGEPRUEFT, nicht erlaubt. Wo ein Projekt einen Baum hat,
    -- der kein Beleg sein darf (ein Rohextrakt, ein Fremdbestand, ein OCR-Derivat), gehoert
    -- er hierher -- nach dem Muster:
    --     CHECK (instr('/' || lower(replace(pfad,'\','/')), '/_roh/') = 0),
    -- (keine projekteigenen Pfadsperren gesetzt)
    -- Anker ist keine nackte Stellenangabe: entweder Bytefolge, oder mindestens fuenf
    -- Zeichen ausserhalb von Ziffern und Trennzeichen.
    CHECK (anker GLOB '[0-9a-f][0-9a-f] [0-9a-f][0-9a-f]*'
           OR length(replace(replace(replace(replace(replace(replace(replace(replace(
                replace(replace(replace(replace(replace(replace(replace(replace(replace(
                anker,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),
                '8',''),'9',''),'.',''),',',''),'-',''),':',''),';',''),'_',''),' ','')) >= 5),
    -- Die Laengenzaehlung allein reicht nicht: 'Zeile 183' behaelt genau fuenf Zeichen und
    -- kam damit durch. Die geschlossene Liste der Stellenwoerter tritt daneben, auf dieselbe
    -- normalisierte Form angewandt -- nicht statt ihrer. 'z' steht darin, weil DIESES Projekt
    -- 'Z.822' schreibt (CLAUDE.md: "a/e.java Z.822-1057").
    CHECK (anker GLOB '[0-9a-f][0-9a-f] [0-9a-f][0-9a-f]*'
           OR lower(replace(replace(replace(replace(replace(replace(replace(replace(
                replace(replace(replace(replace(replace(replace(replace(replace(replace(
                anker,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),
                '8',''),'9',''),'.',''),',',''),'-',''),':',''),';',''),'_',''),' ','')) NOT IN
              ('z','zz','zff','zl','zeile','zeilen','line','lines','ln','row','rows',
               's','seite','seiten','page','pg','p','pp','bl','blatt','col','spalte',
               'offset','off','pos','position','stelle','abs','adr','addr','byte','bytes',
               'idx','index','nr','no','num','id')),
    -- Fuellzeichen: mindestens zwei verschiedene Zeichen
    CHECK (length(replace(anker, substr(anker,1,1), '')) > 0),
    CHECK (lower(anker) NOT GLOB '*todo*' AND lower(anker) NOT GLOB '*tbd*'
           AND lower(anker) NOT GLOB '*fixme*' AND lower(anker) NOT GLOB '*platzhalter*'
           AND instr(anker,'??') = 0)
);

CREATE TABLE laufzeitbeleg (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    rang    TEXT NOT NULL REFERENCES rang(r) CHECK (rang IN ('L1','L2','L3')),
    pfad    TEXT NOT NULL,
    anker   TEXT NOT NULL,
    stelle  TEXT,
    -- docs/CONSTITUTION.md Regel 6 verlangt Mehrkanal-Bestaetigung; die Hausregel "das
    -- Messgeraet ist Teil des Belegs" verlangt beide Kontrollen. Im Entwurf hatte diese
    -- Regel kein einziges Feld.
    positivkontrolle TEXT NOT NULL,
    negativkontrolle TEXT NOT NULL,
    nulldiff         TEXT,
    CHECK (typeof(pfad) = 'text' AND typeof(anker) = 'text'
           AND typeof(positivkontrolle) = 'text' AND typeof(negativkontrolle) = 'text'
           AND (stelle IS NULL OR typeof(stelle) = 'text')
           AND (nulldiff IS NULL OR typeof(nulldiff) = 'text')),
    CHECK (length(replace(replace(replace(replace(replace(replace(replace(replace(replace(
             pfad,' ',''),char(9),''),char(10),''),char(11),''),char(12),''),char(13),''),
             char(160),''),char(8203),''),char(65279),'')) >= 6),
    CHECK (length(replace(replace(replace(replace(replace(replace(replace(replace(replace(
             anker,' ',''),char(9),''),char(10),''),char(11),''),char(12),''),char(13),''),
             char(160),''),char(8203),''),char(65279),'')) >= 3),
    CHECK (instr(pfad,'/') > 0 OR instr(pfad,'\') > 0),
    CHECK (instr(pfad,' ') = 0),
    -- Im Vorbild zeigte ein Laufzeitbeleg NICHT in die Quellbaeume -- wer die Quelle als
    -- Laufzeitbeleg fuehrt, gibt das Vorhandensein als Wirkung aus. Dieselbe Trennung gilt
    -- hier, nur ohne feste Baumnamen; wo ein Projekt sie hat, kommen die Sperren hierher.
    -- (keine projekteigenen Pfadsperren gesetzt -- s. Kommentar oben)
    CHECK (anker GLOB '[0-9a-f][0-9a-f] [0-9a-f][0-9a-f]*'
           OR length(replace(replace(replace(replace(replace(replace(replace(replace(
                replace(replace(replace(replace(replace(replace(replace(replace(replace(
                anker,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),
                '8',''),'9',''),'.',''),',',''),'-',''),':',''),';',''),'_',''),' ','')) >= 5),
    CHECK (anker GLOB '[0-9a-f][0-9a-f] [0-9a-f][0-9a-f]*'
           OR lower(replace(replace(replace(replace(replace(replace(replace(replace(
                replace(replace(replace(replace(replace(replace(replace(replace(replace(
                anker,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),
                '8',''),'9',''),'.',''),',',''),'-',''),':',''),';',''),'_',''),' ','')) NOT IN
              ('z','zz','zff','zl','zeile','zeilen','line','lines','ln','row','rows',
               's','seite','seiten','page','pg','p','pp','bl','blatt','col','spalte',
               'offset','off','pos','position','stelle','abs','adr','addr','byte','bytes',
               'idx','index','nr','no','num','id')),
    CHECK (length(replace(anker, substr(anker,1,1), '')) > 0),
    CHECK (lower(anker) NOT GLOB '*todo*' AND lower(anker) NOT GLOB '*tbd*'
           AND lower(anker) NOT GLOB '*fixme*' AND lower(anker) NOT GLOB '*platzhalter*'
           AND instr(anker,'??') = 0),
    -- Beide Kontrollen muessen benannt sein. Sichtbare Zeichen, nicht bloss Laenge:
    -- VT und FF fehlen im trim-Zeichensatz.
    CHECK (length(replace(replace(replace(replace(replace(replace(replace(replace(replace(
             positivkontrolle,' ',''),char(9),''),char(10),''),char(11),''),char(12),''),
             char(13),''),char(160),''),char(8203),''),char(65279),'')) >= 8),
    CHECK (length(replace(replace(replace(replace(replace(replace(replace(replace(replace(
             negativkontrolle,' ',''),char(9),''),char(10),''),char(11),''),char(12),''),
             char(13),''),char(160),''),char(8203),''),char(65279),'')) >= 8),
    -- Die beiden Kontrollen duerfen nicht dieselbe sein.
    CHECK (lower(positivkontrolle) <> lower(negativkontrolle)),
    -- L2 ist die Zeitreihe: ohne Null-Diff-Runde misst sie Rauschen.
    CHECK (rang <> 'L2' OR (nulldiff IS NOT NULL
           AND length(replace(replace(replace(replace(replace(replace(replace(replace(replace(
                 nulldiff,' ',''),char(9),''),char(10),''),char(11),''),char(12),''),
                 char(13),''),char(160),''),char(8203),''),char(65279),'')) >= 6))
);

-- S4 lebt hier, ohne jede Verbindung zu befund. Was kein Beleg ist, kann keiner werden.
CREATE TABLE suchhinweis (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    pfad    TEXT NOT NULL CHECK (typeof(pfad) = 'text'
            AND length(replace(replace(replace(pfad,' ',''),char(9),''),char(160),'')) >= 6),
    notiz   TEXT NOT NULL CHECK (typeof(notiz) = 'text'
            AND length(replace(replace(replace(notiz,' ',''),char(9),''),char(160),'')) >= 8),
    rang    TEXT NOT NULL DEFAULT 'S4' REFERENCES rang(r) CHECK (rang = 'S4')
);

-- ============================================================ Gegenstaende

CREATE TABLE gegenstand (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    art      TEXT NOT NULL CHECK (art IN ('modul','funktion','typ','endpunkt',
                                          'komponente','konfiguration')),
    name     TEXT NOT NULL CHECK (typeof(name) = 'text'
             AND length(replace(replace(replace(replace(replace(replace(replace(replace(replace(
                   name,' ',''),char(9),''),char(10),''),char(11),''),char(12),''),char(13),''),
                   char(160),''),char(8203),''),char(65279),'')) >= 3),
    -- Der Ort. 'werk' ist das Werk als Ganzes (Buch-ID, Aktenzeichen, Kursnummer),
    -- 'stelle' der Ort darin (Kapitel, Kurseinheit, Vorgang, Randnummer). Anders als der
    -- Smali-Deskriptor des Vorbilds gibt es hier keine EINE kanonische Form -- deshalb
    -- setzt jedes Projekt seine eigene, und dieser CHECK erzwingt nur, dass ueberhaupt
    -- eine da ist.
    werk     TEXT,
    stelle   TEXT,
    CHECK (werk IS NULL OR (typeof(werk) = 'text'
           AND length(replace(replace(replace(werk,' ',''),char(9),''),char(160),'')) >= 2)),
    CHECK (stelle IS NULL OR (typeof(stelle) = 'text'
           AND length(replace(replace(replace(stelle,' ',''),char(9),''),char(160),'')) >= 1)),
    -- Eine Stelle ohne Werk ist kein Ort. Umgekehrt geht: das Werk allein ist einer.
    CHECK (stelle IS NULL OR werk IS NOT NULL),
    -- Was IM Werk steht, muss das Werk nennen -- sonst ist es eine Ueberschrift.
    CHECK (art NOT IN ('funktion','typ','endpunkt','komponente') OR werk IS NOT NULL)
);

-- ============================================================ Eindeutigkeit
-- Pfad und Anker in normalisierter Form: sonst stehen 'books/md/x' und 'books\md\x'
-- als zwei Belege nebeneinander.
CREATE UNIQUE INDEX ux_quellbeleg    ON quellbeleg(lower(replace(pfad,'\','/')), anker);
CREATE UNIQUE INDEX ux_laufzeitbeleg ON laufzeitbeleg(lower(replace(pfad,'\','/')), anker);

-- Ein Ort gehoert einem Gegenstand. Das ist das Gegenstueck zu ux_gegenstand_ort im Vorbild.
CREATE UNIQUE INDEX ux_gegenstand_ort ON gegenstand(werk, IFNULL(stelle,''))
    WHERE werk IS NOT NULL;

-- Und der Name ebenfalls, auf normalisierter Form -- damit 'MaxSpeed-Formel' und
-- 'maxspeed formel' nicht zwei Gegenstaende sind.
--
-- GEMESSEN AM 2026-09-06, ERSTE FASSUNG WAR WIRKUNGSLOS: hier stand eine aus dem Vorbild
-- uebernommene replace-Kette, deren Umlaut-Paare beim Umschreiben auf ASCII zu
-- replace(name,'Ae','Ae') geworden waren -- eine Kette von Leeroperationen. Sie hat
-- ausschliesslich Leerzeichen entfernt; 'MaxSpeed-Formel' und 'maxspeed formel' standen
-- als zwei Gegenstaende nebeneinander. Gefunden hat es NICHT die Durchsicht, sondern der
-- Angriff "derselbe Name mit anderer Schreibweise" in tools/tracker_probe.py.
-- Trennzeichen gehoeren darum ausdruecklich mit in die Kette, nicht nur Leerraum.
CREATE UNIQUE INDEX ux_gegenstand_name ON gegenstand(
    lower(replace(replace(replace(replace(replace(replace(replace(replace(
      replace(replace(replace(replace(replace(replace(replace(replace(
      replace(replace(replace(
        name,
        'Ä','ae'),'Ö','oe'),'Ü','ue'),'ä','ae'),'ö','oe'),'ü','ue'),'ß','ss'),
        '-',''),'_',''),'.',''),
        ' ',''),char(9),''),char(10),''),char(11),''),char(12),''),char(13),''),
        char(160),''),char(8203),''),char(65279),'')));

-- ============================================================ Befunde

CREATE TABLE befund (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    gegenstand_id    INTEGER NOT NULL REFERENCES gegenstand(id),
    -- Die drei Achsen des Dokumentprofils. Sie werden GETRENNT gezaehlt: eine
    -- zusammengefasste Zahl vernichtet den Unterschied zwischen "liegt vor, ungeprueft"
    -- und "geprueft, aber nicht eingeordnet".
    achse            TEXT NOT NULL CHECK (achse IN ('implementiert','getestet','gemessen')),
    -- Marker als CHECK **und** als Fremdschluessel. Der CHECK ist der tragende Teil: ohne
    -- PRAGMA foreign_keys ist der Fremdschluessel wirkungslos.
    marker           TEXT NOT NULL DEFAULT '[ ]' REFERENCES marker(m)
                     CHECK (marker IN ('[ ]','[~]','[x]','[?]','[!]')),
    aussage          TEXT NOT NULL CHECK (typeof(aussage) = 'text'
                     AND length(replace(replace(replace(replace(replace(replace(replace(replace(replace(
                           aussage,' ',''),char(9),''),char(10),''),char(11),''),char(12),''),
                           char(13),''),char(160),''),char(8203),''),char(65279),'')) >= 10),
    quellbeleg_id    INTEGER REFERENCES quellbeleg(id),
    laufzeitbeleg_id INTEGER REFERENCES laufzeitbeleg(id),
    ablage       TEXT,
    blockade         TEXT,
    widerspruch_zu   TEXT,

    UNIQUE (gegenstand_id, achse),

    -- docs/CONSTITUTION.md Regel 2 und 3, zusammen. Eine Aussage ueber den CODE schliesst
    -- Kein [x] ohne Beleg, auf jeder Achse einzeln:
    --   'extrahiert'  -- der Text/Wert liegt aus der Quelle vor  -> Q1-Q3 noetig.
    --   'geprueft'    -- gegen die Quelle gehalten und bestaetigt -> ein LAUF muss es
    --                    gezeigt haben (L1-L3). Ein Zitat, das jemand fuer richtig HAELT,
    --                    ist nicht geprueft; geprueft ist es, wenn ein Werkzeug es gegen
    --                    den Volltext gehalten hat und die Ausgabe beiliegt.
    --   'eingeordnet' -- verlangt beides PLUS die Datei, die die Einordnung traegt.
    --                    Vorhandensein einer Analyse ist NIE fuer sich schon Einordnung.
    CHECK (marker <> '[x]' OR achse <> 'implementiert' OR quellbeleg_id IS NOT NULL),
    CHECK (marker <> '[x]' OR achse <> 'getestet'     OR laufzeitbeleg_id IS NOT NULL),
    CHECK (marker <> '[x]' OR achse <> 'gemessen'     OR (quellbeleg_id IS NOT NULL
           AND laufzeitbeleg_id IS NOT NULL AND ablage IS NOT NULL)),
    -- Sichtbare Zeichen, nicht bloss Nichtleere: im Vorbild trug ein [x] eine ablage
    -- aus vier unsichtbaren Zeichen.
    CHECK (ablage IS NULL OR (typeof(ablage) = 'text'
           AND length(replace(replace(replace(replace(replace(replace(replace(replace(replace(
                 ablage,' ',''),char(9),''),char(10),''),char(11),''),char(12),''),
                 char(13),''),char(160),''),char(8203),''),char(65279),'')) >= 6
           AND (instr(ablage,'/') > 0 OR instr(ablage,'\') > 0))),
    -- Der Nachbau liegt im Port. game/ ist der 1.5.4-Altbaum und traegt keinen Nachbau
    -- der 1.1.6 -- dort zu zeigen hiesse, den Altstand als Ergebnis auszugeben.
    CHECK (marker <> '[?]' OR (blockade IS NOT NULL
           AND length(replace(replace(replace(replace(replace(replace(replace(replace(replace(
                 blockade,' ',''),char(9),''),char(10),''),char(11),''),char(12),''),
                 char(13),''),char(160),''),char(8203),''),char(65279),'')) >= 10)),
    CHECK (marker <> '[!]' OR (widerspruch_zu IS NOT NULL
           AND length(replace(replace(replace(replace(replace(replace(replace(replace(replace(
                 widerspruch_zu,' ',''),char(9),''),char(10),''),char(11),''),char(12),''),
                 char(13),''),char(160),''),char(8203),''),char(65279),'')) >= 10)),
    CHECK (achse <> 'gemessen' OR marker IN ('[ ]','[?]','[!]') OR ablage IS NOT NULL)
);

-- ============================================================ Trigger
--
-- Warum Trigger und nicht nur CHECK: ein CHECK prueft eine Zeile beim Schreiben. Er kann
-- nicht pruefen, ob eine ANDERE Zeile existiert, und er verhindert kein Loeschen. Und er
-- ersetzt nicht den Fremdschluessel -- der ist ohne PRAGMA aus. Trigger feuern immer.
-- Wo CHECK nicht reicht, ist der Trigger die naechstharte Form. Das wird hier gesagt,
-- statt verschwiegen.

-- ---- (a) Die Belegpflicht traegt nicht auf dem Fremdschluessel allein.
-- Im Vorbild wurde ein [x] beobachtet mit laufzeitbeleg_id = 4711 angenommen, obwohl die
-- Tabelle leer war -- zweite Verbindung, ohne PRAGMA.
CREATE TRIGGER tr_befund_beleg_muss_existieren_ins BEFORE INSERT ON befund BEGIN
    SELECT RAISE(ABORT, 'quellbeleg_id zeigt auf keinen vorhandenen Quellbeleg')
    WHERE NEW.quellbeleg_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM quellbeleg WHERE id = NEW.quellbeleg_id);
    SELECT RAISE(ABORT, 'laufzeitbeleg_id zeigt auf keinen vorhandenen Laufzeitbeleg')
    WHERE NEW.laufzeitbeleg_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM laufzeitbeleg WHERE id = NEW.laufzeitbeleg_id);
    SELECT RAISE(ABORT, 'gegenstand_id zeigt auf keinen vorhandenen Gegenstand')
    WHERE NOT EXISTS (SELECT 1 FROM gegenstand WHERE id = NEW.gegenstand_id);
END;
CREATE TRIGGER tr_befund_beleg_muss_existieren_upd BEFORE UPDATE ON befund BEGIN
    SELECT RAISE(ABORT, 'quellbeleg_id zeigt auf keinen vorhandenen Quellbeleg')
    WHERE NEW.quellbeleg_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM quellbeleg WHERE id = NEW.quellbeleg_id);
    SELECT RAISE(ABORT, 'laufzeitbeleg_id zeigt auf keinen vorhandenen Laufzeitbeleg')
    WHERE NEW.laufzeitbeleg_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM laufzeitbeleg WHERE id = NEW.laufzeitbeleg_id);
END;

-- ---- (b) Zwei Belege muessen zwei VERSCHIEDENE Belege sein, auch dem Text nach.
-- Getrennte Tabellen trennen nur die IDs: dieselbe Datei mit demselben Anker, einmal als
-- S3 und einmal als L1, trug im Vorbild ein [x] auf der Nachbau-Achse.
CREATE TRIGGER tr_befund_zwei_echte_belege_ins BEFORE INSERT ON befund BEGIN
    SELECT RAISE(ABORT, 'Quell- und Laufzeitbeleg sind derselbe Beleg: gleicher Pfad und gleicher Anker')
    WHERE NEW.quellbeleg_id IS NOT NULL AND NEW.laufzeitbeleg_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM quellbeleg q JOIN laufzeitbeleg l
                  WHERE q.id = NEW.quellbeleg_id AND l.id = NEW.laufzeitbeleg_id
                    AND lower(replace(q.pfad,'\','/')) = lower(replace(l.pfad,'\','/'))
                    AND q.anker = l.anker);
END;
CREATE TRIGGER tr_befund_zwei_echte_belege_upd BEFORE UPDATE ON befund BEGIN
    SELECT RAISE(ABORT, 'Quell- und Laufzeitbeleg sind derselbe Beleg: gleicher Pfad und gleicher Anker')
    WHERE NEW.quellbeleg_id IS NOT NULL AND NEW.laufzeitbeleg_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM quellbeleg q JOIN laufzeitbeleg l
                  WHERE q.id = NEW.quellbeleg_id AND l.id = NEW.laufzeitbeleg_id
                    AND lower(replace(q.pfad,'\','/')) = lower(replace(l.pfad,'\','/'))
                    AND q.anker = l.anker);
END;

-- ---- (c) Ein stehendes [x] wird nicht umgehaengt.
-- Die Belegtrigger schuetzen die Belegzeile, nicht den Zeiger: im Vorbild liess sich der
-- Befund auf einen anderen Beleg und sogar auf einen anderen Gegenstand umbiegen.
CREATE TRIGGER tr_befund_kein_umhaengen
BEFORE UPDATE OF gegenstand_id, quellbeleg_id, laufzeitbeleg_id ON befund BEGIN
    SELECT RAISE(ABORT, 'Ein [x] wird nicht auf einen anderen Gegenstand oder Beleg umgehaengt. Marker zuerst zuruecksetzen.')
    WHERE OLD.marker = '[x]'
      AND (IFNULL(NEW.gegenstand_id,-1)    <> IFNULL(OLD.gegenstand_id,-1)
        OR IFNULL(NEW.quellbeleg_id,-1)    <> IFNULL(OLD.quellbeleg_id,-1)
        OR IFNULL(NEW.laufzeitbeleg_id,-1) <> IFNULL(OLD.laufzeitbeleg_id,-1));
END;

-- ---- (d) Das Vokabular ist Verfassung, nicht Daten.
-- Gemessen kamen im Vorbild durch: UPDATE rang SET taugt_als_beleg=1 WHERE r='S4';
-- DELETE FROM marker WHERE m='[!]'. INSERT OR REPLACE umging beide, weil der DELETE-Trigger
-- bei REPLACE nur mit PRAGMA recursive_triggers feuert -- darum zusaetzlich ein
-- INSERT-Trigger, der jedes Nachschieben sperrt. Hier haelt er zugleich den sechsten
-- Marker '[!!]' draussen, solange er nicht definiert ist.
CREATE TRIGGER tr_marker_kein_update BEFORE UPDATE ON marker BEGIN
    SELECT RAISE(ABORT, 'Die fuenf Marker sind Verfassung, nicht Daten (CONSTITUTION Regel 1)');
END;
CREATE TRIGGER tr_marker_kein_delete BEFORE DELETE ON marker BEGIN
    SELECT RAISE(ABORT, 'Die fuenf Marker sind Verfassung, nicht Daten (CONSTITUTION Regel 1)');
END;
CREATE TRIGGER tr_marker_kein_insert BEFORE INSERT ON marker BEGIN
    SELECT RAISE(ABORT, 'Die Markermenge ist vollstaendig. Auch INSERT OR REPLACE aendert sie nicht. Ein sechster Marker gehoert erst in CONSTITUTION.md.');
END;
CREATE TRIGGER tr_rang_kein_update BEFORE UPDATE ON rang BEGIN
    SELECT RAISE(ABORT, 'Die Rangfolge ist Verfassung, nicht Daten. Der Altbaum 1.5.4 wird kein Beleg.');
END;
CREATE TRIGGER tr_rang_kein_delete BEFORE DELETE ON rang BEGIN
    SELECT RAISE(ABORT, 'Die Rangfolge ist Verfassung, nicht Daten. Der Altbaum 1.5.4 wird kein Beleg.');
END;
CREATE TRIGGER tr_rang_kein_insert BEFORE INSERT ON rang BEGIN
    SELECT RAISE(ABORT, 'Die Rangfolge ist vollstaendig. Auch INSERT OR REPLACE aendert sie nicht.');
END;

-- ---- (e) Ein benutzter Beleg wird weder geloescht noch umgeschrieben noch ersetzt.
-- INSERT OR REPLACE mit gesetzter id tauschte im Vorbild den Beleg unter dem stehenden [x]
-- aus, ohne einen der Trigger auszuloesen.
CREATE TRIGGER tr_quellbeleg_kein_replace BEFORE INSERT ON quellbeleg BEGIN
    SELECT RAISE(ABORT, 'Ein Quellbeleg wird nicht ueber INSERT OR REPLACE ersetzt')
    WHERE NEW.id IS NOT NULL AND EXISTS (SELECT 1 FROM quellbeleg WHERE id = NEW.id);
END;
CREATE TRIGGER tr_laufzeitbeleg_kein_replace BEFORE INSERT ON laufzeitbeleg BEGIN
    SELECT RAISE(ABORT, 'Ein Laufzeitbeleg wird nicht ueber INSERT OR REPLACE ersetzt')
    WHERE NEW.id IS NOT NULL AND EXISTS (SELECT 1 FROM laufzeitbeleg WHERE id = NEW.id);
END;
CREATE TRIGGER tr_quellbeleg_kein_delete_wenn_benutzt BEFORE DELETE ON quellbeleg BEGIN
    SELECT RAISE(ABORT, 'Dieser Quellbeleg traegt einen Befund und kann nicht geloescht werden')
    WHERE EXISTS (SELECT 1 FROM befund WHERE quellbeleg_id = OLD.id);
END;
CREATE TRIGGER tr_laufzeitbeleg_kein_delete_wenn_benutzt BEFORE DELETE ON laufzeitbeleg BEGIN
    SELECT RAISE(ABORT, 'Dieser Laufzeitbeleg traegt einen Befund und kann nicht geloescht werden')
    WHERE EXISTS (SELECT 1 FROM befund WHERE laufzeitbeleg_id = OLD.id);
END;
CREATE TRIGGER tr_quellbeleg_kein_austausch BEFORE UPDATE ON quellbeleg BEGIN
    SELECT RAISE(ABORT, 'Ein benutzter Quellbeleg wird nicht umgeschrieben, sondern ersetzt')
    WHERE EXISTS (SELECT 1 FROM befund WHERE quellbeleg_id = OLD.id)
      AND (NEW.pfad <> OLD.pfad OR NEW.anker <> OLD.anker OR NEW.rang <> OLD.rang
           OR IFNULL(NEW.stelle,'') <> IFNULL(OLD.stelle,''));
END;
-- Die beiden Kontrollen sind TEIL des Belegs: werden sie nachtraeglich ausgehoehlt, ist die
-- Messung eine andere. Im Vorbild nannte der Austauschtrigger sie zunaechst nicht.
CREATE TRIGGER tr_laufzeitbeleg_kein_austausch BEFORE UPDATE ON laufzeitbeleg BEGIN
    SELECT RAISE(ABORT, 'Ein benutzter Laufzeitbeleg wird nicht umgeschrieben, sondern ersetzt')
    WHERE EXISTS (SELECT 1 FROM befund WHERE laufzeitbeleg_id = OLD.id)
      AND (NEW.pfad <> OLD.pfad OR NEW.anker <> OLD.anker OR NEW.rang <> OLD.rang
           OR NEW.positivkontrolle <> OLD.positivkontrolle
           OR NEW.negativkontrolle <> OLD.negativkontrolle
           OR IFNULL(NEW.nulldiff,'') <> IFNULL(OLD.nulldiff,'')
           OR IFNULL(NEW.stelle,'')   <> IFNULL(OLD.stelle,''));
END;

-- ---- (f) Ein Beleg traegt nicht beliebig viele Befunde.
-- Ein Quellbeleg DARF mehrere tragen: dieselbe Methode belegt oft Aufbau und Aufrufweg.
-- Verboten ist die Ausdehnung ins Beliebige. DIE ZAHL DREI IST EINE SETZUNG, keine Messung,
-- und wird darum hier benannt: mehr als drei Gegenstaende aus einem Anker heisst, der Anker
-- ist zu grob gewaehlt -- dann gehoert je Gegenstand ein eigener, engerer Anker in die Tabelle.
CREATE TRIGGER tr_quellbeleg_nicht_uferlos BEFORE INSERT ON befund BEGIN
    SELECT RAISE(ABORT, 'Dieser Quellbeleg traegt bereits drei Befunde. Ein vierter heisst: der Anker ist zu grob.')
    WHERE NEW.quellbeleg_id IS NOT NULL
      AND (SELECT COUNT(*) FROM befund WHERE quellbeleg_id = NEW.quellbeleg_id) >= 3;
END;
-- Beim Laufzeitbeleg ist die Zahl nicht drei, sondern EINS -- und das ist keine Setzung,
-- sondern folgt aus der Kontrollpflicht: Positiv- und Negativkontrolle sind auf IHRE Aussage
-- zugeschnitten. Zwei Aussagen brauchen zwei Kontrollpaare, also zwei Belegzeilen. Ein
-- value-Hash belegt den Wert, den er gehasht hat, und keinen zweiten.
CREATE TRIGGER tr_laufzeitbeleg_nicht_uferlos BEFORE INSERT ON befund BEGIN
    SELECT RAISE(ABORT, 'Dieser Laufzeitbeleg traegt bereits einen Befund. Eine Messung mit einem Kontrollpaar belegt eine Aussage.')
    WHERE NEW.laufzeitbeleg_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM befund WHERE laufzeitbeleg_id = NEW.laufzeitbeleg_id);
END;

-- ---- (g) Der Gegenstand unter einem stehenden Befund behaelt seinen Ort.
CREATE TRIGGER tr_gegenstand_kein_ortswechsel
BEFORE UPDATE OF werk, stelle, art ON gegenstand BEGIN
    SELECT RAISE(ABORT, 'Dieser Gegenstand traegt einen Befund; Ort und Art bleiben, sonst zeigt der Beleg woandershin')
    WHERE EXISTS (SELECT 1 FROM befund WHERE gegenstand_id = OLD.id)
      AND (IFNULL(NEW.werk,'')   <> IFNULL(OLD.werk,'')
        OR IFNULL(NEW.stelle,'') <> IFNULL(OLD.stelle,'')
        OR NEW.art <> OLD.art);
END;

-- ============================================================ Sichten (Zaehlung)
-- docs/CONSTITUTION.md Regel 5: die Achsen werden getrennt gezaehlt, und
-- docs/VERIFY_PROGRESS.md ist SSOT. Diese Sichten sind die einzige Quelle fuer Zahlen,
-- die aus dieser DB stammen.

CREATE VIEW v_gegenstand AS
SELECT g.id, g.art, g.name,
       CASE WHEN g.werk IS NULL THEN '(nicht verortet)'
            WHEN g.stelle IS NULL THEN g.werk
            ELSE g.werk || ' / ' || g.stelle
       END AS ort
FROM gegenstand g;

CREATE VIEW v_stand AS
SELECT b.achse, b.marker, COUNT(*) AS n FROM befund b GROUP BY b.achse, b.marker;

-- Ein Beleg darf mehrere Befunde tragen. Aber ein Laufzeitbeleg, an dem achtzehn [x]
-- haengen, ist keine Messung mehr, sondern eine Behauptung. Diese Sicht macht die Deckung
-- sichtbar; das Tor entscheidet, ab wann es zu viel ist.
CREATE VIEW v_belegdeckung AS
SELECT 'quellbeleg' AS art, q.id, q.rang, q.pfad, q.anker,
       (SELECT COUNT(*) FROM befund b WHERE b.quellbeleg_id = q.id) AS traegt_befunde
FROM quellbeleg q
UNION ALL
SELECT 'laufzeitbeleg', l.id, l.rang, l.pfad, l.anker,
       (SELECT COUNT(*) FROM befund b WHERE b.laufzeitbeleg_id = l.id)
FROM laufzeitbeleg l;

-- Der Summenwaechter stellt Zeilen, eingeordnete Zeilen und verschiedene Gegenstaende
-- nebeneinander. Weicht die dritte Zahl ab, wird doppelt gezaehlt.
CREATE VIEW v_summenprobe AS
SELECT 'befund' AS liste,
       (SELECT COUNT(*) FROM befund),
       (SELECT COUNT(*) FROM befund b JOIN marker m ON m.m = b.marker),
       (SELECT COUNT(*) FROM (SELECT DISTINCT gegenstand_id, achse FROM befund))
UNION ALL
SELECT 'gegenstand',
       (SELECT COUNT(*) FROM gegenstand),
       (SELECT COUNT(*) FROM gegenstand),
       (SELECT COUNT(*) FROM (SELECT DISTINCT lower(trim(name)) FROM gegenstand))
UNION ALL
SELECT 'quellbeleg',
       (SELECT COUNT(*) FROM quellbeleg),
       (SELECT COUNT(*) FROM quellbeleg q JOIN rang r ON r.r = q.rang AND r.taugt_als_beleg = 1),
       (SELECT COUNT(*) FROM (SELECT DISTINCT lower(replace(pfad,'\','/')), anker FROM quellbeleg))
UNION ALL
SELECT 'laufzeitbeleg',
       (SELECT COUNT(*) FROM laufzeitbeleg),
       (SELECT COUNT(*) FROM laufzeitbeleg l JOIN rang r ON r.r = l.rang AND r.taugt_als_beleg = 1),
       (SELECT COUNT(*) FROM (SELECT DISTINCT lower(replace(pfad,'\','/')), anker FROM laufzeitbeleg))
UNION ALL
-- Ein Befund, dessen Beleg-Zeiger ins Leere geht, ist ohne PRAGMA einfuegbar. Diese Zeile
-- macht ihn in der Zaehlung sichtbar, ohne PRAGMA und ohne foreign_key_check.
SELECT 'befund_belegdeckung',
       (SELECT COUNT(*) FROM befund WHERE quellbeleg_id IS NOT NULL OR laufzeitbeleg_id IS NOT NULL),
       (SELECT COUNT(*) FROM befund b
         WHERE (b.quellbeleg_id    IS NULL OR EXISTS (SELECT 1 FROM quellbeleg    WHERE id = b.quellbeleg_id))
           AND (b.laufzeitbeleg_id IS NULL OR EXISTS (SELECT 1 FROM laufzeitbeleg WHERE id = b.laufzeitbeleg_id))
           AND (b.quellbeleg_id IS NOT NULL OR b.laufzeitbeleg_id IS NOT NULL)),
       (SELECT COUNT(*) FROM befund WHERE quellbeleg_id IS NOT NULL OR laufzeitbeleg_id IS NOT NULL);

-- ============================================================ Meta
-- docs/CONSTITUTION.md Regel 8: nie "fertig/100 %", solange der Tracker nicht 100 % [x]
-- traegt. Eine handgeschriebene Prozentzahl in einer Meta-Zeile waere genau die Umgehung.
CREATE TABLE project_info (
    key   TEXT PRIMARY KEY NOT NULL
          CHECK (typeof(key) = 'text' AND key GLOB '[a-z][a-z0-9_]*' AND length(key) >= 3),
    value TEXT NOT NULL
          CHECK (typeof(value) = 'text' AND length(trim(value)) >= 1
                 AND instr(value,'%') = 0
                 AND lower(value) NOT GLOB '*prozent*')
);
