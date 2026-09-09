# -*- coding: utf-8 -*-
"""Profil "code" -- Software, die gebaut, getestet und gemessen wird.

Fuer Projekte, deren Material Quellcode ist: fusball, shares, klarzeit, bibu.

Achsen: implementiert | getestet | gemessen
Raenge: C1 Codestelle - C2 Schnittstellenvertrag - C3 Fremdcode - C4 Vermutung (kein Beleg)
        L1 Testlauf mit Ausgabe - L2 Werkzeuglauf (tsc/lint/build) - L3 Einzelmessung

WAS DIE ACHSEN TRENNEN:
  implementiert -- der Code steht. Sagt NICHTS darueber, ob er tut, was er soll.
  getestet      -- ein Test faehrt darueber UND faellt ohne die Aenderung um. Ein Test,
                   der auch ohne sie gruen bleibt, deckt nichts ab; er meldet
                   "abgedeckt", wo nichts abgedeckt ist.
  gemessen      -- eine Zahl liegt vor, mit Positiv- UND Negativkontrolle und, bei jedem
                   Vorher/Nachher-Vergleich, einer Null-Diff-Kontrolle. Ein Werkzeug,
                   das durchlaeuft, hat nicht automatisch etwas gemessen.

★ NOCH NICHT AN EINEM ECHTEN LAUF ERPROBT. Der Selbsttest laeuft (er misst das Werkzeug),
  ein scharfer Auftrag in fusball/shares/klarzeit/bibu ist noch nicht gefahren.

★ WAS DIESEM PROFIL NOCH FEHLT und in hausverwaltung bereits gemessen wurde: die
  npm-Teile aus C:\\gamedev\\hausverwaltung\\tools\\auftrag.ps1 -- Workspace-Junctions
  unter node_modules, die 'git worktree remove' blockieren; Portvergabe je Auftragsnummer
  gegen kollidierende Container; der Selbsttest "darf ein Ausfuehrender 'npm run' fahren".
  Sie gehoeren beim ersten Code-Projekt hierher uebertragen, nicht neu erfunden.
"""
import io
import os
import tempfile

# Wohin der Ausfuehrende liefert. Der Selbsttest legt seine Probedateien dorthin --
# ein fester Pfad im Kern haette unter dem falschen Profil ins Leere gezeigt.
ERGEBNIS_PFAD = 'auftraege/_ergebnisse'

# (Stichwort in der Aussage, richtige Suchwurzel, zu hohe Wurzeln)
# Beispiel: node_modules und Build-Ausgaben stehen unter .gitignore. Wer von der
# Repo-Wurzel aus sucht und .gitignore achtet, findet dort nichts -- und meldet das
# als Ergebnis.
BLINDE_WURZELN = [
    ('node_modules', 'node_modules', ('.', 'repo', 'repo-root')),
    ('dist', 'dist', ('.', 'repo', 'repo-root')),
]


# Die zwei Abfragen, die tracker_init.py als Kontrolle faehrt. Sie nennen Achsen und
# Raenge und gehoeren darum hierher: fest verdrahtet brachen sie unter jedem anderen
# Profil mit 'no such column' ab -- und das sah wie ein Datenfehler aus.
#   BELEGPFLICHT_SQL  welche [x] ohne den von ihrer Achse verlangten Beleg dastehen
#   KEIN_BELEG_SQL    welche Belege gar keine sind (Rang ohne Belegkraft, gesperrte Baeume)
BELEGPFLICHT_SQL = """(achse='implementiert' AND quellbeleg_id IS NULL)
                      OR (achse='getestet'     AND laufzeitbeleg_id IS NULL)
                      OR (achse='gemessen'     AND (quellbeleg_id IS NULL
                                                  OR laufzeitbeleg_id IS NULL
                                                  OR ablage IS NULL))"""

KEIN_BELEG_SQL = """rang='C4'"""

# Die Probedatei des Selbsttests von beleg_pruefen.py. Sie wird ANGELEGT, nicht
# gesucht -- der Selbsttest misst das Werkzeug, nicht den Projektzustand.
# BELEG_PROBE_BINPFAD = None, wo es keine binaeren Belege gibt; dann entfaellt
# die Bytefolgen-Kontrolle und der Bericht sagt das.
BELEG_PROBE_RANG = 'C1'
BELEG_PROBE_PFAD = 'src/probe/index.ts'
BELEG_PROBE_BINPFAD = None

def muster():
    """Eine gueltige Lieferung. Jede Negativkontrolle des Selbsttests ist eine Mutation
    HIERVON -- damit sie genau eine Regel verletzt und nicht nebenbei drei andere."""
    return {
        'auftrag': 'AUF-000',
        'stand': {
            'head': 'f950e2e',
            'baum_sha256':
                'd6b1136be9f8ab53a46343135af0acc6d6db9999225def3267bc5086d8162139',
        },
        'nicht_erreicht': [],
        'befunde': [{
            'id': 'F1',
            'aussage': 'Die Probedatei traegt die Zeichenfolge EINMALIG_ANKER an einer Stelle.',
            'sicherheit': 'gelesen',
            'achse': 'implementiert',
            'marker_vorschlag': '[x]',
            'begruendung_marker': 'Quellbeleg liegt vor, die Aussage betrifft nur den Code.',
            'gegenstand': {'art': 'funktion', 'name': 'probeFunktion',
                           'werk': 'src/probe', 'stelle': 'probeFunktion'},
            'quellbeleg': {'rang': 'C1', 'pfad': 'src/probe/index.ts',
                           'anker': 'EINMALIG_ANKER', 'stelle': ':1'},
        }],
    }


def basis_bauen():
    """Ein Wegwerf-Repo mit Probedateien. Der Selbsttest haengt damit an KEINER Datei des
    echten Baums -- er misst das Werkzeug, nicht den Projektzustand.

    PFLICHT (der Kern verlaesst sich darauf):
      - die Datei aus muster()['befunde'][0]['quellbeleg']['pfad'] existiert,
      - sie traegt den Anker des Musters GENAU EINMAL,
      - sie traegt 'DOPPELT_ANKER' GENAU ZWEIMAL,
      - sie traegt 'STEHT_DA_NICHT_DRIN' NICHT.
    """
    basis = tempfile.mkdtemp(prefix='abnahme_selbsttest_code_')
    ziel = os.path.join(basis, 'src', 'probe')
    os.makedirs(ziel)
    with io.open(os.path.join(ziel, 'index.ts'), 'w', encoding='utf-8') as fh:
        fh.write('EINMALIG_ANKER\nDOPPELT_ANKER\nDOPPELT_ANKER\n')
    os.makedirs(os.path.join(basis, 'auftraege', '_ergebnisse'))
    with io.open(os.path.join(basis, 'auftraege', '_ergebnisse', 'probe.txt'), 'w',
                 encoding='utf-8') as fh:
        fh.write('LAUF_ANKER\n')
    return basis


def selbsttest_faelle(b0):
    """Die Negativkontrollen der Stufe 3 -- was die CHECK-Constraints dieses Schemas
    abweisen muessen. (titel, aenderungsfunktion, erwarteter Textteil im Befund)"""
    return [
        ('[x] implementiert ohne Quellbeleg',
         lambda l: b0(l).pop('quellbeleg'), 'weist ihn ab'),
        ('[x] getestet ohne Testlauf -- "der Code steht" ist nicht "der Test faellt ohne ihn um"',
         lambda l: b0(l).update({'achse': 'getestet'}), 'weist ihn ab'),
        ('[x] gemessen ohne Werkzeuglauf und ohne ablage',
         lambda l: b0(l).update({'achse': 'gemessen'}), 'weist ihn ab'),
        ('nackte Stellenangabe als Anker (":183" ohne Wortlaut)',
         lambda l: b0(l)['quellbeleg'].update({'anker': 'Zeile 183'}), 'weist ihn ab'),
        ('C4 als Quellbeleg -- eine Vermutung ist kein Beleg',
         lambda l: b0(l)['quellbeleg'].update({'rang': 'C4'}), 'weist ihn ab'),
        ('Funktion ohne Modul -- eine Stelle ohne ihr Werk ist kein Ort',
         lambda l: b0(l)['gegenstand'].pop('werk'), 'weist ihn ab'),
    ]
