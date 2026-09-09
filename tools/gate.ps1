<#
    Tor. Laeuft vor jedem Merge eines Auftrags-Zweigs.

    Exit 0 = sauber, Exit 1 = Befunde. (Kontrolle, kein Messgeraet.)

    WICHTIG: das Tor beginnt mit einem SELBSTTEST. Ein Tor, das nicht rot werden kann,
    prueft nichts -- sein Gruen waere wertlos. Schlaegt der Selbsttest fehl, bricht der
    Lauf ab, BEVOR irgendeine Pruefung laeuft.

    -ImLauf  nimmt GENAU EINEN Befund aus: dass .cursor\cli.json die AN-Fassung traegt.
             Waehrend ein Auftrag laeuft, ist das der beabsichtigte Zustand; beim Merge
             ist es ein Fehler. Ohne diesen Schalter widersprechen sich die Vorpruefungen
             von tools\auftrag.ps1: eine verlangt Rechte AN, eine ein gruenes Tor -- und
             das Tor wuerde durch eben diese Rechte rot.
             Alle uebrigen Pruefungen laufen unveraendert.

    ZWEI REGELN, DIE BEIM ERWEITERN GELTEN

    1  EIN FEHLENDES WERKZEUG IST KEIN "KEINE BEFUNDE". Wo eine Pruefung nicht laufen
       kann, wird das AUSGESPROCHEN -- als Befund oder als Hinweis, nie durch Schweigen.
       Ein stiller Fehlschlag sieht aus wie ein Ergebnis.

    2  EIN TOR, DAS IMMER ROT IST, WIRD ABGESCHALTET und prueft danach gar nichts.
       Wo ein bekannter, bewusst hingenommener Zustand dauerhaft anschlaegt, wird gegen
       einen GEMESSENEN Sollwert verglichen und nur die VERSCHLECHTERUNG gemeldet
       (Vorbild: grandprix, docs\repo-audit.sh, Sollwert 39 vom 2026-09-06).

    HERKUNFT: C:\gamedev\composer-kit\kern\gate.ps1, verallgemeinert aus
    C:\gamedev\grandprix\tools\gate.ps1 (Stand 2026-09-09). Dort projektspezifisch und
    darum hier NICHT uebernommen: die APK-Pruefung (jetzt generisch ueber
    $wahrheitsQuellen), docs\repo-audit.sh und die Rueckstandspruefung der
    Statusdokumente. Beides gehoert in den Block PROJEKTEIGENE PRUEFUNGEN unten.
#>
[CmdletBinding()]
param([switch]$ImLauf)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$fehler = @()
$hinweis = @()

# ================= KONFIGURATION DIESES PROJEKTS =================
# Dieselben Werte wie im Kopf von tools\auftrag.ps1. Weichen sie voneinander ab, misst
# das Tor etwas anderes als der Lauf.
$manifestPfad     = ""
$manifestMuster   = 'SHA-256 \| `([0-9a-fA-F]{64})`'
$wahrheitsQuellen = @()
$probeSkript      = "tools\tracker_probe.py"      # prueft das Schema; "" = keins
$belegSkript      = "tools\beleg_pruefen.py"      # prueft Anker gegen das Dateisystem; "" = keins
$trackingDb       = "tools\tracking.db"       # "" = keine Datenbank
$manifestBeispiel = "| SHA-256 | `0000000000000000000000000000000000000000000000000000000000000000` |"
# =================================================================

# ------------------------------------------------------------------- SELBSTTEST
# Jede Pruefung unten haengt an mindestens einem dieser Paare.
$tmp1 = Join-Path ([System.IO.Path]::GetTempPath()) "gate_p1.txt"
$tmp2 = Join-Path ([System.IO.Path]::GetTempPath()) "gate_p2.txt"
try {
    # (a) SHA-256-Vergleich: erkennt er einen Unterschied, und meldet er Gleichheit?
    "inhalt A" | Set-Content $tmp1 -Encoding ascii
    "inhalt B" | Set-Content $tmp2 -Encoding ascii
    if ((Get-FileHash $tmp1 -Algorithm SHA256).Hash -eq (Get-FileHash $tmp2 -Algorithm SHA256).Hash) {
        throw "SELBSTTEST: zwei verschiedene Dateien haben denselben SHA-256. Pruefung 1 und 2 sind blind."
    }
    "inhalt A" | Set-Content $tmp2 -Encoding ascii
    if ((Get-FileHash $tmp1 -Algorithm SHA256).Hash -ne (Get-FileHash $tmp2 -Algorithm SHA256).Hash) {
        throw "SELBSTTEST: zwei gleiche Dateien haben verschiedene SHA-256. Pruefung 1 und 2 melden alles rot."
    }

    # (b) Pruefung 3 und 4 rufen python auf. Ist python nicht erreichbar, saehe ein
    #     stiller Fehlschlag wie "keine Befunde" aus.
    if ($probeSkript -or $belegSkript) {
        $null = & python -c "import sqlite3, sys; sys.exit(0)" 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "SELBSTTEST: python mit sqlite3 nicht erreichbar. Pruefung 3 und 4 wuerden lautlos ausfallen."
        }
    }

    # (c) Das Manifest-Muster. Ein Muster, das nichts findet, laesst Pruefung 1 gruen
    #     werden, ohne dass sie etwas geprueft haette.
    if ($wahrheitsQuellen.Count -gt 0) {
        if ($manifestBeispiel -notmatch $manifestMuster) {
            throw "SELBSTTEST: das Manifest-Muster findet die Beispielzeile nicht. Pruefung 1 misst nichts."
        }
        if ("eine Zeile ganz ohne Pruefsumme" -match $manifestMuster) {
            throw "SELBSTTEST: das Manifest-Muster schlaegt auf einer Zeile OHNE Pruefsumme an. Pruefung 1 meldet Unsinn."
        }
    }
} finally {
    Remove-Item $tmp1, $tmp2 -Force -ErrorAction SilentlyContinue
}

# ------------------------------- 1  Die Wahrheitsquellen sind unveraendert
if ($wahrheitsQuellen.Count -eq 0) {
    $hinweis += "Keine Wahrheitsquellen definiert - Pruefung 1 hat NICHTS gemessen."
} else {
    $manifest = Join-Path $repo $manifestPfad
    if (-not (Test-Path $manifest)) {
        $fehler += "$manifestPfad fehlt - die Wahrheitsquellen haben keinen Integritaetsanker"
    } else {
        $zeilen = @(Select-String -Path $manifest -Pattern $manifestMuster)
        if ($zeilen.Count -eq 0) {
            $fehler += "In $manifestPfad steht kein SHA-256 im Muster $manifestMuster - Pruefung 1 hat NICHTS gemessen"
        } else {
            foreach ($q in $wahrheitsQuellen) {
                $datei = Join-Path $repo $q
                if (-not (Test-Path $datei)) { $fehler += "Wahrheitsquelle fehlt: $q"; continue }
                $ist = (Get-FileHash $datei -Algorithm SHA256).Hash.ToUpper()
                if (-not @($zeilen | Where-Object { $_.Matches[0].Groups[1].Value.ToUpper() -eq $ist })) {
                    $fehler += "Der SHA-256 von $q steht nicht in $manifestPfad (ist $($ist.Substring(0,12))...) - veraendert oder verwechselt?"
                }
            }
        }
    }
}

# ------------------------------- 2  Cursor-Schalter nicht versehentlich scharf
$cli = Join-Path $repo ".cursor\cli.json"
$an  = Join-Path $repo ".cursor\cli.an.json"
$cursorPs = Join-Path $repo "tools\cursor.ps1"
if ((Test-Path $cli) -and (Test-Path $an)) {
    $scharfeRechte = (Get-FileHash $cli -Algorithm SHA256).Hash -eq (Get-FileHash $an -Algorithm SHA256).Hash
    if ($scharfeRechte -and $ImLauf) {
        $hinweis += ".cursor/cli.json traegt die AN-Fassung - waehrend eines Auftragslaufs erwartet. Vor dem Merge: tools\cursor.ps1 -Aus"
    } elseif ($scharfeRechte) {
        # .cursor/cli.json ist versioniert. Die AN-Fassung mitzumergen hiesse, die
        # Schreibrechte dauerhaft ins Repo zu legen - unabhaengig davon, ob gerade
        # jemand angemeldet ist.
        $fehler += ".cursor/cli.json traegt die AN-Fassung - so darf nicht gemerged werden (tools\cursor.ps1 -Aus)"
        if (-not (Test-Path $cursorPs)) {
            $fehler += "  tools/cursor.ps1 fehlt - ob der Agent zusaetzlich arbeitsfaehig ist, bleibt ungeprueft"
        } else {
            & $cursorPs -Arbeitsfaehig
            if ($LASTEXITCODE -eq 0) { $fehler += "  und der Agent ist arbeitsfaehig: Cursor ist SCHARF" }
        }
    }
} elseif (Test-Path (Join-Path $repo ".cursor")) {
    $fehler += ".cursor/ existiert, aber cli.json oder cli.an.json fehlt - der Zustand ist nicht bestimmbar"
}

# ------------------------------- 3  Das Schema traegt die Verfassung
# Die Probe faehrt ihre eigenen Kontrollen und bricht ab, wenn sie rot sind. Das Tor
# wertet nur den Exit-Code aus - und meldet ausdruecklich, wenn das Werkzeug FEHLT.
if (-not $probeSkript) {
    $hinweis += "Kein Schema-Probeskript konfiguriert - das Schema ist ungeprueft."
} else {
    $probePy = Join-Path $repo $probeSkript
    if (-not (Test-Path $probePy)) {
        $fehler += "$probeSkript fehlt - das Schema ist ungeprueft"
    } else {
        $null = & python -u $probePy 2>&1
        if ($LASTEXITCODE -ne 0) { $fehler += "Schema-Probe ROT ($probeSkript Exit $LASTEXITCODE)" }
    }
}

# ------------------------------- 4  Belege zeigen auf Existierendes und Eindeutiges
# Das schliesst die Luecke, die jedes Schema als seine eigene Grenze hat: ein CHECK
# prueft die FORM eines Belegs, nie seinen Inhalt.
if (-not $belegSkript) {
    $hinweis += "Kein Belegskript konfiguriert - die Belege sind inhaltlich ungeprueft."
} else {
    $belegPy = Join-Path $repo $belegSkript
    if (-not (Test-Path $belegPy)) {
        $fehler += "$belegSkript fehlt - die Belege sind inhaltlich ungeprueft"
    } elseif ($trackingDb -and -not (Test-Path (Join-Path $repo $trackingDb))) {
        $fehler += "$trackingDb fehlt - die Belegpruefung hat keine Grundlage"
    } else {
        $ausgabe = & python -u $belegPy 2>&1
        if ($LASTEXITCODE -ne 0) {
            $fehler += "Belegpruefung ROT ($belegSkript Exit $LASTEXITCODE):"
            $ausgabe | Select-String -Pattern "^  " | Select-Object -First 10 | ForEach-Object { $fehler += "    $_" }
        }
    }
}

# ======================= PROJEKTEIGENE PRUEFUNGEN =======================
# Ab hier steht, was nur in diesem Projekt gilt. Beide Regeln aus dem Kopf gelten:
# ein fehlendes Werkzeug wird ausgesprochen, und ein dauerhaft roter Punkt wird gegen
# einen gemessenen Sollwert gehalten statt das ganze Tor unbrauchbar zu machen.
# Jede Pruefung, die hier dazukommt, braucht ihr Paar im SELBSTTEST oben.
# (noch keine projekteigenen Pruefungen -- s. docs/LEHREN.md)
# =======================================================================

# ---------------------------------------------------------------------- URTEIL
foreach ($h in $hinweis) { "[i] $h" }
if ($fehler.Count -gt 0) {
    "[!] Tor ROT - $($fehler.Count) Befund(e):"
    $fehler | ForEach-Object { "    $_" }
    exit 1
}
"[x] Tor sauber"
exit 0
