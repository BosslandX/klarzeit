#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""blindbaum.py -- Fingerabdruck der Baeume, die 'git status' NICHT sieht.

WOGEGEN DAS GEBAUT IST, gemessen am 2026-09-06:

  97 der 168 GDScript-Dateien unter port/ tragen einen HARTKODIERTEN absoluten Pfad
  (`const OUT := "C:/gamedev/grandprix/re/_verify/..."`), und 20 der 166 Werkzeuge unter
  re/tools/ ebenso. Sie schreiben damit aus JEDEM Arbeitsort in das Hauptrepo -- ein
  git-Worktree isoliert sie nicht.

  Und ihr Ziel `re/_verify/` steht unter .gitignore (.gitignore:27). Ein Fingerabdruck aus
  `git status --porcelain` ist dort also BLIND: er meldet "sauber", waehrend 182.000
  Dateien danebenliegen und gerade eine davon ueberschrieben wurde.

  Ein SHA-256 ueber diese Baeume waere die genaue Antwort, kostet aber laut
  docs/DECODE_S225.md ueber 18 Minuten. Gemessen wird darum Dateizahl, Gesamtgroesse und
  die juengste Aenderungszeit -- 5,4 s fuer 919 MB. Das ist kein Beweis der
  Unveraendertheit, sondern ein Anzeiger fuer Veraenderung, und genau so wird es unten
  auch benannt.

DIE ZWEI LUECKEN, gefunden am 2026-09-07, mit Positiv-Kontrolle belegt:

  Die Zahl "97" oben zaehlt DATEIEN, nicht PFADE. Nachgemessen sind es 245 Vorkommen eines
  Absolutpfads in diesen 97 Dateien, und nur 196 davon zeigen auf re/_verify:

      re/_verify      196
      re/assets_dec    44      <- gemessen
      re/saves          4      <- war NICHT gemessen
      re/m1_capture     1      <- war NICHT gemessen  (re/m1_capture.jsonl)

  re/saves/ hat eine EIGENE .gitignore ("*.dec", "*.png"), re/m1_capture.jsonl steht in
  .gitignore:48. Positiv-Kontrolle: eine angelegte Datei re/saves/_probe_blindfleck.dec
  erschien WEDER in 'git status --porcelain' NOCH in diesem Fingerabdruck. Beide Pfade
  stehen deshalb jetzt in BAEUME; die Ausgabe hat seither ACHT Zeilen statt sechs.

GRENZE, ausdruecklich: wer eine Datei durch eine gleich grosse ersetzt UND die mtime
zuruecksetzt, wird hiervon nicht gesehen. Dagegen hilft nur der teure Hash. Fuer den Zweck
-- "hat der Lauf ausserhalb seines Arbeitsorts geschrieben" -- reicht der Anzeiger, weil
ein schreibender Prozess die mtime setzt.

ZWEITE GRENZE, ebenso ausdruecklich: BAEUME ist eine Liste, die jemand gepflegt hat. Sie
ist so vollstaendig wie die letzte Erhebung der Absolutpfade -- nicht vollstaendiger.

HERKUNFT: C:/gamedev/composer-kit/kern/blindbaum.py, uebernommen aus
C:/gamedev/grandprix/tools/blindbaum.py (Stand 2026-09-09). Einzige Aenderung: BAEUME
ist ein Platzhalter, den die Installation fuellt. Die Beispiele im Kopftext bleiben
als grandprix-Messung stehen -- sie sind DORT gemessen und gelten hier nicht.

Aufruf: python -u tools/blindbaum.py [--json] [--selbsttest]
Exit:   0
"""
import io
import json
import os
import sys
import time
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

# Die Baeume, die git nicht sieht UND in die nachweislich geschrieben wird.
# re/decompiled/ steht hier NICHT: es ist versioniert, git status sieht es.
BAEUME = [
    'node_modules',
    'dist',
    'docs',
    '.serena',
    'android/app/build',
    'auftraege/_probe',
]


def messen(wurzel):
    """(anzahl, bytes, juengste_mtime) fuer einen Baum ODER eine einzelne Datei.

    Fehlt der Pfad, (-1, -1, -1) -- ausdruecklich nicht (0, 0, 0): sonst waere
    "geloescht" von "leer" nicht zu unterscheiden.
    """
    if os.path.isfile(wurzel):
        try:
            st = os.stat(wurzel)
        except OSError:
            return (-1, -1, -1)
        return (1, st.st_size, st.st_mtime)
    if not os.path.isdir(wurzel):
        return (-1, -1, -1)
    n = 0
    b = 0
    mx = 0.0
    for r, d, f in os.walk(wurzel):
        for x in f:
            p = os.path.join(r, x)
            try:
                st = os.stat(p)
            except OSError:
                continue
            n += 1
            b += st.st_size
            if st.st_mtime > mx:
                mx = st.st_mtime
    return (n, b, mx)


def abdruck(basis=None):
    """Der ganze Fingerabdruck als Liste von Zeilen (Baum, n, bytes, mtime)."""
    if basis is None:
        basis = REPO
    aus = []
    for rel in BAEUME:
        n, b, mx = messen(os.path.join(basis, rel.replace('/', os.sep)))
        aus.append({'baum': rel, 'dateien': n, 'bytes': b, 'mtime': round(mx, 3)})
    return aus


def als_text(zeilen):
    """Eine Zeile je Baum, stabil sortiert. Genau das vergleicht tools/auftrag.ps1."""
    return '\n'.join('%s|%d|%d|%.3f' % (z['baum'], z['dateien'], z['bytes'], z['mtime'])
                     for z in zeilen)


def selbsttest():
    """Zwei Kontrollen, ohne die dieser Fingerabdruck nichts wert waere.

    NULL-DIFF : zweimal derselbe unveraenderte Stand MUSS dasselbe liefern. Streut er,
                misst jeder Vorher/Nachher-Vergleich Rauschen statt Wirkung.
    POSITIV   : eine einzige neue Datei MUSS den Abdruck bewegen. Tut sie es nicht,
                meldet der Fingerabdruck "nichts passiert", waehrend geschrieben wurde.
    """
    import shutil
    import tempfile
    fehler = 0
    print('== SELBSTTEST ==')
    basis = tempfile.mkdtemp(prefix='blindbaum_')
    try:
        ziel = os.path.join(basis, 're', '_verify')
        os.makedirs(ziel)
        with io.open(os.path.join(ziel, 'a.txt'), 'w', encoding='utf-8') as fh:
            fh.write('eins\n')

        a = als_text(abdruck(basis))
        b = als_text(abdruck(basis))
        ok = (a == b)
        print('  [%s] Null-Diff: zweimal derselbe Stand liefert dasselbe -- %s'
              % ('ok' if ok else 'FEHLER', 'ja' if ok else 'ES STREUT:\n%s\n%s' % (a, b)))
        if not ok:
            fehler += 1

        # Positiv-Kontrolle 1: eine neue Datei.
        time.sleep(0.01)
        with io.open(os.path.join(ziel, 'b.txt'), 'w', encoding='utf-8') as fh:
            fh.write('zwei\n')
        c = als_text(abdruck(basis))
        ok = (c != a)
        print('  [%s] Positiv-Kontrolle: eine neue Datei bewegt den Abdruck -- %s'
              % ('ok' if ok else 'FEHLER', 'ja' if ok else 'NEIN, er ist blind'))
        if not ok:
            fehler += 1

        # Positiv-Kontrolle 2: eine GEAENDERTE Datei ohne Groessenaenderung. Das ist der
        # Fall, der einen reinen Zaehler taeuschen wuerde -- deshalb steckt die mtime im
        # Abdruck.
        time.sleep(0.01)
        with io.open(os.path.join(ziel, 'a.txt'), 'w', encoding='utf-8') as fh:
            fh.write('EINS\n')          # gleiche Laenge, anderer Inhalt
        d = als_text(abdruck(basis))
        ok = (d != c)
        print('  [%s] Positiv-Kontrolle: eine ueberschriebene Datei GLEICHER Groesse '
              'bewegt ihn -- %s' % ('ok' if ok else 'FEHLER',
                                    'ja, ueber die mtime' if ok else 'NEIN'))
        if not ok:
            fehler += 1

        # Negativ-Kontrolle: ein Baum, den es nicht gibt, wird als -1 gemeldet und nicht
        # als 0. Sonst waere "Verzeichnis geloescht" von "Verzeichnis leer" nicht zu
        # unterscheiden -- und genau diese Verwechslung hat in diesem Projekt schon
        # einmal ein "leeres" Verzeichnis mit 226 Dateien erzeugt.
        n, b_, mx = messen(os.path.join(basis, 'gibt', 'es', 'nicht'))
        ok = (n == -1)
        print('  [%s] Negativ-Kontrolle: ein fehlender Baum meldet -1, nicht 0 -- %s'
              % ('ok' if ok else 'FEHLER', n))
        if not ok:
            fehler += 1

        # Positiv-Kontrolle 3: eine EINZELNE Datei als Eintrag. Seit re/m1_capture.jsonl
        # in BAEUME steht, ist das ein eigener Zweig in messen() -- und ein Zweig ohne
        # Kontrolle ist eine Vermutung. Erwartet: (1, Groesse, mtime), nicht (-1,-1,-1).
        einzeln = os.path.join(basis, 'einzeln.jsonl')
        with io.open(einzeln, 'w', encoding='utf-8') as fh:
            fh.write('x' * 17)
        n, b_, mx = messen(einzeln)
        ok = (n == 1 and b_ == 17 and mx > 0)
        print('  [%s] Positiv-Kontrolle: eine einzelne DATEI wird gemessen -- %s'
              % ('ok' if ok else 'FEHLER', '(%d, %d Byte)' % (n, b_)))
        if not ok:
            fehler += 1

        # Negativ-Kontrolle dazu: dieselbe Datei geloescht MUSS wieder -1 melden. Ohne
        # diese Zeile wuerde ein messen(), das jede Datei mit (1,0,0) beantwortet, oben
        # durchfallen und hier trotzdem gruen aussehen.
        os.remove(einzeln)
        n, b_, mx = messen(einzeln)
        ok = (n == -1)
        print('  [%s] Negativ-Kontrolle: die geloeschte Datei meldet -1 -- %s'
              % ('ok' if ok else 'FEHLER', n))
        if not ok:
            fehler += 1
    finally:
        shutil.rmtree(basis, ignore_errors=True)
    print()
    print('SELBSTTEST: %s' % ('bestanden' if not fehler else '%d FEHLER' % fehler))
    return fehler


def main():
    eigen = io.open(os.path.abspath(__file__), encoding='utf-8').read()
    schlimm = sorted({ord(c) for c in eigen if ord(c) > 127})
    if schlimm:
        print('ABBRUCH: diese Datei ist nicht rein ASCII: %s' % [hex(o) for o in schlimm])
        return 1
    if '--selbsttest' in sys.argv:
        return 1 if selbsttest() else 0
    zeilen = abdruck()
    if '--json' in sys.argv:
        print(json.dumps(zeilen, indent=1))
    else:
        print(als_text(zeilen))
    return 0


if __name__ == '__main__':
    sys.exit(main())
