# -*- coding: utf-8 -*-
"""Angriffe auf das Schema des Profils "code".

DREI ARTEN VON FAELLEN, und alle drei werden gebraucht:
  ANGRIFFE      (titel, check_marke, angriff_sql, regeltext)
                muessen ABGEWIESEN werden -- die Regel haelt.
  GUELTIG       muessen DURCHKOMMEN -- ein Schema, das jede Zeile abweist, besteht jede
                Angriffsprobe und ist trotzdem kaputt.
  check_marke   ein woertliches Stueck der SCHEMA-Zeile, die den Angriff abwehren soll.
                Fuer die Messgeraet-Kontrolle: diese Zeile wird aus dem Schematext
                entfernt, dann MUSS derselbe Angriff durchkommen. Tut er es nicht,
                prueft der Angriff etwas anderes als gedacht -- und sein Gruen im
                Normallauf war geschenkt. None = keine einzelne Zeile (Trigger,
                zusammengesetzte Bedingung); die Kontrolle entfaellt und wird im
                Bericht ausgewiesen, statt stillschweigend uebersprungen zu werden.

Abgeleitet aus profile/dokument/profil_angriffe.py; die Struktur stammt aus
C:\\gamedev\\grandprix\\tools\\tracker_probe.py.
"""

# Der stehende Befund, an dem die NACHTRAEGLICH-Faelle manipulieren.
STEHENDER_BEFUND = (
    "INSERT INTO befund(id,gegenstand_id,achse,marker,aussage,quellbeleg_id) "
    "VALUES (1,1,'implementiert','[x]','Die Funktion baut den Wert an dieser Stelle.',1)")

GRUND = [
    ("INSERT INTO gegenstand(id,art,name,werk,stelle) VALUES "
     "(1,'funktion','Kernfunktion','src/probe','probeFunktion')"),
    ("INSERT INTO gegenstand(id,art,name,werk,stelle) VALUES "
     "(2,'typ','Ergebnistyp','src/probe','ProbeTyp')"),
    ("INSERT INTO gegenstand(id,art,name) VALUES (3,'modul','src/probe')"),
    ("INSERT INTO quellbeleg(id,rang,pfad,anker,stelle) VALUES "
     "(1,'C1','src/probe/index.ts','const kernWert = berechne(','S.143')"),
    ("INSERT INTO quellbeleg(id,rang,pfad,anker) VALUES "
     "(2,'C1','src/probe/zwei.ts','export function zwei(')"),
    ("INSERT INTO laufzeitbeleg(id,rang,pfad,anker,positivkontrolle,negativkontrolle) VALUES "
     "(1,'L1','auftraege/_ergebnisse/testlauf.txt','41 von 41 Tests gruen',"
     "'der Test faellt um, wenn die Aenderung zurueckgedreht wird',"
     "'ein bewusst falscher Erwartungswert laesst ihn scheitern')"),
]

ANGRIFFE = [
    ('sechster Marker wird nachgeschoben',
     None,
     "INSERT INTO marker(m,sinn) VALUES ('[!!]','schwerer Befund')",
     'Marker -- geschlossenes Vokabular'),
    ('Marker per INSERT OR REPLACE ausgetauscht',
     None,
     "INSERT OR REPLACE INTO marker(m,sinn) VALUES ('[x]','geht jetzt auch ohne Beleg')",
     'Marker -- geschlossenes Vokabular'),
    ('unbekannte Achse im Befund',
     None,
     "INSERT INTO befund(gegenstand_id,achse,marker,aussage) VALUES (1,'gelesen','[x]','Eine hinreichend lange Aussage ueber die Funktion.')",
     'drei Achsen, geschlossen'),
    ('fuenfter Quellrang wird nachgeschoben',
     None,  # ein Trigger weist ihn ab, nicht die CHECK-Zeile -- von der
            # Messgeraet-Kontrolle gemeldet, nicht vermutet
     "INSERT INTO rang(r,seite,wurzel,bedeutung,taugt_als_beleg) VALUES ('C5','quelle',NULL,'irgendwas',1)",
     'Rangfolge -- geschlossen'),
    ('[x] extrahiert ohne Quellbeleg',
     "marker <> '[x]' OR achse <> 'implementiert'",
     "INSERT INTO befund(gegenstand_id,achse,marker,aussage) VALUES (1,'implementiert','[x]','Die Funktion baut den Wert an dieser Stelle.')",
     'kein [x] ohne Beleg'),
    ('[x] geprueft ohne Laufzeitbeleg -- der Code steht ist nicht der Test faellt ohne ihn um',
     "marker <> '[x]' OR achse <> 'getestet'",
     "INSERT INTO befund(gegenstand_id,achse,marker,aussage,quellbeleg_id) VALUES (1,'getestet','[x]','Der Test deckt diesen Zweig nachweislich ab.',1)",
     'kein [x] ohne Beleg'),
    ('[x] eingeordnet ohne ablage',
     "achse <> 'gemessen'",  # trifft BEIDE Bloecke -- der zweite wies sonst
                                # ab, und die Kontrolle meldete Scheinkontrolle
     "INSERT INTO befund(gegenstand_id,achse,marker,aussage,quellbeleg_id,laufzeitbeleg_id) VALUES (1,'gemessen','[x]','Die Messung liegt mit beiden Kontrollen vor.',1,1)",
     'kein [x] ohne Beleg'),
    ('Q4 als Quellbeleg gefuehrt',
     None,
     "INSERT INTO quellbeleg(rang,pfad,anker) VALUES ('C4','src/fremd/vermutung.ts','irgendein laengerer Anker')",
     'C4 ist Vermutung, kein Beleg'),
    ('nackte Zeilenangabe als Anker (Seitenform)',
     "'z','zz','zff'",
     "INSERT INTO quellbeleg(rang,pfad,anker) VALUES ('C1','src/probe/index.ts','Zeile 183')",
     'der Anker traegt Wortlaut'),
    ('nackte Zeilenangabe als Anker',
     "'z','zz','zff'",
     "INSERT INTO quellbeleg(rang,pfad,anker) VALUES ('C1','src/probe/index.ts','Zeile 1183')",
     'der Anker traegt Wortlaut'),
    ('Anker zu kurz',
     None,  # Laengenregel UND Wortlautregel greifen beide; keine einzelne Zeile
            # laesst sich isolieren. Ungeprueft heisst hier ungemessen, nicht haltend.
     "INSERT INTO quellbeleg(rang,pfad,anker) VALUES ('C1','src/probe/index.ts','ab')",
     'der Anker traegt Wortlaut'),
    ('Anker aus unsichtbaren Zeichen',
     None,
     "INSERT INTO quellbeleg(rang,pfad,anker) VALUES ('C1','src/probe/index.ts','\xa0\u200b\xa0\u200b\xa0')",
     'sichtbare Zeichen, nicht bloss Nichtleere'),
    ('Platzhalter als Anker',
     "NOT GLOB '*todo*'",
     "INSERT INTO quellbeleg(rang,pfad,anker) VALUES ('C1','src/probe/index.ts','TODO nachtragen')",
     'kein Platzhalter als Beleg'),
    ('Anker aus einem einzigen Zeichen wiederholt',
     'substr(anker,1,1)',
     "INSERT INTO quellbeleg(rang,pfad,anker) VALUES ('C1','src/probe/index.ts','xxxxxxxx')",
     'mindestens zwei verschiedene Zeichen'),
    ('Prosa als Pfad',
     "CHECK (instr(pfad,'/') > 0 OR instr(pfad,'\\') > 0)",
     "INSERT INTO quellbeleg(rang,pfad,anker) VALUES ('C1','siehe_oben','ein tauglicher Anker')",
     'ein Pfad sieht wie ein Pfad aus'),
    ('Pfad mit Leerzeichen',
     "instr(pfad,' ') = 0",
     "INSERT INTO quellbeleg(rang,pfad,anker) VALUES ('C1','src/probe/mit lucke.ts','ein tauglicher Anker')",
     'ein Pfad sieht wie ein Pfad aus'),
    ('Stelle ohne Modul',
     'stelle IS NULL OR werk IS NOT NULL',
     "INSERT INTO gegenstand(art,name,stelle) VALUES ('konfiguration','HilfsEintrag','vierteFunktion')",
     'eine Stelle ohne Modul ist kein Ort'),
    ('verortete Art ohne Werk',
     "art NOT IN ('funktion','typ','endpunkt','komponente')",
     "INSERT INTO gegenstand(art,name) VALUES ('funktion','Eine Funktion ohne Modul')",
     'verortete Arten brauchen ihr Werk'),
    ('derselbe Ort zweimal',
     None,
     "INSERT INTO gegenstand(art,name,werk,stelle) VALUES ('funktion','Anderer Name','src/probe','probeFunktion')",
     'ein Ort gehoert einem Gegenstand'),
    ('derselbe Name mit anderer Schreibweise',
     None,
     "INSERT INTO gegenstand(art,name,werk,stelle) VALUES ('funktion','kern funktion','src/probe','andereFunktion')",
     'ein Name, ein Gegenstand'),
    ('[?] ohne Begruendung',
     "marker <> '[?]' OR (blockade IS NOT NULL",
     "INSERT INTO befund(gegenstand_id,achse,marker,aussage) VALUES (1,'implementiert','[?]','Hier ist etwas unklar geblieben.')",
     'ein Fragezeichen ohne Grund ist eine Luecke'),
    ('[!] ohne Gegenstelle',
     "marker <> '[!]' OR (widerspruch_zu IS NOT NULL",
     "INSERT INTO befund(gegenstand_id,achse,marker,aussage) VALUES (1,'implementiert','[!]','Das widerspricht einer anderen Stelle.')",
     'ein Widerspruch muss sagen, wogegen'),
    ('Befund zeigt auf einen Beleg, den es nicht gibt',
     None,
     "INSERT INTO befund(gegenstand_id,achse,marker,aussage,quellbeleg_id) VALUES (1,'implementiert','[x]','Eine hinreichend lange Aussage ueber die Funktion.',4711)",
     'Zeiger muessen auf Zeilen zeigen'),
    ('Befund zeigt auf einen Gegenstand, den es nicht gibt',
     None,
     "INSERT INTO befund(gegenstand_id,achse,marker,aussage,quellbeleg_id) VALUES (4711,'implementiert','[x]','Eine hinreichend lange Aussage ueber die Funktion.',1)",
     'Zeiger muessen auf Zeilen zeigen'),
    ('Laufzeitbeleg ohne Negativkontrolle',
     None,
     "INSERT INTO laufzeitbeleg(rang,pfad,anker,positivkontrolle) VALUES ('L1','auftraege/_ergebnisse/lauf.txt','41 von 41 Tests gruen','der Test faellt um, wenn die Aenderung zurueckgedreht wird')",
     'ein Lauf braucht beide Kontrollen'),
    ('beide Kontrollen sind derselbe Satz',
     'lower(positivkontrolle) <> lower(negativkontrolle)',
     "INSERT INTO laufzeitbeleg(rang,pfad,anker,positivkontrolle,negativkontrolle) VALUES ('L1','auftraege/_ergebnisse/lauf.txt','41 von 41 Tests gruen','dieselbe Kontrolle','dieselbe Kontrolle')",
     'beide Kontrollen muessen verschieden sein'),
    ('Prozentzahl in project_info',
     "instr(value,'%') = 0",
     "INSERT INTO project_info(key,value) VALUES ('abdeckung','82%')",
     'keine handgeschriebene Prozentzahl'),
    ('das Wort Prozent statt des Zeichens',
     "NOT GLOB '*prozent*'",
     "INSERT INTO project_info(key,value) VALUES ('abdeckung','82 Prozent')",
     'keine handgeschriebene Prozentzahl'),
]

NACHTRAEGLICH = [
    ("stehendes [x] auf einen anderen Beleg umhaengen",
     "UPDATE befund SET quellbeleg_id=2 WHERE id=1",
     "ein stehendes [x] wird nicht umgehaengt"),
    ("stehendes [x] auf einen anderen Gegenstand umhaengen",
     "UPDATE befund SET gegenstand_id=2 WHERE id=1",
     "ein stehendes [x] wird nicht umgehaengt"),
    ("benutzten Quellbeleg umschreiben",
     "UPDATE quellbeleg SET anker='ein voellig anderer Anker' WHERE id=1",
     "ein benutzter Beleg wird ersetzt, nicht umgeschrieben"),
    ("benutzten Quellbeleg loeschen",
     "DELETE FROM quellbeleg WHERE id=1",
     "ein benutzter Beleg wird nicht geloescht"),
    ("den Ort eines Gegenstands unter stehendem Befund wechseln",
     "UPDATE gegenstand SET stelle='geaenderteFunktion' WHERE id=1",
     "der Ort bleibt, sonst zeigt der Beleg woandershin"),
]

GUELTIG = [
    ("Q1 aus dem Volltext, mit gedruckter Seite",
     "INSERT INTO quellbeleg(rang,pfad,anker,stelle) VALUES "
     "('C1','src/probe/drei.ts','export function drei(','S.77')"),
    ("Q2 aus Sekundaerliteratur",
     "INSERT INTO quellbeleg(rang,pfad,anker) VALUES "
     "('C2','src/probe/vier.ts','import { vier } from')"),
    ("Q3 als eigene Ableitung, als solche gefuehrt",
     "INSERT INTO quellbeleg(rang,pfad,anker) VALUES "
     "('C3','src/probe/abgeleitet.ts','abgeleitet aus dem Vertrag in')"),
    ("Kapitelangabe statt Seite -- EPUB ohne Seitenzaehlung",
     "INSERT INTO quellbeleg(rang,pfad,anker,stelle) VALUES "
     "('C1','src/probe/fuenf.ts','export const fuenf =','Kapitel 2, Abschnitt 4')"),
    ("Modul ohne Werk -- ein Modul IST das Werk, kein Ort darin",
     "INSERT INTO gegenstand(art,name) VALUES ('modul','src/andereswerk')"),
    ("L1 mit beiden Kontrollen",
     "INSERT INTO laufzeitbeleg(rang,pfad,anker,positivkontrolle,negativkontrolle) VALUES "
     "('L1','auftraege/_ergebnisse/lauf2.txt','41 von 41 Tests gruen, 0 uebersprungen',"
     "'der Test faellt um, wenn die Aenderung zurueckgedreht wird',"
     "'ein bewusst falscher Erwartungswert laesst ihn scheitern')"),
    ("Zahl ohne Prozentzeichen in project_info",
     "INSERT INTO project_info(key,value) VALUES ('gruene_tests','41 von 210')"),
]
