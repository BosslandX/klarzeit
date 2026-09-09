#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""beleg_pruefen.py -- prueft, ob die Belege im Tracker INHALTLICH auf etwas zeigen.

DIE LUECKE, DIE DAS HIER SCHLIESST: tools/tracker_schema.sql benennt seine eigene Grenze
ausdruecklich -- eine CHECK-Bedingung prueft die FORM eines Belegs, nie seinen Inhalt. Sie
unterscheidet 're/jadx/sources/d/a.java' + 'kairo.android.i.d.a' von '', aber nicht
'kairo.android.i.d.a' von 'kairo.android.i.d.b', und schon gar nicht eine existierende
Datei von einer erfundenen.

Genau daran ist in diesem Projekt schon einmal etwas gescheitert. docs/CONSTITUTION.md
Regel 6 haelt fest, dass zweimal komplett erfundene "verifizierte" Fakten entstanden sind
("Assets seien Klartext", "XTEA, Round-Trip-bewiesen, 52 PNGs"). Formal waren beide
tadellos. Nur das Dateisystem konnte sie widerlegen.

Dieses Werkzeug prueft darum, was allein das Dateisystem beantwortet:

  1. Existiert die Datei, auf die der Beleg zeigt?
  2. Kommt der Anker in dieser Datei ueberhaupt vor?
  3. Kommt er GENAU EINMAL vor? Ein mehrdeutiger Anker benennt keine Stelle.

Punkt 3 ist keine Erfindung dieser Kette. re/tools/anker_check.py und die 23
Mutationssuiten fahren dieselbe Regel: ein Anker ist ein woertliches Stueck der Zieldatei,
das genau einmal vorkommt, sonst bricht mutiere() mit ANKER-FEHLER ab.

BLINDHEIT, DIE HIER AUSDRUECKLICH GENANNT WIRD: docs/CONSTITUTION.md Regel 10 -- der
Smali-Baum steht unter .gitignore. Dieses Werkzeug oeffnet Dateien direkt ueber ihren Pfad
und ist von der Gitignore-Blindheit des Grep-Werkzeugs NICHT betroffen. Wer denselben
Befund mit einem gitignore-achtenden Sucher gegenprueft, bekommt 0 Treffer und darf daraus
nichts schliessen.

Aufruf: python -u tools/beleg_pruefen.py [--selbsttest]
Exit:   0 = jeder Beleg zeigt auf etwas Existierendes und Eindeutiges
"""
import io
import os
import re
import sqlite3
import sys
# ---------------------------------------------------------------- AUSGABEKODIERUNG
# GEMESSEN AM 2026-09-09 in klarzeit: die Abnahme brach mit
#   UnicodeEncodeError: 'charmap' codec can't encode character '*'
# ab, weil ein Anker ein Sonderzeichen trug und Windows stdout nach cp1252 kodiert.
# Das Werkzeug lief NICHT durch -- und ein abgestuerzter Lauf sieht aus wie eine
# nicht bestandene Abnahme, obwohl er gar nicht geurteilt hat.
# Ein Pruefgeraet darf nicht an dem scheitern, was es pruefen soll.
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

HIER = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HIER)
sys.path.insert(0, HIER)
DB = os.path.join(HIER, 'tracking.db')

BYTEFOLGE = re.compile(r'^(?:[0-9a-fA-F]{2} )+[0-9a-fA-F]{2}$')


def vorkommen(pfad_abs, anker):
    """Wie oft kommt der Anker in der Datei vor? Rueckgabe (anzahl, wie).

    'wie' ist 'text', 'byte' oder 'fehlt' -- damit im Bericht steht, WORAUF der Treffer
    beruht. Eine Bytefolge, die nur als Text vorkaeme, waere ein Zufall.

    Die Assets unter re/assets_dec/ sind zum grossen Teil binaer; die Dekodierung nach
    latin-1 ist darum kein Notbehelf, sondern der Normalfall fuer S2-Belege.
    """
    roh = open(pfad_abs, 'rb').read()
    if BYTEFOLGE.match(anker.strip()):
        n = roh.count(bytes.fromhex(anker.replace(' ', '')))
        if n:
            return n, 'byte'
    try:
        txt = roh.decode('utf-8')
    except UnicodeDecodeError:
        txt = roh.decode('latin-1')
    n = txt.count(anker)
    if n:
        return n, 'text'
    return 0, 'fehlt'


def pruefen(db_pfad, basis=None, still=False):
    """Jeden Beleg der DB gegen das Dateisystem. Rueckgabe: Liste der Befunde."""
    if basis is None:
        basis = REPO
    con = sqlite3.connect(db_pfad)
    belege = list(con.execute(
        "SELECT 'quellbeleg', id, rang, pfad, anker FROM quellbeleg"
        " UNION ALL SELECT 'laufzeitbeleg', id, rang, pfad, anker FROM laufzeitbeleg"))
    con.close()

    fehler = []
    for tab, bid, rang, pfad, anker in belege:
        abs_pfad = os.path.join(basis, pfad.replace('/', os.sep).replace('\\', os.sep))
        if not os.path.isfile(abs_pfad):
            fehler.append('%s #%d (%s): Datei gibt es nicht -- %s' % (tab, bid, rang, pfad))
            continue
        n, wie = vorkommen(abs_pfad, anker)
        if n == 0:
            fehler.append('%s #%d (%s): Anker kommt in %s NICHT vor -- %r'
                          % (tab, bid, rang, pfad, anker[:48]))
        elif n > 1:
            fehler.append('%s #%d (%s): Anker kommt in %s %d mal vor, verlangt ist genau '
                          'einmal -- %r' % (tab, bid, rang, pfad, n, anker[:48]))
        elif not still:
            print('  [ok] %-14s #%-3d %-3s %-40s %s (%s)'
                  % (tab, bid, rang, pfad[:40], anker[:30], wie))
    return fehler


def selbsttest():
    """Kann dieses Werkzeug ueberhaupt rot werden? Drei Negativ-, eine Positivkontrolle.

    Die Probedateien werden angelegt, nicht gesucht: der Selbsttest misst das WERKZEUG,
    nicht den Projektzustand. Haenge er an einer echten Repo-Datei, wuerde er mitwandern.
    """
    import shutil
    import tempfile
    schema = io.open(os.path.join(HIER, 'tracker_schema.sql'), encoding='utf-8').read()
    basis = tempfile.mkdtemp(prefix='beleg_selbsttest_')
    fehler = 0
    try:
        # Pfad, Rang und Bytefolge kommen aus dem Profil. Fest verdrahtet ('S3',
        # 're/jadx/...') brach dieser Selbsttest unter jedem anderen Profil am
        # rang-CHECK ab -- und der Abbruch sah aus wie ein Datenfehler des Projekts,
        # war aber einer des Werkzeugs.
        import profil
        rang = profil.BELEG_PROBE_RANG
        rel = profil.BELEG_PROBE_PFAD                 # z. B. 'books/md/GD00_probe.md'
        binrel = profil.BELEG_PROBE_BINPFAD           # oder None
        ziel = os.path.join(basis, *os.path.dirname(rel).split('/'))
        os.makedirs(ziel, exist_ok=True)
        with io.open(os.path.join(basis, *rel.split('/')), 'w', encoding='utf-8') as fh:
            fh.write('EINMALIG_ANKER\nDOPPELT_ANKER\nDOPPELT_ANKER\n')
        if binrel:
            os.makedirs(os.path.join(basis, *os.path.dirname(binrel).split('/')),
                        exist_ok=True)
            open(os.path.join(basis, *binrel.split('/')), 'wb').write(
                bytes([0x00, 0x26, 0x26, 0x00, 0x04, 0xff, 0xfe]))

        pfad_db = os.path.join(basis, 'probe.db')
        con = sqlite3.connect(pfad_db)
        con.executescript(schema)
        con.execute('PRAGMA foreign_keys = ON')
        # N1 erfundene Datei | N2 Anker kommt nicht vor | N3 Anker mehrdeutig
        # P1 gueltiger Textanker | P2 gueltige Bytefolge
        con.execute("INSERT INTO quellbeleg(rang,pfad,anker) VALUES (?,?,?)",
                    (rang, rel + '.gibt_es_nicht', 'EINMALIG_ANKER'))
        con.execute("INSERT INTO quellbeleg(rang,pfad,anker) VALUES (?,?,?)",
                    (rang, rel, 'STEHT_DA_NICHT_DRIN'))
        con.execute("INSERT INTO quellbeleg(rang,pfad,anker) VALUES (?,?,?)",
                    (rang, rel, 'DOPPELT_ANKER'))
        con.execute("INSERT INTO quellbeleg(rang,pfad,anker) VALUES (?,?,?)",
                    (rang, rel, 'EINMALIG_ANKER'))
        if binrel:
            con.execute("INSERT INTO quellbeleg(rang,pfad,anker) VALUES (?,?,?)",
                        (rang, binrel, '26 26 00 04'))
        con.commit()
        con.close()

        f = pruefen(pfad_db, basis=basis, still=True)

        print('== SELBSTTEST ==')
        erwartet = [('Datei gibt es nicht', 'erfundene Datei'),
                    ('NICHT vor', 'Anker steht nicht drin'),
                    ('mal vor', 'Anker ist mehrdeutig')]
        for muster, titel in erwartet:
            traf = [x for x in f if muster in x]
            ok = len(traf) == 1
            print('  [%s] Negativkontrolle %-24s -> %s'
                  % ('ok' if ok else 'FEHLER', titel,
                     traf[0][:70] if traf else 'NICHT ERKANNT'))
            if not ok:
                fehler += 1
        ok = len(f) == 3
        print('  [%s] Positivkontrolle: die zwei gueltigen Belege (Text und Bytefolge) '
              'werden NICHT gemeldet -- %d Befunde statt 3'
              % ('ok' if ok else 'FEHLER', len(f)))
        if not ok:
            fehler += 1
        # Kontrolle am Werkzeug: erkennt vorkommen() die Bytefolge auch WIRKLICH als
        # Bytefolge, oder hat sie nur zufaellig als Text getroffen?
        if binrel:
            n, wie = vorkommen(os.path.join(basis, *binrel.split('/')), '26 26 00 04')
            ok = (n == 1 and wie == 'byte')
            print('  [%s] Kontrolle am Werkzeug: die Bytefolge trifft als BYTE, nicht als '
                  'Text -- %d Treffer, Art %r' % ('ok' if ok else 'FEHLER', n, wie))
            if not ok:
                fehler += 1
        else:
            # Ausgesprochen, nicht uebersprungen: dieses Profil kennt keine binaeren
            # Belege, also wurde die Byte-Erkennung hier NICHT geprueft.
            print('  [i] Dieses Profil hat keinen binaeren Beleg (BELEG_PROBE_BINPFAD '
                  'ist None) -- die Byte-Erkennung ist damit UNGEPRUEFT.')
    finally:
        shutil.rmtree(basis, ignore_errors=True)
    return fehler


def main():
    # Kontrolle am Werkzeug: rein ASCII, sonst faellt der Lauf auf einer cp1252-Konsole
    # mit Exit 1, obwohl jeder Beleg haelt.
    eigen = io.open(os.path.abspath(__file__), encoding='utf-8').read()
    schlimm = sorted({ord(c) for c in eigen if ord(c) > 127})
    if schlimm:
        print('ABBRUCH: diese Datei ist nicht rein ASCII: %s' % [hex(o) for o in schlimm])
        return 1

    if '--selbsttest' in sys.argv:
        n = selbsttest()
        print()
        print('SELBSTTEST: %s' % ('bestanden' if not n else '%d FEHLER' % n))
        return 1 if n else 0

    if not os.path.isfile(DB):
        print('tools/tracking.db fehlt -- erst tools/tracker_init.py fahren.')
        return 1
    n = selbsttest()
    if n:
        print()
        print('ABBRUCH: der Selbsttest ist rot -- dieses Werkzeug prueft gerade nichts.')
        return 1

    # Vor allem anderen: zeigt ueberhaupt jeder Beleg-Zeiger auf eine vorhandene Zeile?
    # PRAGMA foreign_keys ist per Vorgabe AUS, und jedes Werkzeug, das die Datei ohne
    # dieses PRAGMA oeffnet, kann einen Befund mit laufzeitbeleg_id = 4711 einfuegen.
    # v_stand meldete im Vorbild danach "beobachtet [x] = 1", waehrend die Belegtabelle
    # leer war. foreign_key_check sieht genau das.
    print()
    print('== ZEIGER: geht jeder Beleg-Verweis auf eine vorhandene Zeile? ==')
    con = sqlite3.connect(DB)
    verl = con.execute('PRAGMA foreign_key_check').fetchall()
    con.close()
    print('  [%s] PRAGMA foreign_key_check: %d Verletzung(en)%s'
          % ('ok' if not verl else 'FEHLER', len(verl),
             '' if not verl else ' ' + repr(verl[:4])))

    print()
    print('== BELEGE GEGEN DAS DATEISYSTEM ==')
    fehler = pruefen(DB)
    fehler += ['Befund verweist auf eine Belegzeile, die es nicht gibt: %r' % (v,)
               for v in verl]
    print()
    if fehler:
        print('ERGEBNIS: %d Beleg(e) zeigen ins Leere oder sind mehrdeutig:' % len(fehler))
        for f in fehler:
            print('  %s' % f)
        return 1
    print('ERGEBNIS: jeder Beleg zeigt auf eine existierende Datei und kommt dort genau')
    print('          einmal vor. Das heisst NICHT, dass die Aussage darueber wahr ist.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
