#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tracker_init.py -- baut tools/tracking.db aus Schema und Daten. Neu, jedes Mal.

DIE DB IST EIN ARTEFAKT, KEINE QUELLE. Quelle sind tools/tracker_schema.sql (Struktur)
und tools/tracker_daten.sql (Inhalt) -- beide versioniert, lesbar, diffbar. Eine binaere
SQLite-Datei im Repo waere im Merge unbrauchbar; sie unter .gitignore zu legen und
trotzdem als alleinigen Statustraeger zu benutzen, waere schlimmer. Hier gilt beides
nicht: gitignoriert UND nicht die Quelle.

VERHAELTNIS ZU docs/VERIFY_PROGRESS.md: das Dokument bleibt bis auf Weiteres SSOT im Sinn
von docs/CONSTITUTION.md Regel 5. Dieser Tracker traegt die Befunde, die ueber die
Auftragskette hereinkommen -- er startet leer und waechst je Auftrag. Es wird ausdruecklich
NICHTS aus VERIFY_PROGRESS.md hierher migriert; eine Zahl doppelt zu fuehren heisst, sie
zweimal falsch haben zu koennen.

Vor dem Schreiben laeuft die Probe. Ohne bestandene Probe entsteht keine DB.

Aufruf: python -u tools/tracker_init.py
Exit:   0 = DB gebaut und jede Selbstpruefung bestanden
"""
import io
import os
import sqlite3
import subprocess
import sys


HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HIER)
import profil                              # noqa: E402  bewusst nach sys.path
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
REPO = os.path.dirname(HIER)
SCHEMA = os.path.join(HIER, 'tracker_schema.sql')
DATEN = os.path.join(HIER, 'tracker_daten.sql')
PROBE = os.path.join(HIER, 'tracker_probe.py')
DB = os.path.join(HIER, 'tracking.db')


def main():
    eigen = io.open(os.path.abspath(__file__), encoding='utf-8').read()
    schlimm = sorted({ord(c) for c in eigen if ord(c) > 127})
    if schlimm:
        print('ABBRUCH: diese Datei ist nicht rein ASCII: %s' % [hex(o) for o in schlimm])
        return 1

    print('== 1. Probe fahren -- ohne bestandene Probe entsteht keine DB ==')
    if not os.path.isfile(PROBE):
        print('  ABBRUCH: tools/tracker_probe.py fehlt. Ein ungepruefter Tracker ist')
        print('           schlimmer als keiner, weil er wie ein gepruefter aussieht.')
        return 1
    r = subprocess.run([sys.executable, '-u', PROBE], capture_output=True, text=True,
                       encoding='utf-8', errors='replace',
                       env=dict(os.environ, PYTHONIOENCODING='utf-8'))
    letzte = [z for z in (r.stdout or '').strip().split('\n') if z.strip()][-2:]
    for z in letzte:
        print('  %s' % z)
    if r.returncode != 0:
        print('  ABBRUCH: die Probe ist rot (Exit %d).' % r.returncode)
        return 1

    print()
    print('== 2. tools/tracking.db neu bauen ==')
    if os.path.exists(DB):
        os.unlink(DB)
        print('  alte Datei entfernt')
    con = sqlite3.connect(DB)
    # Schema des Profils PLUS die Auftragstabelle. Ohne sie fehlte die einzige
    # Stelle, an der Auftragsstand und Befunde zusammenkommen.
    con.executescript(io.open(SCHEMA, encoding='utf-8').read())
    _zusatz = os.path.join(HIER, 'auftragstabelle.sql')
    if os.path.exists(_zusatz):
        con.executescript(io.open(_zusatz, encoding='utf-8').read())
    con.execute('PRAGMA foreign_keys = ON')
    if os.path.isfile(DATEN):
        con.executescript(io.open(DATEN, encoding='utf-8').read())
        con.execute('PRAGMA foreign_keys = ON')
        print('  Schema und Daten eingespielt')
    else:
        print('  Schema eingespielt; tools/tracker_daten.sql gibt es (noch) nicht --')
        print('  der Tracker ist leer. Das ist der vorgesehene Anfangszustand.')
    con.commit()

    print()
    print('== 3. Selbstpruefung der frischen DB ==')
    fehler = 0

    # (a) Fremdschluessel muessen aufgehen.
    verl = con.execute('PRAGMA foreign_key_check').fetchall()
    print('  [%s] foreign_key_check: %d Verletzung(en)'
          % ('ok' if not verl else 'FEHLER', len(verl)))
    fehler += len(verl)

    # (b) Integritaet der Datei.
    ok = con.execute('PRAGMA integrity_check').fetchone()[0]
    print('  [%s] integrity_check: %s' % ('ok' if ok == 'ok' else 'FEHLER', ok))
    if ok != 'ok':
        fehler += 1

    # (c) Das Vokabular ist vollstaendig und nicht mehr.
    n = con.execute('SELECT COUNT(*) FROM marker').fetchone()[0]
    print('  [%s] genau fuenf Marker (CONSTITUTION Regel 1): %d'
          % ('ok' if n == 5 else 'FEHLER', n))
    if n != 5:
        fehler += 1
    n = con.execute("SELECT COUNT(*) FROM rang WHERE taugt_als_beleg=1").fetchone()[0]
    print('  [%s] sechs taugliche Raenge, S4 nicht darunter: %d'
          % ('ok' if n == 6 else 'FEHLER', n))
    if n != 6:
        fehler += 1

    # (d) Der Summenwaechter.
    for liste, zeilen, eimer, versch in con.execute('SELECT * FROM v_summenprobe'):
        gut = (zeilen == eimer == versch)
        print('  [%s] %-20s zeilen=%d eingeordnet=%d verschieden=%d'
              % ('ok' if gut else 'FEHLER', liste, zeilen, eimer, versch))
        if not gut:
            fehler += 1

    # (e) Kein [x] ohne den Beleg, den seine Achse verlangt. Das prueft schon der CHECK --
    #     hier noch einmal als Abfrage, weil ein CHECK nur beim Schreiben greift und eine
    #     Datei auch anders entstehen kann.
    n = con.execute("""SELECT COUNT(*) FROM befund WHERE marker='[x]' AND (
                         %s)""" % profil.BELEGPFLICHT_SQL).fetchone()[0]
    print('  [%s] [x] ohne den von seiner Achse verlangten Beleg: %d'
          % ('ok' if not n else 'FEHLER', n))
    fehler += n

    # (f) Kein Beleg vom Rang S4, und keiner, der in den 1.5.4-Altbaum zeigt.
    # Welche Raenge und Pfade hier NICHT stehen duerfen, weiss nur das Profil.
    n = con.execute("""SELECT COUNT(*) FROM (
                         SELECT rang,pfad FROM quellbeleg
                         UNION ALL SELECT rang,pfad FROM laufzeitbeleg)
                       WHERE %s""" % profil.KEIN_BELEG_SQL).fetchone()[0]
    print('  [%s] Belege vom Rang S4 oder aus dem 1.5.4-Altbaum: %d'
          % ('ok' if not n else 'FEHLER', n))
    fehler += n

    print()
    print('== 4. Stand ==')
    zeilen = list(con.execute('SELECT * FROM v_stand ORDER BY achse, marker'))
    if not zeilen:
        print('  (kein Befund -- der Tracker ist leer)')
    for achse, mk, n in zeilen:
        print('  %-12s %-4s %d' % (achse, mk, n))
    meta = list(con.execute('SELECT key, value FROM project_info ORDER BY key'))
    if meta:
        print()
        for k, v in meta:
            print('  %-22s %s' % (k, v))

    con.close()
    print()
    if fehler:
        print('ERGEBNIS: %d Fehler -- die DB ist nicht brauchbar.' % fehler)
        return 1
    print('ERGEBNIS: tools/tracking.db gebaut, alle Selbstpruefungen bestanden.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
