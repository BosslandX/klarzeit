<#
    Schalter fuer den ausfuehrenden Cursor-Agenten.

        tools\cursor.ps1 -Status         zeigt den Zustand aller vier Ebenen
        tools\cursor.ps1 -An             Rechte auf Arbeitsmodus
        tools\cursor.ps1 -Aus            Rechte auf Nur-Lesen (Standard)
        tools\cursor.ps1 -Arbeitsfaehig  still; Exit 0 = der Agent kann arbeiten

    DER ZUSTAND WIRD NICHT GERATEN, sondern per SHA-256 gegen die beiden Vorlagen
    bestimmt. Weicht .cursor\cli.json von beiden ab, wird das als ABWEICHEND gemeldet,
    statt stillschweigend eine Vermutung auszugeben.

    EBENE 2 MISST DIE SACHE SELBST, NICHT EINEN STELLVERTRETER.
    Die Umgebungsvariable CURSOR_API_KEY zu lesen und daraus auf Arbeitsfaehigkeit zu
    schliessen, ist in beide Richtungen falsch:
      falsch NEGATIV: wer sich mit 'cursor-agent login' anmeldet, hat keine Variable
        gesetzt -- Schalter und Tor haetten "AUS, es laeuft nichts" gemeldet, waehrend
        der Agent arbeitet.
      falsch POSITIV: eine gesetzte, aber abgelaufene Variable haette "kann arbeiten"
        gemeldet. Der Schluessel laeuft nach 30 Tagen ab.
    Gemessen wird darum 'cursor-agent --list-models' und sein Exit-Code.
    NICHT geeignet ist 'cursor-agent status' -- es meldete im Versuch "Not logged in",
    waehrend derselbe Agent mit gesetztem Schluessel die vollstaendige Modellliste lieferte.

    WINDOWS-FALLE, in beiden Vorbildprojekten unabhaengig dokumentiert: eine im
    Benutzerprofil gesetzte Variable erreicht LAUFENDE Prozesse nicht, sie wird nur beim
    Prozessstart vererbt. Ohne die Uebernahme unten meldet der Agent
    "Authentication required", obwohl der Schluessel gesetzt ist.
    In game5 am 2026-09-07 nachgemessen: CURSOR_API_KEY stand als User-Variable, NICHT
    im Prozess -- ohne die Uebernahme waere der Schalter dort sofort falsch negativ
    gewesen. Das ist in JEDEM Projekt neu zu messen, nicht anzunehmen.

    HERKUNFT: C:\gamedev\composer-kit\kern\cursor.ps1. Dessen Herkunft: game5 (Ebene 5)
    auf grandprix (dort Weiterentwicklung der wikinger_one_new-Fassung).
    Wird diese Datei im Projekt geaendert, gehoert die Aenderung mit Begruendung in den
    Baukasten zurueck -- sonst divergieren die Fassungen lautlos, wie es zwischen den
    vier Bestandsprojekten geschehen ist (gemessen: 22-51 % abweichende Zeilen).
#>
[CmdletBinding()]
param(
    [switch]$An,
    [switch]$Aus,
    [switch]$Status,
    [switch]$Arbeitsfaehig
)

$ErrorActionPreference = "Stop"
$repo    = Split-Path -Parent $PSScriptRoot
$aktiv   = Join-Path $repo ".cursor\cli.json"
$vorlAn  = Join-Path $repo ".cursor\cli.an.json"
$vorlAus = Join-Path $repo ".cursor\cli.aus.json"

function Get-Zustand {
    if (-not (Test-Path $aktiv))   { return "FEHLT" }
    if (-not (Test-Path $vorlAn))  { return "VORLAGE-AN-FEHLT" }
    if (-not (Test-Path $vorlAus)) { return "VORLAGE-AUS-FEHLT" }
    $h = (Get-FileHash $aktiv -Algorithm SHA256).Hash
    if ($h -eq (Get-FileHash $vorlAn  -Algorithm SHA256).Hash) { return "AN"  }
    if ($h -eq (Get-FileHash $vorlAus -Algorithm SHA256).Hash) { return "AUS" }
    return "ABWEICHEND"
}

# Ebene 2, direkt gemessen. Der Aufruf laeuft mit lokal gesenktem ErrorActionPreference,
# weil Windows PowerShell 5.1 sonst JEDE stderr-Zeile eines nativen Programms in einen
# terminierenden Fehler verwandelt -- der Lauf braeche ab, BEVOR die eigene Pruefung ihr
# Urteil sprechen kann.
function Get-Arbeitsfaehig {
    param([string]$Exe)
    if (-not (Test-Path $Exe)) {
        return [pscustomobject]@{ Ja = $false; Grund = "cursor-agent ist nicht installiert"; Composer = $false }
    }
    if (-not $env:CURSOR_API_KEY) {
        $u = [Environment]::GetEnvironmentVariable("CURSOR_API_KEY", "User")
        if ($u) { $env:CURSOR_API_KEY = $u }
    }
    $ErrorActionPreference = "Continue"
    $aus = & $Exe --list-models 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0) {
        # Nicht nur "der Aufruf ging durch", sondern: steht das Modell, mit dem hier
        # gearbeitet wird, ueberhaupt in der Liste? Ein Agent, der laeuft, aber
        # composer-2.5 nicht kennt, ist fuer diese Kette nicht arbeitsfaehig.
        $hatComposer = $aus -match "composer-2\.5"
        return [pscustomobject]@{ Ja = $true; Grund = ""; Composer = $hatComposer }
    }
    $erste = ($aus -split "`n" | Where-Object { $_.Trim() } | Select-Object -First 1)
    $g = if ($erste) { $erste.Trim() } else { "keine Ausgabe" }
    return [pscustomobject]@{ Ja = $false; Grund = ("Exit $LASTEXITCODE -- " + $g); Composer = $false }
}

if ($An -and $Aus) { Write-Error "-An und -Aus schliessen einander aus." }

$exe = Join-Path $env:LOCALAPPDATA "cursor-agent\cursor-agent.cmd"

# Stiller Modus fuer andere Werkzeuge (tools\gate.ps1, tools\auftrag.ps1).
if ($Arbeitsfaehig) {
    if ((Get-Arbeitsfaehig -Exe $exe).Ja) { exit 0 } else { exit 1 }
}

if ($An)  { Copy-Item $vorlAn  $aktiv -Force }
if ($Aus) { Copy-Item $vorlAus $aktiv -Force }

# --- Vier Ebenen, von hart nach weich ---
$z = Get-Zustand

$installiert = Test-Path $exe
$version = if ($installiert) { (& $exe --version 2>&1 | Select-Object -First 1) } else { "-" }

$kann = Get-Arbeitsfaehig -Exe $exe
# Nur noch zur ANZEIGE, nicht mehr als Urteil: welcher Weg die Anmeldung traegt.
$keyProc = [bool]$env:CURSOR_API_KEY
$keyUser = [bool][Environment]::GetEnvironmentVariable("CURSOR_API_KEY","User")
$weg = if ($keyProc -or $keyUser) { "Schluessel" } elseif ($kann.Ja) { "Anmeldung" } else { "-" }

$imPfad = $false
try { $imPfad = [bool](Get-Command agent -ErrorAction Stop) } catch { $imPfad = $false }

# Die Zahlen werden GEZAEHLT, nicht behauptet -- AUF-000 braucht sie als
# Grundgesamtheit: geprueft + ungeprueft = diese Zahl.
$erlaubt = "-"
if (Test-Path $aktiv) {
    try {
        $j = Get-Content $aktiv -Raw | ConvertFrom-Json
        $erlaubt = "" + $j.permissions.deny.Count + " deny / " + $j.permissions.allow.Count + " allow"
    } catch { $erlaubt = "nicht lesbar" }
}

""
"  Cursor-Agent - Zustand (klarzeit)"
"  " + ("-" * 62)
"  1  Installiert            : " + $(if ($installiert) { "ja  ($version)" } else { "NEIN" })
"  2  Arbeitsfaehig          : " + $(if ($kann.Ja) { "JA ueber $weg  <- gemessen an --list-models, Exit 0" } else { "NEIN  <- harter Aus-Schalter" })
if (-not $kann.Ja -and $kann.Grund) { "     Grund                  : " + $kann.Grund }
if ($kann.Ja -and -not $kann.Composer) { "     [!] composer-2.5 steht NICHT in der Modellliste." }
"  3  Rechte (.cursor)       : $z  ($erlaubt)" + $(if ($z -eq "AUS") { "  nur lesen" } elseif ($z -eq "AN") { "  schreibt nur in auftraege/_ergebnisse und auftraege/_probe" } else { "" })
"  4  Im PATH dieser Sitzung : " + $(if ($imPfad) { "ja" } else { "nein - neue Shell noetig" })

# ★★ S131 (Nutzeranweisung): Ebene 5 -- die Modellbindung. Sie prueft NUR, was bindbar IST.
#    `model` und `selectedModel` in ~/.cursor/cli-config.json bestimmen den HAUPTagenten;
#    `exploreSubagentModel` bestimmt Cursors eigene SUBagenten und ist NICHT haltbar bindbar
#    (cursor-agent setzt es bei jedem Agentenlauf auf "default" zurueck -- gemessen im
#    Schwesterprojekt hausverwaltung am 07.09.2026; in diesem Projekt UNGEMESSEN [?]).
#    ⚠ Eine Pruefung, die nie gruen werden kann, ist so wertlos wie eine, die nie rot wird.
#    Deshalb steht das dritte Feld als AUSKUNFT da, nicht als Bedingung.
$cfg = Join-Path $env:USERPROFILE ".cursor\cli-config.json"
$mHaupt = "nicht lesbar"; $mAusw = "nicht lesbar"; $mSub = "nicht lesbar"
if (Test-Path $cfg) {
    try {
        $c = Get-Content $cfg -Raw | ConvertFrom-Json
        $mHaupt = "" + $c.model.modelId
        $mAusw  = "" + $c.selectedModel.modelId
        $mSub   = "" + $c.exploreSubagentModel
    } catch { }
}
$bindungOk = ($mHaupt -eq "composer-2.5") -and ($mAusw -eq "composer-2.5")
"  5  Modellbindung          : " + $(if ($bindungOk) { "OK  (model + selectedModel = composer-2.5)" } else { "[!] model='$mHaupt' selectedModel='$mAusw'" })
"     Subagenten-Modell      : $mSub" + $(if ($mSub -eq "default") { "   <- Serverwahl, NICHT bindbar (s. Kopf)" } else { "" })
"  " + ("-" * 62)

if ($z -eq "ABWEICHEND") {
    "  [!] cli.json entspricht keiner Vorlage. Von Hand geaendert?"
    "      Zuruecksetzen: tools\cursor.ps1 -Aus"
}

$scharf = $kann.Ja -and ($z -eq "AN")
if ($scharf) {
    "  ERGEBNIS: SCHARF - Auftraege werden ausgefuehrt."
    "  [?] Was die Write-Sperren oben in diesem Projekt halten, ist UNGEMESSEN. In"
    "      beiden Vorbildprojekten fiel jede von fuenf geprueften -- das ist DORT"
    "      gemessen, hier eine Erwartung. AUF-000 misst es Eintrag fuer Eintrag."
    "      Die wirksame Grenze ist der Fingerabdruck in tools\auftrag.ps1; er misst"
    "      hinterher, was ausserhalb passiert ist."
    "      In klarzeit ist 'git status' unter node_modules/, dist/, docs/ und .serena/ blind -- tools\blindbaum.py misst sie."
} else {
    "  ERGEBNIS: AUS - es laeuft nichts."
    if (-not $kann.Ja)   { "            Zum Anschalten fehlt die Anmeldung (Ebene 2)." }
    elseif ($z -ne "AN") { "            Zum Anschalten: tools\cursor.ps1 -An" }
}
""

# Messgeraet, kein Test: der Zustand steht im Protokoll, nicht im Exit-Code.
exit 0
