#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""abnahme.py -- prueft die Lieferung eines Ausfuehrenden, BEVOR sie irgendwo einwandert.

WARUM ES DAS GIBT: ein Agentenbericht ist eine Hypothese, kein Beleg. Dieses Werkzeug
prueft nicht die Zuversicht des Berichts, sondern vier Dinge, die eine Maschine
beantworten kann:

  STUFE 1  FORM        -- Pflichtfelder, Enums, bedingte Pflichten: [?] braucht blockade,
                          [!] braucht widerspruch_zu, "gemessen" braucht Befehl UND
                          Ausgabe, ein Laufzeitbeleg braucht beide Kontrollen.
  STUFE 2  WORTE       -- Vollstaendigkeitsaussagen ohne gezaehlte Grundgesamtheit, und
                          Nullaussagen ohne Positiv-Kontrolle. DAS IST DIE STUFE, DIE ES
                          IM VORBILD NICHT GIBT, und sie steht hier, weil dieses Projekt
                          sie gemessen gebraucht hat -- siehe unten.
  STUFE 3  VERFASSUNG  -- die Lieferung wird probeweise in eine WEGWERF-Datenbank aus
                          tools/tracker_schema.sql eingespielt. Was dort nicht durchkommt,
                          kommt auch in den Tracker nicht.
                          *** Das ist der Kern: die Verfassung steht an genau EINER Stelle.
                          Ein hier nachgebauter zweiter Satz Regeln wuerde frueher oder
                          spaeter vom ersten abweichen -- und dann waere unklar, welcher gilt.
  STUFE 4  BELEGE      -- existiert die Datei, kommt der Anker darin GENAU EINMAL vor.
                          Dieselbe Logik wie tools/beleg_pruefen.py, eine Stufe frueher.
                          vorkommen() wird von dort IMPORTIERT, nicht kopiert.
  STUFE 5  BEFEHLE     -- der befehl wird GEFAHREN, nicht angesehen (--befehle). Exit != 0
                          ist ein Befund, und ein grundgesamtheit.befehl, dessen Ausgabe
                          die eigene anzahl nicht traegt, auch.

JEDE STUFE NENNT IHRE PRUEFMENGE. Eine Allaussage ueber die leere Menge ist trivial wahr:
  Stufe 4 meldete bei AUF-003 "jeder Beleg zeigt auf etwas Existierendes" -- ueber NULL
  Belege. Seit S233 sagt jede Stufe, wie viele Gegenstaende sie vor sich hatte, und die
  leere Menge wird beim Namen genannt. docs/PROZESS_AUFTRAGSKETTE.md Abschnitt 7.

WARUM STUFE 2 (die Worte):
  docs/CONSTITUTION.md Regel 10 haelt fest, dass eine Suche mit falscher Wurzel im
  gitignorierten Smali-Baum 0 Treffer meldet -- und dass eine Allaussage mit falscher
  Wurzel "nicht falsch begruendet, sondern gar nicht begruendet" ist. Dieselbe Regel
  verlangt eine Positiv-Kontrolle mit bekanntem Treffer VOR jeder Nullaussage.
  Dazu kommt die Erfahrung des Vorbilds: von 88 geprueften Ankern hielten alle 88
  woertlich -- gefallen sind ausschliesslich Vollstaendigkeitsaussagen. Kein CHECK der
  Welt zaehlt eine Zahl nach, die in Prosa steht; darum diese Stufe.

WAS ES NICHT PRUEFT: ob eine Aussage WAHR ist. Ein formal tadelloser Befund kann falsch
sein. Die inhaltliche Nachmessung an der Quelle bleibt Sache des Orchestrators.

Aufruf: python -u tools/abnahme.py <lieferung.json> [--basis <verzeichnis>] [--befehle]
        python -u tools/abnahme.py --selbsttest
Exit:   0 = die Lieferung darf gelesen werden, 1 = Befunde (oder Selbsttest rot)
"""
import ast
import io
import json
import os
import re
import sqlite3
import sys
import tempfile

HIER = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HIER)
sys.path.insert(0, HIER)
from beleg_pruefen import vorkommen          # noqa: E402  bewusst nach sys.path

SCHEMA_SQL = os.path.join(HIER, 'tracker_schema.sql')
SCHEMA_JSON = os.path.join(HIER, 'lieferschema.json')

# ================= DAS PROFIL -- EINE QUELLE, NICHT ZWEI =================
# Achsen, Marker und Raenge standen im Vorbild ZWEIMAL: hier als Python-Tupel und im
# lieferschema.json als enum. Zwei Quellen fuer dieselbe Wahrheit koennen auseinander
# laufen, und die Pruefung haette dann gemeldet, was das Schema erlaubt -- oder
# umgekehrt. Sie werden darum AUS DEM SCHEMA gelesen.
_SCHEMA = json.load(io.open(SCHEMA_JSON, encoding='utf-8'))


def _enum(*pfad):
    """Ein enum aus dem Lieferschema holen.

    Fehlt es, ist das ein ABBRUCH und keine leere Menge: eine Pruefung gegen eine leere
    Erlaubnisliste laesst entweder alles durch oder weist alles ab -- beides sieht wie
    ein Ergebnis aus und ist keines.
    """
    o = _SCHEMA
    for k in pfad:
        if not isinstance(o, dict) or k not in o:
            raise SystemExit(
                'ABBRUCH: %s kennt den Pfad %s nicht. Ohne ihn wuesste die Formpruefung '
                'nicht, was erlaubt ist, und liefe trotzdem durch.'
                % (os.path.basename(SCHEMA_JSON), ' -> '.join(pfad)))
        o = o[k]
    werte = o.get('enum')
    if not werte:
        raise SystemExit('ABBRUCH: %s -> %s hat kein enum.'
                         % (os.path.basename(SCHEMA_JSON), ' -> '.join(pfad)))
    return tuple(werte)


ACHSEN = _enum('$defs', 'befund', 'properties', 'achse')
MARKER = _enum('$defs', 'befund', 'properties', 'marker_vorschlag')
SICHERHEIT = _enum('$defs', 'befund', 'properties', 'sicherheit')
S_RANG = _enum('$defs', 'quellbeleg', 'properties', 'rang')
L_RANG = _enum('$defs', 'laufzeitbeleg', 'properties', 'rang')

# Das Profil liefert, was sich nicht aus dem Schema ergibt: die Musterlieferung des
# Selbsttests, die Probedateien dazu, und wie ein Befund in die Datenbank kommt.
import profil                                   # noqa: E402  bewusst nach sys.path
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
# ==========================================================================

# Die vier Woerter des Vorbilds, um die deutschen Geschwister erweitert. Als Wortgrenzen
# gesucht, damit 'Allradantrieb' nicht als 'alle' zaehlt und 'keine' nicht in 'Keiner-Test'.
VOLLSTAENDIG = re.compile(
    r'(?<![\w])('
    r'alle|allen|aller|alles|saemtliche|saemtlichen|'
    r'nur|ausschliesslich|einzig|einzige|einzigen|'
    r'immer|stets|jede|jeder|jedes|jeden|'
    r'nie|niemals|kein|keine|keinen|keiner|keines|nirgends|nirgendwo'
    r')(?![\w])', re.IGNORECASE)

# Eine Nullaussage behauptet die Abwesenheit. Sie braucht zusaetzlich zur Grundgesamtheit
# eine Positiv-Kontrolle -- sonst ist "nichts gefunden" nicht von "nichts finden koennen"
# zu unterscheiden.
NULLAUSSAGE = re.compile(
    r'(?<![\w])(kein|keine|keinen|keiner|keines|nirgends|nirgendwo|'
    r'nie|niemals|null\s+treffer|0\s+treffer|nicht\s+vor|nicht\s+aufgerufen|'
    r'ohne\s+aufrufer|existiert\s+nicht)(?![\w])', re.IGNORECASE)


# ----------------------------------------------------------------- STUFE 1: FORM
def form_pruefen(lief):
    """Pflichtfelder, Enums, bedingte Pflichten. Meldet Klartext, keine Schema-Pfade."""
    f = []
    if not isinstance(lief, dict):
        return ['Lieferung ist kein JSON-Objekt, sondern %s' % type(lief).__name__]

    for feld in ('auftrag', 'stand', 'befunde', 'nicht_erreicht'):
        if feld not in lief:
            f.append('Pflichtfeld fehlt: %s' % feld)

    stand = lief.get('stand')
    if isinstance(stand, dict):
        # Pflichtfelder und Muster kommen AUS DEM SCHEMA -- so kann eine Aenderung dort
        # nicht an dieser Pruefung vorbeilaufen.
        _st = _SCHEMA['properties']['stand']
        for feld in _st.get('required', []):
            if not stand.get(feld):
                f.append('stand.%s fehlt -- der Ausfuehrende muss den Stand SELBST messen'
                         % feld)
        for feld, regel in (_st.get('properties') or {}).items():
            muster = regel.get('pattern')
            wert = stand.get(feld) or ''
            if muster and wert and not re.match(muster, wert):
                f.append('stand.%s entspricht nicht %s: %r' % (feld, muster, wert[:24]))
    elif 'stand' in lief:
        f.append('stand ist kein Objekt')

    if not isinstance(lief.get('nicht_erreicht', []), list):
        f.append('nicht_erreicht ist keine Liste')

    befunde = lief.get('befunde')
    if befunde is None:
        return f
    if not isinstance(befunde, list):
        return f + ['befunde ist keine Liste']

    gesehen = set()
    for i, b in enumerate(befunde):
        wo = 'befund[%d]' % i
        if not isinstance(b, dict):
            f.append('%s ist kein Objekt' % wo)
            continue
        wo = '%s (%s)' % (wo, b.get('id', 'ohne id'))

        for feld in ('id', 'aussage', 'sicherheit', 'achse',
                     'marker_vorschlag', 'begruendung_marker'):
            if not b.get(feld):
                f.append('%s: Pflichtfeld fehlt -- %s' % (wo, feld))

        bid = b.get('id')
        if bid:
            if bid in gesehen:
                f.append('%s: die id %r kommt zweimal vor' % (wo, bid))
            gesehen.add(bid)

        if b.get('achse') and b['achse'] not in ACHSEN:
            f.append('%s: achse %r ist keine der drei %s' % (wo, b['achse'], list(ACHSEN)))
        if b.get('marker_vorschlag') and b['marker_vorschlag'] not in MARKER:
            f.append('%s: marker_vorschlag %r ist keiner der erlaubten %s'
                     % (wo, b['marker_vorschlag'], list(MARKER)))
        if b.get('sicherheit') and b['sicherheit'] not in SICHERHEIT:
            f.append('%s: sicherheit %r ist keine der drei %s'
                     % (wo, b['sicherheit'], list(SICHERHEIT)))

        # Die bedingten Pflichten. Sie stehen zusaetzlich als CHECK in Stufe 3 -- hier
        # stehen sie, weil eine Meldung im Klartext dem Ausfuehrenden sagt, WAS fehlt.
        if b.get('marker_vorschlag') == '[?]' and not b.get('blockade'):
            f.append('%s: [?] ohne blockade. Ein Fragezeichen ohne Grund ist keine '
                     'Hypothese, sondern eine Luecke.' % wo)
        if b.get('marker_vorschlag') == '[!]' and not b.get('widerspruch_zu'):
            f.append('%s: [!] ohne widerspruch_zu. Ein Widerspruch muss sagen, wogegen.'
                     % wo)
        if b.get('sicherheit') == 'gemessen':
            for feld in ('befehl', 'ausgabe_auszug'):
                if not b.get(feld):
                    f.append('%s: sicherheit "gemessen", aber %s fehlt. Ein Werkzeug, das '
                             'durchlaeuft, hat nicht automatisch etwas gemessen.'
                             % (wo, feld))

        for name, erlaubt in (('quellbeleg', S_RANG), ('laufzeitbeleg', L_RANG)):
            bel = b.get(name)
            if bel is None:
                continue
            if not isinstance(bel, dict):
                f.append('%s: %s ist kein Objekt' % (wo, name))
                continue
            if bel.get('rang') not in erlaubt:
                f.append('%s: %s.rang %r -- erlaubt sind %s'
                         % (wo, name, bel.get('rang'), list(erlaubt)))
            for feld in ('pfad', 'anker'):
                if not bel.get(feld):
                    f.append('%s: %s.%s fehlt. Ein Beleg ist Pfad UND Anker.'
                             % (wo, name, feld))
            if name == 'laufzeitbeleg':
                for feld in ('positivkontrolle', 'negativkontrolle'):
                    if not bel.get(feld):
                        f.append('%s: laufzeitbeleg ohne %s. Ohne beide Kontrollen ist '
                                 '"nichts gefunden" nicht von "nichts finden koennen" zu '
                                 'unterscheiden.' % (wo, feld))
    return f


# Erste Woerter, die einen Befehl einleiten. Bewusst eine geschlossene Liste: sie darf
# waechst, wenn ein Auftrag ein neues Werkzeug braucht -- aber sie darf nicht durch eine
# Heuristik ersetzt werden, die jede Wortfolge mit einem Schraegstrich durchlaesst. Genau
# so kam 'AP-1 Write/Shell/Mcp-Protokoll' durch.
BEFEHLSWORTE = frozenset("""
python python3 py git grep rg find ls dir cat head tail wc sed awk sort uniq diff cut tr
xargs bash sh powershell pwsh cmd certutil node npm npx jq md5sum sha256sum openssl
for while if echo type printf test java jadx apktool adb frida godot curl file stat du
select-string get-content get-childitem get-filehash measure-object compare-object
""".split())

# Zeichen, die einen Aufruf verraten, auch wenn das erste Wort nicht in der Liste steht.
BEFEHLSZEICHEN = ('|', '&&', '2>&1', '$(', '`', ' -', ' --', ';')


def sieht_wie_befehl_aus(s):
    """Grobe, aber gerichtete Pruefung: Aufruf oder Prosa?

    Sie soll NICHT jede Zeichenkette mit Schraegstrich durchlassen -- das war der Fehler,
    der 'AP-1 Write/Shell/Mcp-Protokoll' als Befehl gelten liess.
    """
    s = s.strip()
    if not s:
        return False
    erst = s.split()[0].lower().strip('&"\'')
    erst = erst.rsplit('/', 1)[-1].rsplit('\\', 1)[-1]
    if erst in BEFEHLSWORTE:
        return True
    if erst.endswith(('.py', '.ps1', '.sh', '.exe', '.bat', '.cmd')):
        return True
    return any(z in s for z in BEFEHLSZEICHEN) and '/' in s + '\\'


def _norm(s):
    """Ein Bereich hat drei Schreibweisen (Backslash, Schraegstrich, Gross/Klein). Ohne
    Normalisierung waere 're\\smali\\smali' nicht dasselbe wie 're/smali/smali'."""
    return (s or '').replace('\\', '/').strip().strip('/').lower()


# Die zweite, staerkere Form der Bereichsgleichheit: die Kontrolle stammt aus DEMSELBEN
# Lauf. GEMESSEN AN AUF-006 F8, und es war ein FEHLALARM DER ERSTEN FASSUNG: seine
# Positivkontrolle lautet '27 Treffer im selben Lauf' -- bereichsgleich, aber ohne die
# Wurzel zu wiederholen. Eine Regel, die nur die Wortwahl prueft, faerbt die beste
# Kontrolle des ganzen Archivs rot.
SELBIGKEIT = re.compile(
    r'selb\w*\s+(?:lauf|durchlauf|befehl|aufruf|suchbereich|wurzel|menge|baum|erhebung)'
    r'|gleichen\s+(?:lauf|durchlauf|befehl|aufruf|suchbereich|wurzel|menge|baum)',
    re.IGNORECASE)


def nennt_bereich(text, wurzel):
    """Weist die Positivkontrolle denselben Suchbereich aus wie die Nullaussage?

    docs/PROZESS_AUFTRAGSKETTE.md Abschnitt 7 Folge 1. Zwei Formen gelten:
      (a) sie NENNT den Bereich -- voll ('re/smali/smali') oder ueber den letzten
          kennzeichnenden Abschnitt; ein Treffer wird ueblicherweise als 'b/b.smali:192'
          angegeben, nicht mit vorangestellter Wurzel.
      (b) sie sagt, dass sie aus DEMSELBEN Lauf/Befehl/Suchbereich stammt. Das ist die
          staerkere Form: gleicher Befehl statt gleicher Ort.

    *** WAS DAS NICHT LEISTET: es beweist nicht, dass die Kontrolle taugt -- eine
    angehaengte Wendung ist schnell geschrieben. Es schliesst nur den Fall, dass der
    Bereich UNGENANNT bleibt, und genau dort sass AUF-002 Fall 1: drei Indizes ueber die
    137er-Menge, in denen ein fremder Name nie stehen KANN, ohne dass das irgendwo stand.
    """
    t, w = _norm(text), _norm(wurzel)
    if not w:
        return False
    if SELBIGKEIT.search(text or ''):
        return True
    if w in t:
        return True
    teile = [x for x in w.split('/') if len(x) >= 3]
    return bool(teile) and teile[-1] in t


# ------------------------------------------------------------- STUFE 2: DIE WORTE
def worte_pruefen(lief):
    """Vollstaendigkeitsaussagen ohne Grundgesamtheit, Nullaussagen ohne Positivkontrolle.

    Diese Stufe hat das Vorbild nicht. Sie steht hier, weil docs/CONSTITUTION.md Regel 10
    genau das verlangt und weil die teuersten Fehler beider Projekte hier lagen: eine
    Aussage, die woertlich wahr und als Allaussage falsch war.
    """
    f = []
    for i, b in enumerate(lief.get('befunde') or []):
        if not isinstance(b, dict):
            continue
        wo = 'befund[%d] (%s)' % (i, b.get('id', 'ohne id'))
        aussage = b.get('aussage') or ''
        gg = b.get('grundgesamtheit')

        # ---- Regel 10 zuerst, und ausdruecklich UNABHAENGIG von den Vollstaendigkeits-
        # woertern. Eine zu hohe Grep-Wurzel vergiftet JEDE Aussage ueber den Smali-Baum,
        # nicht nur die Allaussagen: re/smali/ ist gitignoriert, eine Suche von 're' oder
        # vom Repo-Stamm aus findet dort nichts und meldet das als Ergebnis.
        # GEMESSEN am eigenen Selbsttest: in der ersten Fassung stand diese Pruefung
        # HINTER dem Vollstaendigkeits-Gate und lief bei einer Aussage ohne solches Wort
        # gar nicht an. Die Negativkontrolle hat es gemeldet.
        # ---- Ist eine grundgesamtheit DA, muss sie gueltig sein -- unabhaengig davon, ob
        # ein Vollstaendigkeitswort sie erzwungen hat. Wer sie mitliefert, gibt sie als
        # Beleg aus.
        # GEMESSEN AN AUF-000, UND ES IST DERSELBE STRUKTURFEHLER ZUM ZWEITEN MAL: diese
        # Pruefungen standen hinter dem Wort-Gate. F16 trug 'AP-1 Write/Shell/Mcp-Protokoll'
        # als Befehl und kam durch, weil seine Aussage ('gehalten 20 + gefallen 15 ... = 36')
        # kein Vollstaendigkeitswort enthaelt. Eine Bedingung hinter dem falschen Gate ist
        # keine Bedingung.
        if isinstance(gg, dict):
            for feld in ('menge', 'anzahl', 'befehl'):
                if gg.get(feld) in (None, ''):
                    f.append('%s: grundgesamtheit.%s fehlt. Eine Zahl ohne ihren Befehl '
                             'ist eine Behauptung.' % (wo, feld))
            bef = (gg.get('befehl') or '').strip()
            if bef and not sieht_wie_befehl_aus(bef):
                f.append('%s: grundgesamtheit.befehl sieht nicht wie ein Befehl aus, '
                         'sondern wie Prosa: %r. Eine Zahl ohne den Befehl, der sie '
                         'erzeugt hat, ist eine Behauptung.' % (wo, bef[:60]))

            # Verallgemeinert aus der Smali-Regel des Vorbilds: eine zu hohe Suchwurzel
            # vergiftet JEDE Aussage ueber einen gitignorierten Baum, nicht nur die
            # Allaussagen. Ein Sucher, der .gitignore achtet, findet dort nichts und
            # meldet das als Ergebnis. profil.BLINDE_WURZELN nennt je Baum das
            # Stichwort, die richtige Wurzel und die zu hohen.
            wurzel = _norm(gg.get('wurzel'))
            wo_gesucht = ' '.join((aussage, gg.get('menge') or '',
                                   gg.get('befehl') or '')).lower()
            for stichwort, richtig, zu_hoch in getattr(profil, 'BLINDE_WURZELN', ()):
                if stichwort.lower() in wo_gesucht and wurzel in tuple(zu_hoch) + ('', '.'):
                    f.append('%s: Aussage ueber %r mit der Wurzel %r. Dieser Baum ist '
                             'gitignoriert -- eine Suche von dort oben meldet 0 Treffer, '
                             'ohne gesucht zu haben. Die Wurzel ist %s.'
                             % (wo, stichwort, gg.get('wurzel') or '(fehlt)', richtig))

        # ---- Die NULLAUSSAGE zuerst, und ausdruecklich VOR dem Vollstaendigkeits-Gate.
        # GEMESSEN BEIM BAU VON S233 -- DERSELBE STRUKTURFEHLER ZUM DRITTEN MAL: diese
        # Pruefung stand hinter `if not woerter: continue`. Vier der Nullaussagen-Muster
        # ('0 treffer', 'nicht vor', 'nicht aufgerufen', 'ohne aufrufer', 'existiert nicht')
        # stehen in VOLLSTAENDIG gar nicht -- eine Aussage wie "Das Werkzeug hat 0 Treffer"
        # erreichte die Pruefung NIE. Eine Bedingung hinter dem falschen Gate ist keine
        # Bedingung; das steht schon zweimal weiter oben und war trotzdem wieder da.
        if NULLAUSSAGE.search(aussage):
            if not isinstance(gg, dict):
                f.append('%s: Nullaussage ohne grundgesamtheit. Wer die Abwesenheit '
                         'behauptet, muss sagen, WO er gesucht hat und WIE gross die '
                         'durchsuchte Menge war.' % wo)
            else:
                # docs/PROZESS_AUFTRAGSKETTE.md Abschnitt 7 Folge 1: "Zu jeder Nullaussage gehoert
                # der Suchbereich UND ein Positiv-Treffer aus DEMSELBEN Bereich."
                # Gemessen an AUF-002 Fall 1: die Negativkontrolle suchte einen erfundenen
                # Namen in drei Indizes, die alle auf die 137er-Menge indiziert sind. Ein
                # Name, der nicht dazugehoert, kann dort nie stehen -- die Kontrolle war
                # unabhaengig vom Baum immer gruen. Sichtbar geworden waere das nur, wenn
                # der Bereich HAETTE GENANNT werden muessen.
                if not gg.get('positivkontrolle'):
                    f.append('%s: Nullaussage ohne grundgesamtheit.positivkontrolle. '
                             'CONSTITUTION Regel 10: ein Nullergebnis ohne bekannten '
                             'Treffer belegt nur, dass nichts gefunden wurde -- nicht, '
                             'dass nichts da ist.' % wo)
                wz = (gg.get('wurzel') or '').strip()
                if not wz:
                    f.append('%s: Nullaussage ohne grundgesamtheit.wurzel. Ohne den '
                             'genannten Suchbereich ist nicht pruefbar, ob die '
                             'Positivkontrolle aus DEMSELBEN Bereich stammt -- und genau '
                             'daran ist AUF-002 Fall 1 vorbeigelaufen.' % wo)
                elif gg.get('positivkontrolle') and not nennt_bereich(
                        gg['positivkontrolle'], wz):
                    f.append('%s: die Positivkontrolle nennt den Suchbereich %r nicht. '
                             'Ein Treffer aus einem ANDEREN Bereich belegt nicht, dass '
                             'die Suche im gemeinten Bereich haette anschlagen koennen: '
                             '%r' % (wo, wz, (gg.get('positivkontrolle') or '')[:60]))

        # ---- Und jetzt die vier Woerter.
        woerter = sorted({m.group(1).lower() for m in VOLLSTAENDIG.finditer(aussage)})
        if not woerter:
            continue
        if not isinstance(gg, dict):
            f.append('%s: Vollstaendigkeitswort %s ohne grundgesamtheit. Wer "alle '
                     'Aufrufer" schreibt, muss alle gezaehlt haben -- mit dem Befehl, '
                     'der die Zahl erzeugt hat.' % (wo, woerter))
            continue
    return f


# ------------------------------------------------------- STUFE 3: DIE VERFASSUNG
def wegwerf_db():
    """Eine frische Datenbank aus dem Schema des Profils. Der Aufrufer loescht sie."""
    if not os.path.exists(SCHEMA_SQL):
        raise SystemExit('ABBRUCH: %s fehlt. Stufe 3 kann nichts einspielen und wuerde '
                         'stumm gruen bleiben.' % SCHEMA_SQL)
    schema = io.open(SCHEMA_SQL, encoding='utf-8').read()
    fd, pfad = tempfile.mkstemp(suffix='.abnahme.db')
    os.close(fd)
    os.unlink(pfad)
    con = sqlite3.connect(pfad)
    con.executescript(schema)
    # Ohne dieses PRAGMA sind die Fremdschluessel wirkungslos -- es gilt je VERBINDUNG.
    con.execute('PRAGMA foreign_keys = ON')
    return con, pfad


def verfassung_pruefen(lief):
    """Spielt jeden Befund probeweise ein. Jede abgewiesene Zeile ist ein Befund."""
    f = []
    con, pfad = wegwerf_db()
    try:
        for i, b in enumerate(lief.get('befunde') or []):
            if not isinstance(b, dict):
                continue
            wo = 'befund[%d] (%s)' % (i, b.get('id', 'ohne id'))
            try:
                g = b.get('gegenstand') or {}
                # WELCHE SPALTEN gegenstand hat, weiss nur das Schema des Profils.
                # Im Vorbild standen 'klasse' und 'methode' fest im INSERT; unter einem
                # Dokumentprofil (werk/stelle) brach das mit "table gegenstand has no
                # column" ab -- und das sah wie ein Befund ueber die LIEFERUNG aus,
                # war aber einer ueber das Werkzeug.
                spalten = [r[1] for r in con.execute('PRAGMA table_info(gegenstand)')
                           if r[1] != 'id']
                werte = {'art': g.get('art') or spalten and 'dokument',
                         'name': g.get('name') or ('Lieferung %s' % b.get('id', i))}
                for sp in spalten:
                    if sp not in werte:
                        werte[sp] = g.get(sp)
                nutz = [sp for sp in spalten if sp in werte]
                cur = con.execute(
                    'INSERT INTO gegenstand(%s) VALUES (%s)'
                    % (','.join(nutz), ','.join('?' * len(nutz))),
                    tuple(werte[sp] for sp in nutz))
                gid = cur.lastrowid

                qid = lid = None
                q = b.get('quellbeleg')
                if isinstance(q, dict):
                    qid = con.execute(
                        'INSERT INTO quellbeleg(rang,pfad,anker,stelle) VALUES (?,?,?,?)',
                        (q.get('rang'), q.get('pfad'), q.get('anker'),
                         q.get('stelle'))).lastrowid
                lz = b.get('laufzeitbeleg')
                if isinstance(lz, dict):
                    lid = con.execute(
                        'INSERT INTO laufzeitbeleg(rang,pfad,anker,stelle,positivkontrolle,'
                        'negativkontrolle,nulldiff) VALUES (?,?,?,?,?,?,?)',
                        (lz.get('rang'), lz.get('pfad'), lz.get('anker'), lz.get('stelle'),
                         lz.get('positivkontrolle'), lz.get('negativkontrolle'),
                         lz.get('nulldiff'))).lastrowid

                # Wie oben bei gegenstand: die Spalten kommen aus dem Schema des
                # Profils. Das Vorbild nannte 'impl_datei' fest; im Dokumentprofil heisst
                # dieselbe Rolle 'ablage'. Was hier nicht als Spalte existiert, wird
                # weggelassen -- der Kern kennt die Tabelle nicht.
                bspalten = [r[1] for r in con.execute('PRAGMA table_info(befund)')
                            if r[1] not in ('id', 'gegenstand_id')]
                bwerte = {'achse': b.get('achse'),
                          'marker': b.get('marker_vorschlag'),
                          'aussage': b.get('aussage'),
                          'quellbeleg_id': qid,
                          'laufzeitbeleg_id': lid,
                          'blockade': b.get('blockade'),
                          'widerspruch_zu': b.get('widerspruch_zu')}
                for sp in bspalten:
                    if sp not in bwerte:
                        bwerte[sp] = b.get(sp)
                bnutz = [sp for sp in bspalten if sp in bwerte]
                con.execute(
                    'INSERT INTO befund(gegenstand_id,%s) VALUES (?,%s)'
                    % (','.join(bnutz), ','.join('?' * len(bnutz))),
                    tuple([gid] + [bwerte[sp] for sp in bnutz]))
                con.commit()
            except sqlite3.Error as e:
                con.rollback()
                f.append('%s: die Verfassung weist ihn ab -- %s' % (wo, e))
    finally:
        con.close()
        if os.path.isfile(pfad):
            os.unlink(pfad)
    return f


# ----------------------------------------------------------- STUFE 4: DIE BELEGE
def belege_pruefen(lief, basis, still=False):
    """Zeigt jeder Beleg auf eine existierende Datei, und der Anker genau einmal hinein?"""
    f = []
    for i, b in enumerate(lief.get('befunde') or []):
        if not isinstance(b, dict):
            continue
        for name in ('quellbeleg', 'laufzeitbeleg'):
            bel = b.get(name)
            if not isinstance(bel, dict) or not bel.get('pfad') or not bel.get('anker'):
                continue
            wo = 'befund[%d] (%s) %s' % (i, b.get('id', 'ohne id'), name)
            rel = bel['pfad'].replace('/', os.sep).replace('\\', os.sep)
            abs_pfad = os.path.join(basis, rel)
            if not os.path.isfile(abs_pfad):
                f.append('%s: die Datei gibt es nicht -- %s' % (wo, bel['pfad']))
                continue
            n, wie = vorkommen(abs_pfad, bel['anker'])
            if n == 0:
                f.append('%s: der Anker kommt in %s NICHT vor -- %r'
                         % (wo, bel['pfad'], bel['anker'][:48]))
            elif n > 1:
                f.append('%s: der Anker kommt in %s %d mal vor, verlangt ist genau '
                         'einmal -- %r' % (wo, bel['pfad'], n, bel['anker'][:48]))
            elif not still:
                print('  [ok] %-40s %-34s %s (%s)'
                      % (wo[:40], bel['pfad'][:34], bel['anker'][:26], wie))
    return f


# ------------------------------------------- STUFE 5: DEN BEFEHL FAHREN, NICHT ANSEHEN
#
# docs/PROZESS_AUFTRAGSKETTE.md Abschnitt 7 Fall 3 und Folge 3. Die Formpruefung
# (sieht_wie_befehl_aus) unterscheidet Prosa von einem Aufruf -- mehr nicht. AUF-003
# lieferte 39x `python -c count` (wirft NameError, Exit 1) und 7x
# `python -c import json; print(1)` (gibt 1 aus, erhebt nichts). BEIDE bestehen die Form.
# Der Unterschied zwischen AUF-003 und AUF-004 war von Hand in zwei Sekunden gemessen.
#
# [!] WARUM NICHT VON SELBST: diese Stufe fuehrt Zeichenketten aus einer AGENTENLIEFERUNG
#     aus. Sie ist darum abgeschaltet und braucht --befehle. Der normale Lauf sagt dafuer
#     in JEDEM Fall, wie viele Befehle er NICHT gefahren hat -- die Luecke bleibt sichtbar,
#     statt hinter einer Vorgabe zu verschwinden.
# [!!] DIE SCHALE IST TEIL DES MESSWERTS, GEMESSEN BEIM BAU VON S233:
#      `ls re/tools/*.py | wc -l` liefert unter bash 166 und unter PowerShell 175 --
#      beide mit rc 0. Und `... .replace('\\','/') ...` in einem python -c laeuft unter
#      PowerShell durch (rc 0) und stirbt unter bash an einem SyntaxError, weil die
#      doppelten Anfuehrungszeichen den Backslash noch einmal aufloesen. Die erste Fassung
#      dieser Stufe fuhr alles durch bash und meldete AUF-006 F7/F8 als "Exit 1" -- das war
#      MEIN Messfehler, nicht ihr Fehler.
#      VORGABE IST DARUM PowerShell: unter ihr laufen die Ausfuehrenden dieser Kette
#      (tools/auftrag.ps1, die Shell-Rechte in .cursor/cli.json). bash nur dort, wo der
#      Befehl mit einem Werkzeug beginnt, das es nur dort gibt.
#      UND: jede Zeile sagt, WELCHE Schale gefahren hat. Eine Zahl ohne ihre Schale ist
#      keine Zahl.
POSIX_WORTE = frozenset('grep rg sed awk cat head tail wc sort uniq cut tr xargs '
                        'ls find diff md5sum sha256sum basename dirname test'.split())

BEFEHL_FRIST = 120


def _befehle_einsammeln(b):
    """Jeder Befehl eines Befundes: (Feldname, Befehl, Zahl-die-er-tragen-muss, Soll-Exit).

    DER SOLL-EXIT IST NEU (2026-09-22, klarzeit) UND STEHT OHNE ANGABE AUF 0.
    Grund: seit diese Kette Code-Auftraege faehrt, VERLANGT die Achse 'getestet' eine
    Negativkontrolle -- einen Testlauf, der rot wird, wenn man die Aenderung zurueckdreht.
    Dessen Exit 1 ist die Aussage selbst und kein Fehlschlag. Ohne dieses Feld meldet
    Stufe 5 jede solche Kontrolle als Befund; gemessen an AUF-003 waren das 6 von 8.
    Wer sich angewoehnt, das Rot dieser Stufe zu ueberstimmen, hat sie abgeschaltet.

    KEIN FREIBRIEF: der Soll-Exit wird VERGLICHEN, nicht geglaubt. Ein Befund, der 1
    ankuendigt und 0 bekommt, ist ebenso ein Befund -- die Negativkontrolle im Selbsttest
    weiter unten prueft genau das.
    """
    raus = []
    if not isinstance(b, dict):
        return raus

    def exit_soll(d):
        v = d.get('erwarteter_exit')
        return v if isinstance(v, int) and not isinstance(v, bool) else 0

    gg = b.get('grundgesamtheit')
    if isinstance(gg, dict) and (gg.get('befehl') or '').strip():
        raus.append(('grundgesamtheit.befehl', gg['befehl'].strip(), gg.get('anzahl'),
                     exit_soll(gg)))
    if (b.get('befehl') or '').strip():
        raus.append(('befehl', b['befehl'].strip(), None, exit_soll(b)))
    return raus


# [!!] UMGEBUNGSBEFUND, GEMESSEN BEIM BAU VON S233: 'bash' auf dem PATH dieser Maschine ist
#      C:\Windows\system32\bash.exe -- der WSL-Aufsatz OHNE installierte Distribution. Er
#      endet mit rc 1 und 'execvpe(/bin/bash) failed'. Die erste Fassung dieser Stufe hat
#      das nicht gemerkt: die NEGATIVkontrolle ('python -c count' muss rot werden) war
#      gruen -- aus dem WSL-Fehler, nicht aus dem NameError. Ein gruener Selbsttest aus dem
#      falschen Grund. Gefangen hat es allein die POSITIVkontrolle daneben.
#      Folge: die Schale wird nicht geraten, sondern PROBIERT.
BASH_KANDIDATEN = (r'C:\Program Files\Git\bin\bash.exe',
                   r'C:\Program Files\Git\usr\bin\bash.exe')
_BASH = []


def bash_pfad():
    """Eine bash, die nachweislich eine Schale IST -- nicht bloss eine Datei dieses Namens.

    Der Nachweis ist ein Echo: eine Schale, die 'BASH_LEBT' zurueckgibt, hat den Befehl
    ausgefuehrt. Der WSL-Aufsatz besteht diese Probe nicht. Ergebnis wird gemerkt, damit
    nicht jeder Befehl die Probe erneut faehrt.
    """
    import shutil
    import subprocess
    if _BASH:
        return _BASH[0]
    for p in list(BASH_KANDIDATEN) + [shutil.which('bash') or '']:
        if not p or not os.path.isfile(p):
            continue
        try:
            r = subprocess.run([p, '-c', 'echo BASH_LEBT'], capture_output=True,
                               text=True, errors='replace', timeout=30)
        except OSError:
            continue
        if r.returncode == 0 and 'BASH_LEBT' in (r.stdout or ''):
            _BASH.append(p)
            return p
    _BASH.append(None)
    return None


def schale(bef):
    """(Name, argv) -- PowerShell als Vorgabe, bash nur fuer POSIX-Werkzeuge.

    Rueckgabe (Name, None) heisst: fuer diesen Befehl gibt es hier keine Schale. Das ist
    KEIN Ergebnis der Pruefung, sondern ihr Ausfall, und wird als Befund gemeldet.
    """
    teile = bef.strip().split()
    erst = teile[0].lower().rsplit('/', 1)[-1].rsplit('\\', 1)[-1] if teile else ''
    if erst in POSIX_WORTE:
        p = bash_pfad()
        return ('bash', [p, '-c', bef] if p else None)
    return ('powershell', ['powershell', '-NoProfile', '-Command', bef])


def _traegt_zahl(text, zahl):
    """Erzeugt der Befehl die angegebene Zahl -- woertlich oder als Zerlegung?

    Woertlich: die Zahl steht als eigenstaendige Zahl da. '1' darf nicht aus '137' gelesen
    werden, sonst bestuende `print(1)` gegen jede dreistellige Anzahl.

    Als Zerlegung: GEMESSEN AN AUF-006 F2 -- sein Befehl druckt 'erledigt 48 offen 0
    unbestimmbar 1' und die anzahl ist 49. Der Befehl ERZEUGT die Zahl, nur in ihren
    Teilen. Die Summe ist eine feste Ableitung, keine Vermutung, und wird darum anerkannt.
    """
    # Die Grenze ist WORT, nicht Ziffer. GEMESSEN AN AUF-006 F3: seine Ausgabe enthaelt
    # 're/tools_py28' und 'workflows_js20'; eine Ziffergrenze zog die 28 und die 20 aus den
    # Bezeichnern in die Summe und faerbte einen richtigen Befund rot.
    if re.search(r'(?<![0-9A-Za-z_])%d(?![0-9A-Za-z_])' % zahl, text):
        return True
    teile = [int(x) for x in
             re.findall(r'(?<![0-9A-Za-z_])([0-9]{1,9})(?![0-9A-Za-z_])', text)]
    return len(teile) > 1 and sum(teile) == zahl


def befehle_pruefen(lief, basis, still=False):
    """Faehrt jeden Befehl im Arbeitsort. Exit != 0 ist ein Befund; und ein
    grundgesamtheit.befehl, dessen Ausgabe seine eigene anzahl nicht enthaelt, auch."""
    import subprocess
    f = []
    for i, b in enumerate(lief.get('befunde') or []):
        for feld, bef, zahl, exit_soll in _befehle_einsammeln(b):
            wo = 'befund[%d] (%s) %s' % (i, (b or {}).get('id', 'ohne id'), feld)
            sname, argv = schale(bef)
            if argv is None:
                f.append('%s: keine arbeitsfaehige bash gefunden (auf dem PATH liegt der '
                         'WSL-Aufsatz ohne Distribution). %r wurde NICHT gefahren -- das '
                         'ist kein gruenes Ergebnis, sondern eine ausgefallene Pruefung.'
                         % (wo, bef[:48]))
                continue
            try:
                p = subprocess.run(argv, cwd=basis, capture_output=True,
                                   text=True, errors='replace', timeout=BEFEHL_FRIST)
                rc, aus = p.returncode, (p.stdout or '') + (p.stderr or '')
            except FileNotFoundError as e:
                f.append('%s: die Schale %s fuer %r ist nicht da (%s). Ein Befehl, der '
                         'nicht gefahren werden KANN, ist nicht geprueft.'
                         % (wo, sname, bef[:48], e))
                continue
            except subprocess.TimeoutExpired:
                f.append('%s: %r laeuft in %s laenger als %d s und wurde abgebrochen.'
                         % (wo, bef[:48], sname, BEFEHL_FRIST))
                continue
            if rc != exit_soll:
                grund = ('Ein Befehl, der nicht durchlaeuft, hat die Zahl nicht erzeugt'
                         if exit_soll == 0 else
                         'Der Befund kuendigt erwarteter_exit %d an -- der trifft nicht zu'
                         % exit_soll)
                f.append('%s: %r endet in %s mit Exit %d (erwartet %d). %s: %s'
                         % (wo, bef[:48], sname, rc, exit_soll, grund,
                            aus.strip().splitlines()[-1:] or ['(leer)']))
            elif isinstance(zahl, int) and not _traegt_zahl(aus, zahl):
                f.append('%s: %r laeuft in %s durch, seine Ausgabe traegt die angegebene '
                         'anzahl %d aber NICHT -- weder woertlich noch als Summe. Sie ist '
                         'HEUTE nicht reproduzierbar: %r'
                         % (wo, bef[:48], sname, zahl, aus.strip()[:60]))
            elif not still:
                print('  [ok] %-30s %-10s Exit %d  %s'
                      % (wo[:30], sname, rc, bef[:44]))
    return f


# ------------------------------- STUFE 6: KEIN .git IM BEFEHL UND IM ERHEBUNGSSKRIPT
#
# docs/NEXT_SESSION.md, S244 Punkt 2.1. Die Vorgabe stand DREIMAL in Prosa im
# Auftragstext -- S241, dann AUF-038 und AUF-039 in DERSELBEN Welle, fett und mit
# Praezedenzfall. Beide Skripte starben trotzdem beim Orchestrator:
#
#   AUF-038  PermissionError    ROOT/'.git' .read_text() -- im Worktree des
#                               Ausfuehrenden ist .git eine DATEI (gitdir-Zeiger),
#                               im Hauptrepo ein VERZEICHNIS.
#   AUF-039  FileNotFoundError  'C:/.git/refs/heads/auf/039-kamerator' -- ein Pfad,
#                               den es nur im Worktree gibt.
#
# Der Fehler ist STRUKTURELL, nicht dem einzelnen Text anzulasten: derselbe Quelltext
# laeuft beim Ausfuehrenden und stirbt beim Orchestrator. Ein Befehl, der nur in EINER
# der beiden Umgebungen laeuft, hat seine Zahl nicht reproduzierbar erzeugt -- und genau
# das ist die Zusage, die 'gemessen' macht. Der HEAD-SHA gehoert ueber
# `git rev-parse HEAD` erhoben, nicht ueber Dateizugriffe unterhalb von .git.
#
# [!] WAS DIESE STUFE NICHT TUT: sie faehrt nichts. Sie LIEST Quelltext. Darum braucht
#     sie kein --befehle und laeuft in JEDEM Lauf -- anders als Stufe 5, die abgeschaltet
#     ist, weil sie Zeichenketten aus einer Agentenlieferung ausfuehrt.
# [!!] KOMMENTARE UND DOCSTRINGS SIND AUSGENOMMEN, und das ist GEMESSEN, nicht geraten:
#      AUF-034_erhebung.py traegt '.git' AUSSCHLIESSLICH in seinem Docstring ("liest nur
#      Quelldateien, kein .git") -- also genau in der Zusage, die diese Stufe belohnen
#      soll. Eine reine Textsuche haette das vorbildliche Skript rot gemacht und die
#      Stufe binnen einer Welle unglaubwuerdig. Der Selbsttest faehrt diesen Fall.
# [!!] UND DER BEFEHLSTEXT ZAEHLT MIT: AUF-039 F1 lautet woertlich
#      `type C:\gamedev\grandprix\.git\refs\heads\auf\039-kamerator`. Da ist gar kein
#      Skript im Spiel -- ein Pruefer, der nur Dateien liest, haette das durchgelassen.
SKRIPT_ENDUNGEN = ('.py', '.ps1', '.sh', '.bat', '.cmd')


def _entwindows(s):
    """Backslash zu Schraegstrich -- damit '.git' in einem Windows-Pfad auffindbar ist."""
    return (s or '').replace(chr(92), '/')


def _skriptpfade(bef):
    """Die Tokens eines Befehls, die wie ein Skriptpfad aussehen (Reihenfolge erhalten)."""
    raus = []
    for t in re.split(r'[\s;|,]+', bef or ''):
        t = _entwindows(t.strip('\'"()'))
        if t.lower().endswith(SKRIPT_ENDUNGEN) and t not in raus:
            raus.append(t)
    return raus


def _git_stellen(pfad):
    """(stellen, wie) -- wo greift der CODE dieser Datei auf .git zu?

    'wie' ist Teil des Ergebnisses und gehoert in jede Meldung: 'ast' ist das starke
    Messgeraet (Kommentare und Docstrings sind sauber ausgeschieden), 'text' das
    schwache (nur fuehrende '#' fallen weg). Eine Textsuche darf nicht so aussehen wie
    eine Quelltextanalyse -- sonst gilt ihr Ergebnis mehr, als es wert ist.
    """
    try:
        quelle = io.open(pfad, encoding='utf-8', errors='replace').read()
    except (IOError, OSError) as e:
        return (None, 'unlesbar: %s' % e)
    zeilen = quelle.splitlines()

    def textsuche():
        return [(i + 1, z.strip()[:70]) for i, z in enumerate(zeilen)
                if '.git' in _entwindows(z) and not z.strip().startswith('#')]

    if not pfad.lower().endswith('.py'):
        return (textsuche(), 'text')
    try:
        baum = ast.parse(quelle)
    except SyntaxError as e:
        return (textsuche(), 'text (kein gueltiges Python: %s)' % e.msg)
    doc = set()
    for k in ast.walk(baum):
        leib = getattr(k, 'body', None)
        if isinstance(k, (ast.Module, ast.ClassDef, ast.FunctionDef,
                          ast.AsyncFunctionDef)) and isinstance(leib, list) and leib:
            erst = leib[0]
            if (isinstance(erst, ast.Expr) and isinstance(erst.value, ast.Constant)
                    and isinstance(erst.value.value, str)):
                doc.add(id(erst.value))
    stellen = set()
    for k in ast.walk(baum):
        if (isinstance(k, ast.Constant) and isinstance(k.value, str)
                and '.git' in _entwindows(k.value) and id(k) not in doc):
            n = getattr(k, 'lineno', 0)
            stellen.add((n, zeilen[n - 1].strip()[:70] if 0 < n <= len(zeilen)
                         else k.value[:70]))
    return (sorted(stellen), 'ast')


def skripte_pruefen(lief, basis, still=False):
    """Befehlstexte und die von ihnen genannten Skripte -- greift etwas davon auf .git zu?"""
    f = []
    gesehen = set()
    for i, b in enumerate(lief.get('befunde') or []):
        for feld, bef, _zahl, _exit in _befehle_einsammeln(b):
            wo = 'befund[%d] (%s) %s' % (i, (b or {}).get('id', 'ohne id'), feld)
            if '.git' in _entwindows(bef):
                f.append('%s: der BEFEHL selbst greift auf .git zu -- %r. Im Worktree des '
                         'Ausfuehrenden ist .git eine Datei, im Hauptrepo ein Verzeichnis; '
                         'dieser Befehl laeuft darum nur in EINER der beiden Umgebungen und '
                         'ist nicht reproduzierbar. Der HEAD-SHA kommt aus '
                         '`git rev-parse HEAD`. (AUF-039 F1 woertlich)' % (wo, bef[:70]))
            for p in _skriptpfade(bef):
                voll = p if os.path.isabs(p) else os.path.join(basis, p)
                schl = os.path.normcase(os.path.abspath(voll))
                if schl in gesehen:
                    continue
                gesehen.add(schl)
                if not os.path.isfile(voll):
                    f.append('%s: der Befehl nennt das Skript %r, dort liegt aber keine '
                             'Datei (%s). Es wurde NICHT auf .git geprueft -- das ist kein '
                             'gruenes Ergebnis, sondern eine ausgefallene Pruefung.'
                             % (wo, p, voll))
                    continue
                stellen, art = _git_stellen(voll)
                if stellen is None:
                    f.append('%s: das Skript %r ist nicht lesbar (%s) und wurde NICHT '
                             'geprueft.' % (wo, p, art))
                elif stellen:
                    f.append('%s: das Erhebungsskript %r greift an %d Stelle(n) auf .git zu '
                             '[Messart: %s]: %s -- AUF-038 starb daran mit PermissionError, '
                             'AUF-039 mit FileNotFoundError. Der HEAD-SHA kommt aus '
                             '`git rev-parse HEAD`.'
                             % (wo, p, len(stellen), art,
                                '; '.join('Z.%d %s' % s for s in stellen[:3])))
                elif not still:
                    print('  [ok] %-30s %-32s kein .git im Code [%s]'
                          % (wo[:30], p[-32:], art))
    return f

# --------------------------------------------------- DIE PRUEFMENGE JEDER STUFE
def pruefmengen(lief):
    """Wie viele Gegenstaende hatte jede Stufe ueberhaupt vor sich?

    docs/PROZESS_AUFTRAGSKETTE.md Abschnitt 7 Fall 2: Stufe 4 meldete "jeder Beleg zeigt auf etwas
    Existierendes und Eindeutiges" -- bei AUF-003 ueber NULL Belege. Eine Allaussage ueber
    die leere Menge ist trivial wahr und sagt nichts. Sie muss darum SAGEN, dass sie leer
    war. Reine Funktion, ohne Nebenwirkung: die Zahlen sind aus der Lieferung ablesbar.
    """
    befunde = [b for b in (lief.get('befunde') or []) if isinstance(b, dict)]
    worte = belege = befehle = 0
    skripte = set()
    for b in befunde:
        a = b.get('aussage') or ''
        if VOLLSTAENDIG.search(a) or NULLAUSSAGE.search(a) or isinstance(
                b.get('grundgesamtheit'), dict):
            worte += 1
        for name in ('quellbeleg', 'laufzeitbeleg'):
            bel = b.get(name)
            if isinstance(bel, dict) and bel.get('pfad') and bel.get('anker'):
                belege += 1
        for _feld, _bef, _z, _exit in _befehle_einsammeln(b):
            befehle += 1
            for _p in _skriptpfade(_bef):
                skripte.add(os.path.normcase(_p))
    return {1: ('Befunde', len(befunde)),
            2: ('pruefbare Aussagen', worte),
            3: ('Befunde', len(befunde)),
            4: ('Belege', belege),
            5: ('Befehle', befehle),
            # Stufe 6 prueft BEIDES: jeden Befehlstext und jedes genannte Skript. Sie ist
            # darum nur dann leer, wenn die Lieferung ueberhaupt keinen Befehl nennt --
            # ein Befehl wie `type ...\.git\...` hat gar kein Skript und muss trotzdem
            # zaehlen, sonst meldete die Stufe "leere Pruefmenge" und einen Befund zugleich.
            6: ('Befehlstexte und genannte Skripte', befehle + len(skripte))}


def _menge_sagen(nr, mengen):
    """Eine Zeile, die die Prueflast nennt -- und die leere Menge beim Namen."""
    was, n = mengen[nr]
    if n:
        return '%d %s geprueft' % (n, was)
    return ('LEERE PRUEFMENGE: 0 %s -- diese Stufe hat NICHTS geprueft. '
            '"sauber" hiesse hier nur, dass es nichts zu pruefen gab.' % was)


def abnehmen(lief, basis, still=False):
    """Alle vier Stufen. Rueckgabe: Liste der Befunde, leer heisst sauber."""
    alle = []
    mengen = pruefmengen(lief)
    stufen = ((1, 'STUFE 1  FORM', form_pruefen(lief)),
              (2, 'STUFE 2  WORTE (Vollstaendigkeit und Nullaussagen)', worte_pruefen(lief)),
              (3, 'STUFE 3  VERFASSUNG (tools/tracker_schema.sql)', verfassung_pruefen(lief)))
    for nr, titel, fehler in stufen:
        if not still:
            print('== %s ==' % titel)
            print('  %s' % ('%d Befund(e)' % len(fehler) if fehler else 'sauber'))
            print('  %s' % _menge_sagen(nr, mengen))
        alle += fehler
    if not still:
        print('== STUFE 4  BELEGE GEGEN DAS DATEISYSTEM ==')
    b = belege_pruefen(lief, basis, still=still)
    if not still:
        if not b and mengen[4][1]:
            print('  jeder Beleg zeigt auf etwas Existierendes und Eindeutiges')
        print('  %s' % _menge_sagen(4, mengen))
    return alle + b


# ------------------------------------------------------------------- SELBSTTEST
def _muster():
    """Eine gueltige Lieferung. Jede Negativkontrolle ist eine Mutation HIERVON -- damit
    sie genau eine Regel verletzt und nicht nebenbei drei andere.

    Kommt aus dem Profil: was ein gueltiger Befund IST, unterscheidet sich zwischen
    einem Reverse-Engineering- und einem Dokumentprojekt.
    """
    return profil.muster()


def _muster_vorbild():
    """Nur noch Beleg, wie das Muster im Vorbild grandprix aussah. Nicht mehr benutzt."""
    return {
        'auftrag': 'AUF-000',
        'stand': {'head': 'f950e2e',
                  'apk_sha256':
                      'd6b1136be9f8ab53a46343135af0acc6d6db9999225def3267bc5086d8162139'},
        'nicht_erreicht': [],
        'befunde': [{
            'id': 'F1',
            'aussage': 'Die Probedatei traegt die Zeichenfolge EINMALIG_ANKER an einer Stelle.',
            'sicherheit': 'gelesen',
            'achse': 'dekodiert',
            'marker_vorschlag': '[x]',
            'begruendung_marker': 'Quellbeleg liegt vor, die Aussage betrifft nur die Quelle.',
            'gegenstand': {'art': 'methode', 'name': 'Probemethode',
                           'klasse': 'Ld/a;', 'methode': 'a'},
            'quellbeleg': {'rang': 'S3', 'pfad': 're/jadx/sources/d/a.java',
                           'anker': 'EINMALIG_ANKER'},
        }],
    }


def _basis_bauen():
    """Ein Wegwerf-Repo mit Probedateien. Der Selbsttest haengt damit an KEINER Datei des
    echten Baums -- er misst das Werkzeug, nicht den Projektzustand."""
    return profil.basis_bauen()


def _basis_bauen_vorbild():
    basis = tempfile.mkdtemp(prefix='abnahme_selbsttest_')
    ziel = os.path.join(basis, 're', 'jadx', 'sources', 'd')
    os.makedirs(ziel)
    with io.open(os.path.join(ziel, 'a.java'), 'w', encoding='utf-8') as fh:
        fh.write('EINMALIG_ANKER\nDOPPELT_ANKER\nDOPPELT_ANKER\n')
    os.makedirs(os.path.join(basis, 're', '_ergebnisse'))
    with io.open(os.path.join(basis, 're', '_ergebnisse', 'probe.txt'), 'w',
                 encoding='utf-8') as fh:
        fh.write('LAUF_ANKER\n')
    return basis


def selbsttest():
    """Kann dieses Werkzeug rot werden -- und zwar in JEDER der vier Stufen?"""
    import shutil
    basis = _basis_bauen()
    fehler = 0
    print('== SELBSTTEST ==')
    try:
        # --- Positivkontrolle: die gueltige Lieferung MUSS durchkommen ---
        rein = abnehmen(_muster(), basis, still=True)
        ok = not rein
        print('  [%s] Positivkontrolle: die gueltige Musterlieferung kommt durch -- %s'
              % ('ok' if ok else 'FEHLER',
                 'keine Befunde' if ok else '%d Befund(e): %s' % (len(rein), rein[:2])))
        if not ok:
            fehler += 1

        faelle = []

        def fall(titel, stufe, aendern, erwartet):
            lief = _muster()
            aendern(lief)
            faelle.append((titel, stufe, lief, erwartet))

        def b0(lief):
            return lief['befunde'][0]

        # Stufe 1 -- Form
        fall('[?] ohne blockade', 1,
             lambda l: b0(l).update({'marker_vorschlag': '[?]'}), 'ohne blockade')
        fall('[!] ohne widerspruch_zu', 1,
             lambda l: b0(l).update({'marker_vorschlag': '[!]'}), 'ohne widerspruch_zu')
        fall('"gemessen" ohne Befehl', 1,
             lambda l: b0(l).update({'sicherheit': 'gemessen'}), 'befehl fehlt')
        fall('sechster Marker [!!]', 1,
             lambda l: b0(l).update({'marker_vorschlag': '[!!]'}), 'keiner der erlaubten')
        fall('Laufzeitbeleg ohne Kontrollen', 1,
             lambda l: b0(l).update({'laufzeitbeleg': {
                 'rang': 'L3', 'pfad': 're/_ergebnisse/probe.txt',
                 'anker': 'LAUF_ANKER'}}), 'ohne positivkontrolle')
        # Aus dem Schema: das erste stand-Feld mit einem pattern. So prueft dieser Fall
        # in JEDEM Profil das, was dort tatsaechlich als Muster verlangt wird.
        _mfeld = next((k for k, v in (_SCHEMA['properties']['stand'].get('properties') or {}).items()
                       if v.get('pattern')), None)
        if _mfeld:
            fall('stand.%s verletzt sein Muster' % _mfeld, 1,
                 lambda l, _f=_mfeld: l['stand'].update({_f: 'weiss_ich_nicht'}),
                 'entspricht nicht')
        # Stufe 2 -- Worte
        fall('Allaussage ohne Grundgesamtheit', 2,
             lambda l: b0(l).update({
                 'aussage': 'Alle Aufrufer der Methode stehen im selben Paket.'}),
             'ohne grundgesamtheit')
        fall('Nullaussage ohne Positivkontrolle', 2,
             lambda l: b0(l).update({
                 'aussage': 'Es gibt keinen Aufrufer dieser Methode im Baum.',
                 'grundgesamtheit': {'menge': 'alle .smali-Dateien', 'anzahl': 1022,
                                     'befehl': 'grep -rl ... re/smali/smali',
                                     'wurzel': 're/smali/smali'}}),
             'ohne grundgesamtheit.positivkontrolle')
        # --- Die drei neuen Faelle der Stufe 2 (docs/PROZESS_AUFTRAGSKETTE.md Abschnitt 7) ---
        fall('Nullaussage ohne Suchbereich', 2,
             lambda l: b0(l).update({
                 'aussage': 'Es gibt keinen Aufrufer dieser Methode im Baum.',
                 'grundgesamtheit': {'menge': 'alle .smali-Dateien', 'anzahl': 1022,
                                     'befehl': 'grep -rl ... re/smali/smali',
                                     'positivkontrolle': 'Lb/b;->u:Z steht in b/b.smali'}}),
             'ohne grundgesamtheit.wurzel')
        fall('Positivkontrolle aus fremdem Bereich', 2,
             lambda l: b0(l).update({
                 'aussage': 'Es gibt keinen Aufrufer dieser Methode im Baum.',
                 'grundgesamtheit': {'menge': 'alle .smali-Dateien', 'anzahl': 1022,
                                     'befehl': 'grep -rl ... re/smali/smali',
                                     'wurzel': 're/smali/smali',
                                     'positivkontrolle': 'blindbaum.py wird gefunden'}}),
             'nennt den Suchbereich')
        # Der Strukturfehler zum dritten Mal: '0 Treffer' traegt KEIN Vollstaendigkeitswort
        # und erreichte die Nullaussagen-Pruefung hinter dem Wort-Gate darum nie.
        fall('Nullaussage OHNE Vollstaendigkeitswort', 2,
             lambda l: b0(l).update({
                 'aussage': 'Die Suche nach dem Bezeichner liefert 0 Treffer im Baum.'}),
             'Nullaussage ohne grundgesamtheit')
        # Aus dem Profil: der erste blinde Baum. Hat das Profil keinen, entfaellt der
        # Fall -- und der Selbsttest sagt das unten ausdruecklich, statt still weniger
        # zu pruefen.
        _bw = tuple(getattr(profil, 'BLINDE_WURZELN', ()))
        if _bw:
            _stich, _richtig, _hoch = _bw[0]
            fall('Aussage ueber %r mit zu hoher Wurzel' % _stich, 2,
                 lambda l, _s=_stich, _h=_hoch: b0(l).update({
                     'aussage': 'In %s steht der Wert an genau einer Stelle.' % _s,
                     'grundgesamtheit': {'menge': 'alle Dateien dort', 'anzahl': 1022,
                                         'befehl': 'grep -rn muster %s' % _h[0],
                                         'wurzel': _h[0],
                                         'positivkontrolle': 'ein bekannter Treffer wird gefunden'}}),
                 'gitignoriert')
        # Stufe 3 -- Verfassung: die CHECK-Constraints des Profil-Schemas. Welche Regel
        # dort traegt, weiss nur das Profil; der Kern kennt die Tabellen nicht.
        for _t, _aendern, _erwartet in profil.selbsttest_faelle(b0):
            fall(_t, 3, _aendern, _erwartet)

        # --- ab hier: die Faelle des Vorbilds grandprix, nur noch als Beleg ---
        # Stufe 3 -- Verfassung (CHECK-Constraints aus tracker_schema.sql)
        _vorbild_faelle = """
        # docs/CONSTITUTION.md Regel 2 ('Kein [x] ohne Beleg') auf ALLEN DREI Achsen. Bis
        # S233 stand hier nur 'dekodiert' -- und tools/lieferschema.json nannte den Beleg
        # ueberhaupt nicht (Abschnitt 7 Fall 4). Wer die Regel im Schema behauptet, muss
        # zeigen, dass sie auch traegt: gemessen ist sie hier, nicht dort. Nichts im Repo
        # validiert eine Lieferung gegen das Schema -- geprueft mit der Wurzel tools/ und
        # re/tools/, Positiv-Kontrolle 'lieferschema' -> tools/auftrag.ps1.
        fall('[x] dekodiert ohne Quellbeleg', 3,
             lambda l: b0(l).pop('quellbeleg'), 'weist ihn ab')
        fall('[x] beobachtet ohne Laufzeitbeleg', 3,
             lambda l: b0(l).update({'achse': 'beobachtet'}), 'weist ihn ab')
        fall('[x] portiert ohne Laufzeitbeleg/impl_datei', 3,
             lambda l: b0(l).update({'achse': 'portiert'}), 'weist ihn ab')
        fall('nackte Stellenangabe als Anker', 3,
             lambda l: b0(l)['quellbeleg'].update({'anker': 'Zeile 183'}), 'weist ihn ab')
        fall('Beleg aus dem 1.5.4-Altbaum', 3,
             lambda l: b0(l)['quellbeleg'].update(
                 {'pfad': 'analyse/re/jadx/sources/d/a.java'}), 'weist ihn ab')
        fall('S1 zeigt auf das Dekompilat', 3,
             lambda l: b0(l)['quellbeleg'].update({'rang': 'S1'}), 'weist ihn ab')
        fall('Klasse in Java-Punktschreibweise', 3,
             lambda l: b0(l)['gegenstand'].update({'klasse': 'd.a'}), 'weist ihn ab')
        """
        # Stufe 4 -- Belege gegen das Dateisystem
        # Der Pfad wird AUS DEM MUSTER abgeleitet, nicht hartkodiert -- so zeigt er in
        # jedem Profil neben die echte Probedatei statt irgendwohin.
        # VORAUSSETZUNG an profil.basis_bauen(): die Probedatei traegt die Anker
        # 'STEHT_DA_NICHT_DRIN' NICHT und 'DOPPELT_ANKER' GENAU ZWEIMAL.
        fall('Datei gibt es nicht', 4,
             lambda l: b0(l)['quellbeleg'].update(
                 {'pfad': b0(l)['quellbeleg']['pfad'] + '.gibt_es_nicht'}),
             'gibt es nicht')
        fall('Anker kommt nicht vor', 4,
             lambda l: b0(l)['quellbeleg'].update({'anker': 'STEHT_DA_NICHT_DRIN'}),
             'NICHT vor')
        fall('Anker ist mehrdeutig', 4,
             lambda l: b0(l)['quellbeleg'].update({'anker': 'DOPPELT_ANKER'}), 'mal vor')

        for titel, stufe, lief, erwartet in faelle:
            got = abnehmen(lief, basis, still=True)
            traf = [x for x in got if erwartet in x]
            ok = len(traf) >= 1
            print('  [%s] Negativkontrolle Stufe %d  %-34s -> %s'
                  % ('ok' if ok else 'FEHLER', stufe, titel,
                     traf[0][:70] if traf else 'NICHT ERKANNT'))
            if not ok:
                fehler += 1

        # --- Kontrolle AM WERKZEUG: die Wortsuche darf nicht in Woertern zuschlagen ---
        # 'Allradantrieb' enthaelt 'all', 'Keiner-Test' enthaelt 'kein'. Ohne Wortgrenzen
        # meldete diese Stufe bei jedem zweiten Befund rot und waere binnen einer Sitzung
        # abgeschaltet worden.
        harmlos = ('Der Allradantrieb wird in der Tabelle als Typ 3 gefuehrt und keinesfalls '
                   'anders; die Keilriemenscheibe traegt den Index 7.')
        treffer = sorted({m.group(1).lower() for m in VOLLSTAENDIG.finditer(harmlos)})
        ok = not treffer
        print('  [%s] Kontrolle am Werkzeug: Wortgrenzen halten (Allradantrieb, '
              'Keilriemen, keinesfalls) -- %s'
              % ('ok' if ok else 'FEHLER', 'kein Fehlalarm' if ok else 'Fehlalarm: %s' % treffer))
        if not ok:
            fehler += 1
        scharf = 'In allen vier lesbaren Staenden ist die Arbeitskopie leer.'
        treffer = sorted({m.group(1).lower() for m in VOLLSTAENDIG.finditer(scharf)})
        ok = bool(treffer)
        print('  [%s] Positiv-Kontrolle dazu: "In allen vier ..." schlaegt an -- %s'
              % ('ok' if ok else 'FEHLER', treffer or 'NICHT ERKANNT'))
        if not ok:
            fehler += 1

        # --- Kontrolle AM WERKZEUG: erkennt die Befehlspruefung Prosa? ---
        # Der Fall stammt woertlich aus AUF-000. Beide Richtungen, sonst misst sie nichts.
        prosa = 'AP-1 Write/Shell/Mcp-Protokoll'
        ok = not sieht_wie_befehl_aus(prosa)
        print('  [%s] Kontrolle am Werkzeug: %r gilt NICHT als Befehl -- %s'
              % ('ok' if ok else 'FEHLER', prosa, 'richtig' if ok else 'kommt durch'))
        if not ok:
            fehler += 1
        echte = ['ls re/tools/*.py | wc -l',
                 'python -u tools/blindbaum.py',
                 'git ls-files port | xargs grep -lF gamedev/grandprix | wc -l',
                 'certutil -hashfile foo.apk SHA256',
                 'Select-String -Path docs/CONSTITUTION.md -Pattern "Regel 10"']
        schlecht = [b for b in echte if not sieht_wie_befehl_aus(b)]
        ok = not schlecht
        print('  [%s] Positiv-Kontrolle dazu: %d echte Befehle gelten als Befehl -- %s'
              % ('ok' if ok else 'FEHLER', len(echte),
                 'alle' if ok else 'abgewiesen: %s' % schlecht))
        if not ok:
            fehler += 1

        # --- Kontrolle AM WERKZEUG: erkennt nennt_bereich denselben Bereich? ---
        # Beide Richtungen. Ein Erkenner, der immer True sagt, meldet jede Positivkontrolle
        # als bereichsgleich -- das waere genau der Fehler, den er schliessen soll.
        paare = [('Lb/b;->u:Z steht in b/b.smali:192', 're\\smali\\smali', True),
                 ('gefunden unter re/smali/smali/b/b.smali', 're/smali/smali', True),
                 # WOERTLICH AUS AUF-006 F8 -- die erste Fassung faerbte sie rot.
                 ('blindbaum.py: 27 Treffer im selben Lauf',
                  'Repo-Wurzel minus gitignorierte Quellbaeume', True),
                 ('27 Treffer mit demselben Befehl', 'irgendeine Prosa-Wurzel', True),
                 ('blindbaum.py wird gefunden', 're/smali/smali', False),
                 ('CONSTITUTION steht in docs/', 're/tools', False),
                 # Ohne Wurzel gibt es keinen Bereich, der derselbe sein koennte.
                 ('27 Treffer im selben Lauf', '', False)]
        schlecht = [(t, w) for t, w, soll in paare if nennt_bereich(t, w) is not soll]
        ok = not schlecht
        print('  [%s] Kontrolle am Werkzeug: nennt_bereich trennt gleichen von fremdem '
              'Bereich -- %s'
              % ('ok' if ok else 'FEHLER', '7/7' if ok else 'falsch: %s' % schlecht))
        if not ok:
            fehler += 1

        # --- Kontrolle AM WERKZEUG: liest _traegt_zahl eine Zahl aus einer groesseren? ---
        zfaelle = [('137\n', 137, True), ('  42  \n', 42, True), ('1\n', 137, False),
                   ('1137\n', 137, False), ('1370\n', 137, False),
                   # Ziffern IN Bezeichnern zaehlen nicht mit (AUF-006 F3).
                   ('py137 steht da', 137, False),
                   ('erledigt 48 offen 0 unbestimmbar 1', 49, True),
                   ("{('re/tools_py28','erledigt'): 27, ('wf_js20','erledigt'): 20,"
                    " ('re/tools_py28','unbestimmbar'): 1, ('test_visual','erledigt'): 1}",
                    49, True)]
        schlecht = [(t[:30], z) for t, z, soll in zfaelle
                    if _traegt_zahl(t, z) is not soll]
        ok = not schlecht
        print('  [%s] Kontrolle am Werkzeug: _traegt_zahl -- 137 nicht aus 1137/py137, '
              'Summe 48+0+1=49 ja -- %s'
              % ('ok' if ok else 'FEHLER', '8/8' if ok else 'falsch: %s' % schlecht))
        if not ok:
            fehler += 1

        # --- Kontrolle AM WERKZEUG: waehlt schale() die richtige Schale? ---
        bp = bash_pfad()
        ok = (schale('grep -c x f')[0] == 'bash'
              and schale('wc -l datei')[0] == 'bash'
              and schale('python -c "print(7)"')[0] == 'powershell'
              and schale('git ls-files | measure')[0] == 'powershell')
        print('  [%s] Kontrolle am Werkzeug: schale() nimmt bash fuer grep/wc, sonst '
              'PowerShell -- %s'
              % ('ok' if ok else 'FEHLER', bp or 'KEINE arbeitsfaehige bash gefunden'))
        if not ok:
            fehler += 1
        # Positiv-Kontrolle DAZU, und sie ist der Grund fuer die Vorgabe PowerShell:
        # derselbe Befehl liefert in beiden Schalen eine ANDERE Zahl. Wer die Schale raet,
        # raet die Zahl mit.
        # GEMESSEN BEIM BAU DES BAUKASTENS: diese Kontrolle zaehlte 're/tools/*.py' mit
        # cwd=REPO -- also im echten Baum von grandprix. Unter dem Wegwerf-Repo des
        # Selbsttests gab es das nicht, beide Schalen lieferten 0, und die Kontrolle
        # meldete "kein Unterschied messbar". Sie legt ihren Gegenstand jetzt SELBST an
        # und haengt damit an keinem Projektzustand mehr.
        import subprocess as _sp2
        _zaehlort = os.path.join(basis, '_schalenprobe')
        os.makedirs(_zaehlort, exist_ok=True)
        for _i in range(3):
            with io.open(os.path.join(_zaehlort, 'p%d.py' % _i), 'w',
                         encoding='utf-8') as _fh:
                _fh.write('# probe' + chr(10))
        zwei = {}
        for nm, av in (('bash', [bp, '-c', 'ls _schalenprobe/*.py | wc -l'] if bp else None),
                       ('powershell', ['powershell', '-NoProfile', '-Command',
                                       'ls _schalenprobe/*.py | wc -l'])):
            if av is None:
                continue
            try:
                r = _sp2.run(av, cwd=basis, capture_output=True, text=True,
                             errors='replace', timeout=120)
                zwei[nm] = (r.stdout or '').strip()
            except OSError:
                pass
        ok = len(zwei) == 2 and zwei['bash'] != zwei['powershell']
        print('  [%s] Positiv-Kontrolle dazu: dieselbe Zeile liefert je Schale eine andere '
              'Zahl -- %s' % ('ok' if ok else 'FEHLER',
                              zwei if ok else 'kein Unterschied messbar: %s' % zwei))
        if not ok:
            fehler += 1
        # Negativ-Kontrolle DAZU, und sie ist der Grund fuer bash_pfad(): der WSL-Aufsatz
        # auf dem PATH heisst 'bash', ist aber keine. Waehlte das Werkzeug ihn, waere jeder
        # Befehl rot -- und die Negativkontrollen dieser Stufe gruen aus dem falschen Grund.
        import subprocess as _sp
        wsl = os.path.join(os.environ.get('SystemRoot', r'C:\Windows'), 'system32',
                           'bash.exe')
        if os.path.isfile(wsl):
            try:
                r = _sp.run([wsl, '-c', 'echo BASH_LEBT'], capture_output=True, text=True,
                            errors='replace', timeout=30)
                wsl_taugt = r.returncode == 0 and 'BASH_LEBT' in (r.stdout or '')
            except OSError:
                wsl_taugt = False
            ok = (bp is not None) and (os.path.normcase(bp) != os.path.normcase(wsl)
                                       or wsl_taugt)
            print('  [%s] Negativ-Kontrolle dazu: der WSL-"bash" auf dem PATH wird nicht '
                  'als Schale genommen -- %s'
                  % ('ok' if ok else 'FEHLER',
                     'er besteht die Echo-Probe nicht' if not wsl_taugt
                     else 'er besteht sie und darf genommen werden'))
            if not ok:
                fehler += 1

        # --- STUFE 5 selbst: sie muss gruen UND rot koennen ---
        # Die zwei roten Faelle stammen woertlich aus AUF-003 (39x 'python -c count',
        # 7x 'python -c import json; print(1)' bei anzahl 39).
        def s5(befehl, anzahl):
            l = _muster()
            l['befunde'][0]['grundgesamtheit'] = {
                'menge': 'Probemenge', 'anzahl': anzahl, 'befehl': befehl}
            return befehle_pruefen(l, basis, still=True)

        gruen = s5('python -c "print(7)"', 7)
        ok = not gruen
        print('  [%s] Positiv-Kontrolle Stufe 5: ein Befehl, der seine Zahl erzeugt, '
              'kommt durch -- %s' % ('ok' if ok else 'FEHLER',
                                     'keine Befunde' if ok else str(gruen[:1])))
        if not ok:
            fehler += 1
        for titel, bef, anz_, erwartet in (
                ('Exit 1 (AUF-003 woertlich)', 'python -c count', 7, 'mit Exit 1'),
                ('laeuft, erzeugt die Zahl nicht', 'python -c "print(1)"', 39,
                 'traegt die angegebene anzahl')):
            got = s5(bef, anz_)
            traf = [x for x in got if erwartet in x]
            ok = len(traf) >= 1
            print('  [%s] Negativkontrolle Stufe 5  %-34s -> %s'
                  % ('ok' if ok else 'FEHLER', titel,
                     traf[0][:60] if traf else 'NICHT ERKANNT'))
            if not ok:
                fehler += 1

        # --- erwarteter_exit (neu 2026-09-22): das Feld muss in BEIDE Richtungen wirken.
        #     Ohne diese zwei Kontrollen prueft es nichts, und ein Feld, das nichts prueft,
        #     ist eine Ausrede mit Schema-Eintrag.
        def s5e(befehl, anzahl, soll):
            l = _muster()
            l['befunde'][0]['grundgesamtheit'] = {
                'menge': 'Probemenge', 'anzahl': anzahl, 'befehl': befehl,
                'erwarteter_exit': soll}
            return befehle_pruefen(l, basis, still=True)

        got = s5e('python -c "print(7); raise SystemExit(1)"', 7, 1)
        ok = not got
        print('  [%s] Positiv-Kontrolle erwarteter_exit: angekuendigter Exit 1 kommt '
              'durch -- %s' % ('ok' if ok else 'FEHLER',
                               'keine Befunde' if ok else str(got[:1])))
        if not ok:
            fehler += 1

        got = s5e('python -c "print(7)"', 7, 1)
        traf = [x for x in got if 'erwartet 1' in x]
        ok = len(traf) >= 1
        print('  [%s] Negativkontrolle erwarteter_exit: angekuendigte 1, geliefert 0 -> '
              'Befund -- %s' % ('ok' if ok else 'FEHLER',
                                traf[0][:70] if traf else 'NICHT ERKANNT'))
        if not ok:
            fehler += 1

        # --- Kontrolle AM WERKZEUG: sagt die Pruefmenge die leere Menge an? ---
        voll = pruefmengen(_muster())
        leerl = _muster()
        leerl['befunde'] = []
        leerm = pruefmengen(leerl)
        ok = (voll[4][1] == 1 and leerm[4][1] == 0
              and 'LEERE PRUEFMENGE' in _menge_sagen(4, leerm)
              and 'LEERE PRUEFMENGE' not in _menge_sagen(4, voll))
        print('  [%s] Kontrolle am Werkzeug: leere Pruefmenge wird benannt, volle nicht '
              '-- %s' % ('ok' if ok else 'FEHLER',
                         'beide Richtungen' if ok else 'voll=%s leer=%s'
                         % (voll[4], leerm[4])))
        if not ok:
            fehler += 1

        # --- Kontrolle AM WERKZEUG: kann es seine Ausgabe ueberhaupt schreiben? ---
        # Ein einzelnes Nicht-ASCII-Zeichen in der ERFOLGSmeldung liesse den Lauf mit
        # Exit 1 enden, obwohl Form, Worte, Verfassung und alle Belege sauber sind. Die
        # Windows-Konsole faehrt cp1252. Geprueft wird gegen ASCII, nicht gegen die gerade
        # eingestellte Kodierung -- sonst meldet eine UTF-8-Konsole gruen und die naechste
        # faellt.
        eigen = io.open(os.path.abspath(__file__), encoding='utf-8').read()
        schlimm = sorted({ord(c) for c in eigen if ord(c) > 127})
        ok = not schlimm
        print('  [%s] Kontrolle am Werkzeug: eigene Datei rein ASCII -- %s'
              % ('ok' if ok else 'FEHLER',
                 'ja' if ok else 'faellt auf cp1252: %s' % [hex(o) for o in schlimm]))
        if not ok:
            fehler += 1

        # --- STUFE 6: .git im Befehl und im Erhebungsskript (S244 Punkt 2.1) ---
        # Fuenf Faelle. Der WICHTIGSTE ist der letzte rote Gegenpol: ein VORBILDLICHES
        # Skript, das '.git' nur im Docstring nennt (AUF-034 woertlich), darf NICHT rot
        # werden. Ohne diesen Fall waere die Stufe eine Textsuche mit besserem Namen.
        # Der Ort kommt aus dem Muster des Profils, nicht aus einem festen Pfad:
        # unter einem Dokumentprofil gibt es kein re/_ergebnisse/.
        _lb = (_muster()['befunde'][0].get('laufzeitbeleg') or {}).get('pfad')
        _erg = os.path.dirname(_lb) if _lb else profil.ERGEBNIS_PFAD
        s6dir = os.path.join(basis, *_erg.replace('\\', '/').split('/'))
        os.makedirs(s6dir, exist_ok=True)
        proben = {
            'mit_git.py': ('import pathlib\n'
                           'ROOT = pathlib.Path(".")\n'
                           'raw = (ROOT / ".git").read_text()\n'
                           'print(raw)\n'),
            'ohne_git.py': ('import subprocess\n'
                            'print(subprocess.run(["git", "rev-parse", "HEAD"],\n'
                            '                     capture_output=True, text=True).stdout)\n'),
            'nur_doc.py': ('"""Erhebung -- liest nur Quelldateien, kein .git."""\n'
                           '# und auch dieser Kommentar sagt .git\n'
                           'import subprocess\n'
                           'print(subprocess.run(["git", "rev-parse", "HEAD"],\n'
                           '                     capture_output=True, text=True).stdout)\n'),
        }
        for nm, inhalt in proben.items():
            with io.open(os.path.join(s6dir, nm), 'w', encoding='utf-8') as fh:
                fh.write(inhalt)

        def s6(befehl):
            l = _muster()
            l['befunde'][0]['befehl'] = befehl
            return skripte_pruefen(l, basis, still=True)

        for titel, bef, erwartet, soll_rot in (
                ('Skript MIT .git im Code',
                 'python -u %s/mit_git.py' % _erg, 'greift an 1 Stelle', True),
                ('Befehl nennt .git selbst (AUF-039 F1)',
                 'type C:' + chr(92) + 'gamedev' + chr(92) + 'grandprix' + chr(92)
                 + '.git' + chr(92) + 'refs' + chr(92) + 'heads' + chr(92) + 'auf'
                 + chr(92) + '039-kamerator',
                 'der BEFEHL selbst greift auf .git zu', True),
                ('genanntes Skript gibt es nicht',
                 'python -u %s/gibt_es_nicht.py' % _erg,
                 'ausgefallene Pruefung', True),
                ('Skript OHNE .git (git rev-parse)',
                 'python -u %s/ohne_git.py' % _erg, None, False),
                ('.git NUR in Docstring und Kommentar',
                 'python -u %s/nur_doc.py' % _erg, None, False)):
            got = s6(bef)
            if soll_rot:
                traf = [x for x in got if erwartet in x]
                ok = len(traf) >= 1
                zeig = traf[0][:58] if traf else 'NICHT ERKANNT'
            else:
                ok = not got
                zeig = 'keine Befunde' if ok else got[0][:58]
            print('  [%s] Stufe 6  %-36s -> %s' % ('ok' if ok else 'FEHLER', titel, zeig))
            if not ok:
                fehler += 1

        # Kontrolle am Werkzeug: BEIDE Proben tragen die Zeichenfolge '.git' im Text --
        # eine im Code, eine nur in Docstring und Kommentar. Faende die Analyse in beiden
        # dasselbe, waere sie eine Textsuche; faende sie in keinem etwas, waere sie blind.
        # Genau diese Gegenprobe fehlte in S243 zweimal bei einer Messgeraet-Reparatur.
        a_st, a_art = _git_stellen(os.path.join(s6dir, 'mit_git.py'))
        b_st, b_art = _git_stellen(os.path.join(s6dir, 'nur_doc.py'))
        roh_a = '.git' in io.open(os.path.join(s6dir, 'mit_git.py'),
                                  encoding='utf-8').read()
        roh_b = '.git' in io.open(os.path.join(s6dir, 'nur_doc.py'),
                                  encoding='utf-8').read()
        ok = (roh_a and roh_b and a_art == 'ast' and b_art == 'ast'
              and len(a_st or []) == 1 and not b_st)
        print('  [%s] Kontrolle am Werkzeug Stufe 6: beide Proben tragen ".git" im Text, '
              'die Quelltextanalyse trennt Code (%d) von Docstring (%d)'
              % ('ok' if ok else 'FEHLER', len(a_st or []), len(b_st or [])))
        if not ok:
            fehler += 1
    finally:
        shutil.rmtree(basis, ignore_errors=True)
    return fehler


def main():
    if '--selbsttest' in sys.argv:
        n = selbsttest()
        print()
        print('SELBSTTEST: %s' % ('bestanden' if not n else '%d FEHLER' % n))
        return 1 if n else 0

    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    basis = REPO
    if '--basis' in sys.argv:
        basis = os.path.abspath(sys.argv[sys.argv.index('--basis') + 1])
        args = [a for a in args if os.path.abspath(a) != basis]
    if not args:
        print(__doc__)
        return 1

    # Erst das Messgeraet, dann die Messung. Ein rotes Werkzeug prueft nichts.
    n = selbsttest()
    if n:
        print()
        print('ABBRUCH: der Selbsttest ist rot -- dieses Werkzeug prueft gerade nichts.')
        return 1
    print()

    pfad = args[0]
    if not os.path.isfile(pfad):
        print('Lieferung nicht gefunden: %s' % pfad)
        return 1
    try:
        lief = json.load(io.open(pfad, encoding='utf-8'))
    except ValueError as e:
        print('Die Lieferung ist kein gueltiges JSON: %s' % e)
        return 1

    print('== LIEFERUNG %s ==' % pfad)
    print('   Basis fuer die Belegpruefung: %s' % basis)
    print()
    fehler = abnehmen(lief, basis)
    mengen = pruefmengen(lief)

    # ---- STUFE 5: die Befehle. Abschnitt 7 Folge 3.
    print('== STUFE 5  DIE BEFEHLE (gefahren, nicht angesehen) ==')
    if '--befehle' in sys.argv:
        fehler += befehle_pruefen(lief, basis)
        print('  %s' % _menge_sagen(5, mengen))
    else:
        print('  [!] %d Befehl(e) NICHT gefahren -- diese Stufe ist ohne --befehle AUS.'
              % mengen[5][1])
        print('      Sie fuehrt Zeichenketten aus einer Agentenlieferung aus; das ist eine')
        print('      Entscheidung des Orchestrators, keine Vorgabe. AUF-003 lieferte 39x')
        print('      "python -c count" (Exit 1) und bestand die Formpruefung.')
    print()

    # ---- STUFE 6: der Befehl und das Erhebungsskript. S244 Punkt 2.1. Sie faehrt nichts
    #      und laeuft darum IMMER -- im Unterschied zu Stufe 5.
    print('== STUFE 6  BEFEHL UND ERHEBUNGSSKRIPT (.git ist verboten) ==')
    s6 = skripte_pruefen(lief, basis)
    fehler += s6
    if not s6 and mengen[6][1]:
        print('  kein Zugriff auf .git -- weder im Befehlstext noch im Quelltext')
    print('  %s' % _menge_sagen(6, mengen))
    print()

    # ---- Die leeren Pruefmengen noch einmal an einer Stelle. Abschnitt 7 Folge 2.
    leer = [nr for nr in sorted(mengen) if not mengen[nr][1]
            and (nr != 5 or '--befehle' in sys.argv)]
    if leer:
        print('[!] LEERE PRUEFMENGE in Stufe %s -- dort ist "sauber" kein Ergebnis, '
              'sondern die Abwesenheit einer Pruefung.'
              % ', '.join(str(n) for n in leer))
        print()
    if fehler:
        print('ERGEBNIS: %d Befund(e) -- die Lieferung wird NICHT uebernommen:' % len(fehler))
        for x in fehler:
            print('  %s' % x)
        return 1
    anz = len(lief.get('befunde') or [])
    offen = len(lief.get('nicht_erreicht') or [])
    print('ERGEBNIS: Form, Worte, Verfassung und Belege halten. %d Befund(e), %d offen '
          'gemeldet.' % (anz, offen))
    # ---- Die Beleg-Quote. Abschnitt 7 Fall 4: AUF-003 lieferte 0 von 39 Befunden mit Beleg und war
    # dabei formal konform -- keiner seiner Marker war ein [x], und nur ein [x] bindet die
    # Verfassung an einen Beleg. Die Zahl steht darum hier, sichtbar, statt gar nicht.
    mit = sum(1 for b in (lief.get('befunde') or [])
              if isinstance(b, dict) and (b.get('quellbeleg') or b.get('laufzeitbeleg')))
    print('          Belege: %d von %d Befund(en) tragen einen Quell- oder Laufzeitbeleg.'
          % (mit, anz))
    if anz and not mit:
        print('          [!] KEIN EINZIGER Befund traegt einen Beleg. Das ist zulaessig,')
        print('              solange kein Marker [x] darunter ist -- aber es heisst, dass')
        print('              Stufe 4 ueber die leere Menge gelaufen ist.')
    if offen == 0 and anz > 0:
        print('          [!] nicht_erreicht ist LEER. Das ist kein Erfolgszeichen. Es')
        print('              bedeutet meist, dass der Auftrag keine Stelle hatte, an der')
        print('              eine Luecke sichtbar werden konnte.')
    print('          *** Das heisst NICHT, dass die Aussagen wahr sind. Jeder Befund ist')
    print('              jetzt an der Quelle nachzumessen, bevor er in ein Dokument wandert.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
