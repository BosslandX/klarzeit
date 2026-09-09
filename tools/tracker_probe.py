#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tracker_probe.py -- die Angriffe auf tools/tracker_schema.sql, die NICHT durchkommen duerfen.

WARUM ES DAS GIBT: docs/CONSTITUTION.md steht als Prosa da, das Schema als Bedingung.
Ob die Bedingung die Prosa wirklich traegt, entscheidet keine Durchsicht, sondern der
Versuch. Diese Datei fuehrt ihn -- je Regel mindestens ein Angriff.

DREI ARTEN VON FAELLEN, und alle drei werden gebraucht:

  ANGRIFF   (muss abgewiesen werden)  -- die Regel haelt
  GUELTIG   (muss durchkommen)        -- die Regel sperrt nicht ALLES. Ein Schema, das
                                         jede Zeile abweist, besteht jede Angriffsprobe
                                         und ist trotzdem kaputt.
  MESSGERAET-KONTROLLE                -- kann dieser Angriff ueberhaupt scheitern? Dazu
                                         wird die zugehoerige CHECK-Zeile aus dem
                                         SCHEMATEXT entfernt und derselbe Angriff erneut
                                         gefahren. Kommt er dann NICHT durch, prueft der
                                         Angriff etwas anderes als gedacht -- und sein
                                         Gruen im Normallauf war geschenkt.

Die dritte Art ist der Grund, warum diese Datei mehr ist als eine Liste. Aus der Hausregel:
"Ein Werkzeug, das nicht crasht, kann trotzdem das Falsche messen."

Aufruf: python -u tools/tracker_probe.py [--laut]
Exit:   0 = jeder Angriff abgewiesen, jeder gueltige Fall durchgekommen,
            jede Messgeraet-Kontrolle bestanden
"""
import io
import os
import re
import sqlite3
import sys
import tempfile

HIER = os.path.dirname(os.path.abspath(__file__))
SCHEMA = os.path.join(HIER, 'tracker_schema.sql')
sys.path.insert(0, HIER)


# --------------------------------------------------------------------- Geruest
def _schematext():
    """Schema des Profils PLUS die Auftragstabelle, falls sie danebenliegt.

    Ohne sie prueft die Probe ein anderes Schema als das, das im Projekt steht -- und
    ihr Gruen gaelte fuer eine Datenbank, die es so nirgends gibt.
    """
    t = io.open(SCHEMA, encoding='utf-8').read()
    zusatz = os.path.join(HIER, 'auftragstabelle.sql')
    if os.path.exists(zusatz):
        t += '\n' + io.open(zusatz, encoding='utf-8').read()
    return t


def frische_db(schematext=None):
    """Eine Wegwerf-DB aus dem Schema. Der Aufrufer schliesst und loescht sie."""
    if schematext is None:
        schematext = _schematext()
    fd, pfad = tempfile.mkstemp(suffix='.probe.db')
    os.close(fd)
    os.unlink(pfad)
    con = sqlite3.connect(pfad)
    con.executescript(schematext)
    # Ohne dieses PRAGMA sind die Fremdschluessel wirkungslos. Es steht hier, weil es je
    # VERBINDUNG gilt -- nicht je Datei.
    con.execute('PRAGMA foreign_keys = ON')
    return con, pfad


def weg(con, pfad):
    con.close()
    if os.path.isfile(pfad):
        os.unlink(pfad)


# Ein Grundbestand, auf dem die Befund-Angriffe aufsetzen. Bewusst gueltig: eine Mutation
# soll GENAU EINE Regel verletzen und nicht nebenbei drei andere.
# ============================= DIE FAELLE KOMMEN AUS DEM PROFIL =============================
# Im Vorbild standen sie hier: Angriffe auf ein Schema mit Smali-Deskriptoren und
# S1-S3-Raengen. Ein Dokument- oder Codeprojekt hat weder das eine noch das andere --
# und ein Angriff, der eine Spalte nennt, die es nicht gibt, scheitert am Namen statt
# an der Regel. Das saehe wie "die Regel haelt" aus und waere "hier wurde nichts
# gemessen".
#
# profil_angriffe.py liefert:
#   GRUND         Liste von INSERT-Anweisungen: der Grundbestand, auf dem angegriffen wird
#   ANGRIFFE      (titel, check_marke|None, angriff_sql, regeltext)
#                 -- muessen ABGEWIESEN werden. ACHTUNG, die Reihenfolge ist genau
#                 diese: lauf() liest die Marke an ZWEITER Stelle. Ein Tupel mit der
#                 Marke an vierter Stelle laeuft fehlerfrei durch und meldet
#                 '0 Messgeraet-Kontrollen gefahren' -- das sieht wie ein Hinweis
#                 aus und ist ein stiller Ausfall der wichtigsten Kontrolle.
#   NACHTRAEGLICH (titel, angriff_sql, check_marke) -- Aenderungen an Stehendem
#   GUELTIG       (titel, sql) -- muessen DURCHKOMMEN. Ein Schema, das jede Zeile
#                 abweist, besteht jede Angriffsprobe und ist trotzdem kaputt.
import profil_angriffe                                # noqa: E402  bewusst nach sys.path

GRUND = profil_angriffe.GRUND
ANGRIFFE = profil_angriffe.ANGRIFFE
NACHTRAEGLICH = profil_angriffe.NACHTRAEGLICH
GUELTIG = profil_angriffe.GUELTIG


def grundbestand(con):
    for sql in GRUND:
        con.execute(sql)
    con.commit()


# --------------------------------------------------------- Messgeraet-Kontrolle
def check_bloecke(schematext):
    """Alle CHECK-Bloecke des Schemas als (start, ende) ueber Zeilenindizes.

    Ein Block beginnt an der Zeile, deren getrimmte Form mit CHECK beginnt, und endet,
    wenn sich seine Klammern wieder schliessen.
    """
    zeilen = schematext.split('\n')
    bloecke = []
    i = 0
    while i < len(zeilen):
        if zeilen[i].lstrip().startswith('CHECK'):
            tiefe = 0
            start = i
            while i < len(zeilen):
                tiefe += zeilen[i].count('(') - zeilen[i].count(')')
                i += 1
                if tiefe <= 0:
                    break
            bloecke.append((start, i))
            continue
        i += 1
    return zeilen, bloecke


def ohne_check(schematext, marke):
    """Setzt jeden CHECK-Block, der 'marke' enthaelt, auf die Tautologie CHECK (1=1).

    ZWEI FEHLER DER ERSTEN FASSUNG, beide von der Messgeraet-Kontrolle selbst gemeldet:

      (1) Sie suchte die Marke nur in der ERSTEN Zeile eines Blocks. Bei mehrzeiligen
          Bedingungen steht das kennzeichnende Stueck aber meist auf einer
          Fortsetzungszeile -- acht Marken galten darum als "nicht im Schema", obwohl
          sie wortwoertlich dort stehen.
      (2) Sie LOESCHTE den Block. War er der letzte Eintrag einer Komma-Liste, blieb ein
          haengendes Komma stehen und das Schema liess sich nicht mehr laden -- gemeldet
          als "SCHEMA OHNE ... LAEDT NICHT" beim L2-Null-Diff.

    Neutralisieren statt loeschen loest beides: die Komma-Struktur bleibt unberuehrt, und
    die Marke darf irgendwo im Block stehen. Rueckgabe (neuer_text, wieviele_bloecke).
    """
    zeilen, bloecke = check_bloecke(schematext)
    treffer = [(a, b) for (a, b) in bloecke if marke in '\n'.join(zeilen[a:b])]
    if not treffer:
        return schematext, 0
    aus = list(zeilen)
    for a, b in reversed(treffer):
        einzug = ' ' * (len(zeilen[a]) - len(zeilen[a].lstrip()))
        endet_mit_komma = zeilen[b - 1].rstrip().endswith(',')
        aus[a:b] = [einzug + 'CHECK (1=1)' + (',' if endet_mit_komma else '')]
    return '\n'.join(aus), len(treffer)


# ------------------------------------------------------------------- Durchlauf
def lauf(laut=False):
    schematext = _schematext()
    fehler = []
    print('== ANGRIFFE -- jeder MUSS abgewiesen werden ==')
    for titel, marke, sql, regel in ANGRIFFE:
        con, pfad = frische_db(schematext)
        try:
            grundbestand(con)
            try:
                con.execute(sql)
                con.commit()
                fehler.append('ANGRIFF KAM DURCH: %s  (%s)' % (titel, regel))
                print('  [FEHLER] %-46s KAM DURCH  <- %s' % (titel, regel))
            except sqlite3.Error as e:
                con.rollback()
                if laut:
                    print('  [ok]     %-46s %s' % (titel, str(e)[:60]))
                else:
                    print('  [ok]     %-46s %s' % (titel, regel))
        finally:
            weg(con, pfad)

    print()
    print('== NACHTRAEGLICHE AENDERUNGEN an einem stehenden [x] -- jede MUSS abgewiesen werden ==')
    for titel, sql, regel in NACHTRAEGLICH:
        con, pfad = frische_db(schematext)
        try:
            grundbestand(con)
            # Der stehende Befund, an dem nachtraeglich manipuliert wird. Er nennt eine
            # ACHSE und gehoert damit ins Profil -- fest verdrahtet scheiterte er unter
            # jedem anderen Profil am CHECK, und zwar BEVOR der eigentliche Angriff lief.
            con.execute(profil_angriffe.STEHENDER_BEFUND)
            con.commit()
            try:
                con.execute(sql)
                con.commit()
                fehler.append('AENDERUNG KAM DURCH: %s  (%s)' % (titel, regel))
                print('  [FEHLER] %-46s KAM DURCH  <- %s' % (titel, regel))
            except sqlite3.Error as e:
                con.rollback()
                print('  [ok]     %-46s %s' % (titel, regel))
        finally:
            weg(con, pfad)

    print()
    print('== POSITIVKONTROLLEN -- jede MUSS durchkommen ==')
    print('   (ein Schema, das alles abweist, besteht jede Angriffsprobe und ist kaputt)')
    for titel, sql in GUELTIG:
        con, pfad = frische_db(schematext)
        try:
            grundbestand(con)
            try:
                con.execute(sql)
                con.commit()
                print('  [ok]     %-46s durchgekommen' % titel)
            except sqlite3.Error as e:
                fehler.append('GUELTIGER FALL ABGEWIESEN: %s -- %s' % (titel, e))
                print('  [FEHLER] %-46s ABGEWIESEN: %s' % (titel, str(e)[:50]))
        finally:
            weg(con, pfad)

    print()
    print('== MESSGERAET-KONTROLLE -- kann der Angriff ueberhaupt scheitern? ==')
    print('   Die zugehoerige CHECK-Zeile wird aus dem SCHEMATEXT entfernt. Danach MUSS')
    print('   derselbe Angriff durchkommen. Tut er es nicht, prueft er etwas anderes als')
    print('   gedacht, und sein Gruen oben war geschenkt.')
    mit_marke = [(t, m, s, r) for (t, m, s, r) in ANGRIFFE if m]
    ohne_marke = len(ANGRIFFE) - len(mit_marke)
    for titel, marke, sql, regel in mit_marke:
        text, n = ohne_check(schematext, marke)
        if n == 0:
            fehler.append('MARKE NICHT GEFUNDEN: %r (%s)' % (marke, titel))
            print('  [FEHLER] %-46s Marke steht nicht im Schema' % titel)
            continue
        try:
            con, pfad = frische_db(text)
        except sqlite3.Error as e:
            fehler.append('SCHEMA OHNE %r LAEDT NICHT: %s' % (marke, e))
            print('  [FEHLER] %-46s Schema ohne die Bedingung laedt nicht' % titel)
            continue
        try:
            grundbestand(con)
            try:
                con.execute(sql)
                con.commit()
                print('  [ok]     %-46s ohne die Bedingung durchgekommen (%d Block)' % (titel, n))
            except sqlite3.Error as e:
                fehler.append('SCHEINKONTROLLE: %s wird auch OHNE seine CHECK-Zeile '
                              'abgewiesen -- %s' % (titel, str(e)[:70]))
                print('  [FEHLER] %-46s auch OHNE die Bedingung abgewiesen' % titel)
        finally:
            weg(con, pfad)
    print('  [i] %d von %d Angriffen ohne benannte CHECK-Bedingung (Trigger oder Index) --'
          % (ohne_marke, len(ANGRIFFE)))
    print('      fuer sie ist diese Kontrolle nicht gefahren. Ungeprueft heisst ungemessen,')
    print('      nicht haltend.')

    print()
    print('== SUMME ==')
    print('  Angriffe                : %d' % len(ANGRIFFE))
    print('  Nachtraegliche Aenderungen: %d' % len(NACHTRAEGLICH))
    print('  Positivkontrollen       : %d' % len(GUELTIG))
    print('  Messgeraet-Kontrollen   : %d gefahren, %d nicht moeglich'
          % (len(mit_marke), ohne_marke))
    print('  Faelle gesamt           : %d'
          % (len(ANGRIFFE) + len(NACHTRAEGLICH) + len(GUELTIG) + len(mit_marke)))
    print()
    if fehler:
        print('ERGEBNIS: %d Befund(e) -- das Schema traegt die Verfassung NICHT:' % len(fehler))
        for f in fehler:
            print('  %s' % f)
        return 1
    print('ERGEBNIS: jeder Angriff abgewiesen, jeder gueltige Fall durchgekommen,')
    print('          jede Messgeraet-Kontrolle bestanden.')
    return 0


def kontrolle_am_werkzeug():
    """Zwei Fragen an diese Datei selbst, VOR jeder Messung. Rueckgabe: Zahl der Befunde.

    Beide stehen hier, weil beide hier schon zugeschlagen haben.
    """
    n = 0
    print('== KONTROLLE AM WERKZEUG ==')

    # (1) Die Windows-Konsole faehrt cp1252. Ein einziges Nicht-ASCII-Zeichen in der
    #     Ausgabe beendet den Lauf mit Exit 1, obwohl alles sauber war. Geprueft wird gegen
    #     ASCII, nicht gegen die gerade eingestellte Kodierung -- sonst meldet eine
    #     UTF-8-Konsole gruen und die naechste Konsole faellt.
    eigen = io.open(os.path.abspath(__file__), encoding='utf-8').read()
    schlimm = sorted({ord(c) for c in eigen if ord(c) > 127})
    print('  [%s] diese Datei ist rein ASCII -- %s'
          % ('ok' if not schlimm else 'FEHLER',
             'ja' if not schlimm else 'faellt auf cp1252: %s' % [hex(o) for o in schlimm]))
    n += 0 if not schlimm else 1

    # (2) KEIN ANGRIFFSTEXT ENTHAELT EIN STEUERZEICHEN.
    #     GEMESSEN 2026-09-06: der Windows-Pfad-Angriff stand mit EINFACHEN Backslashes im
    #     Quelltext. Python las daraus \a als BEL (0x07) und \r als CR; der Pfad enthielt
    #     danach kein 'analyse' mehr, die gemeinte Sperre konnte nicht feuern, eine andere
    #     wies den Fall ab -- und die Probe meldete das als Schema-Befund. Ein Steuerzeichen
    #     in einem Angriffstext ist immer ein Tippfehler, nie Absicht.
    verdaechtig = []
    for liste, name in ((ANGRIFFE, 'ANGRIFFE'), (NACHTRAEGLICH, 'NACHTRAEGLICH')):
        for eintrag in liste:
            titel, sql = eintrag[0], eintrag[2] if name == 'ANGRIFFE' else eintrag[1]
            steuer = sorted({ord(ch) for ch in sql if ord(ch) < 32})
            if steuer:
                verdaechtig.append('%s: %s -> %s' % (name, titel, [hex(o) for o in steuer]))
    for titel, sql in GUELTIG:
        steuer = sorted({ord(ch) for ch in sql if ord(ch) < 32})
        if steuer:
            verdaechtig.append('GUELTIG: %s -> %s' % (titel, [hex(o) for o in steuer]))
    print('  [%s] kein Angriffstext traegt ein Steuerzeichen -- %s'
          % ('ok' if not verdaechtig else 'FEHLER',
             'geprueft' if not verdaechtig else verdaechtig[0]))
    if verdaechtig:
        for v in verdaechtig:
            print('        %s' % v)
        n += 1

    # (3) Positiv-Kontrolle zu (2): erkennt die Pruefung ein Steuerzeichen ueberhaupt?
    #     Ohne sie waere "keine gefunden" nicht von "nicht finden koennen" zu unterscheiden.
    koeder = "INSERT INTO x VALUES ('a" + chr(7) + "b')"
    erkannt = bool([ch for ch in koeder if ord(ch) < 32])
    print('  [%s] Positiv-Kontrolle: ein eingebautes BEL wird erkannt -- %s'
          % ('ok' if erkannt else 'FEHLER', 'ja' if erkannt else 'NEIN, die Pruefung ist blind'))
    n += 0 if erkannt else 1
    print()
    return n


def main():
    if not os.path.isfile(SCHEMA):
        print('tools/tracker_schema.sql fehlt -- es gibt nichts zu pruefen.')
        return 1
    if kontrolle_am_werkzeug():
        print('ABBRUCH: das Werkzeug ist nicht in Ordnung. Es wuerde Befunde ueber das')
        print('         Schema melden, die aus ihm selbst stammen.')
        return 1
    return lauf(laut='--laut' in sys.argv)


if __name__ == '__main__':
    sys.exit(main())
