<#
    auftrag.ps1 -- faehrt EINEN Auftrag aus docs\auftraege\ mit dem Cursor-Agenten.

    Aufruf:
        tools\auftrag.ps1 -Nummer 000 -Kurzname leine -TrockenLauf
        tools\auftrag.ps1 -Nummer 000 -Kurzname leine
        tools\auftrag.ps1 -Nummer 000 -Aufraeumen
        tools\auftrag.ps1 -Nummer 000 -Selbsttest7      <- kann Vorpruefung 7 rot werden?
        tools\auftrag.ps1 -Nummer 000 -SelbsttestParallel  <- haelt der Fingerabdruck,
                                                             wenn MEHRERE Laeufe stehen?

    MEHRERE AUSFUEHRENDE: erlaubt und vorgesehen. Jeder Lauf bekommt seine eigene Nummer,
    seinen eigenen Zweig, seinen eigenen Arbeitsort und seine eigene Lieferung -- nichts
    davon ist geteilt. Nacheinander ging das immer; NEBENEINANDER ging es bis zum
    2026-09-07 nicht, und zwar nicht wegen einer Regel, sondern weil der Fingerabdruck
    genau einen Lauf annahm (er meldete den Arbeitsort und das Protokoll des jeweils
    anderen als Ausbruch). Das ist behoben, s. Get-AktiveLaeufe, und mit
    -SelbsttestParallel gegengeprueft.
    Was geteilt BLEIBT und darum Absprache braucht: die Leine (.cursor\cli.json) gilt
    fuer alle. 'tools\cursor.ps1 -Aus' beendet die Arbeitsfaehigkeit ALLER laufenden
    Auftraege, nicht nur des eigenen.

    WAS DIESES SKRIPT NICHT TUT: es schaltet die Rechte NICHT scharf. Das bleibt
    'tools\cursor.ps1 -An' und damit einer ausdruecklichen Handlung des Nutzers
    vorbehalten. Steht die Leine auf AUS, bricht dieses Skript ab, statt sie zu setzen.

    WARUM EIN WORKTREE UND WARUM ER GEFUELLT WIRD: git worktree checkt nur VERSIONIERTE
    Dateien aus. Was unter .gitignore steht, fehlt im Arbeitsort -- und in den bisher
    eingerichteten Projekten war das ausgerechnet das ARBEITSMATERIAL (in grandprix die
    APK und drei Quellbaeume, in gamedesign saemtliche Volltexte). Ein Ausfuehrender vor
    leerem Material merkt das in aller Regel nicht, sondern liefert etwas Plausibles.
    Darum die vier Listen im Konfigurationsblock weiter unten; die Dateizahl jedes
    kopierten Baumes wird danach gegengeprueft.

    *** WORAN EIN WORKTREE NICHT ISOLIERT -- IN JEDEM PROJEKT NEU ZU MESSEN ***
    Ein Worktree ist nur so gut wie die Pfade im Projekt. Beide Vorbildprojekte hatten
    hartkodierte ABSOLUTE Pfade auf den Hauptbaum, die aus jedem Arbeitsort dorthin
    zurueckschreiben:
      - grandprix, 2026-09-06/07: 97 der 168 GDScript-Dateien unter port\ und 20 der
        166 Werkzeuge unter re\tools\; 245 Vorkommen, Hauptziel re\_verify\.
      - game5: 112 .gd-Dateien mit C:/gamedev/game5, davon zwei, die sogar
        C:/gamedev/game5/.git/HEAD lesen -- also den HEAD des falschen Baums.
    In beiden Faellen stand das Ziel unter .gitignore: 'git status' meldete "sauber",
    waehrend danebengeschrieben wurde.

    ★ Vor der ersten scharfen Nutzung in einem neuen Projekt ist das zu MESSEN, nicht
      anzunehmen -- etwa mit einer Suche nach dem eigenen Projektpfad im Quellbaum.
      Wo es zutrifft, gehoert das betroffene Werkzeug auf die deny-Liste UND in den
      Auftrag; der Arbeitsort ist dann eine Rueckschreib-Rampe, keine Grenze.

    Der Fingerabdruck misst darum ZUSAETZLICH die gitignorierten Baeume ueber
    tools\blindbaum.py (Dateizahl, Bytes, juengste mtime -- statt eines vollen Hashs).
    Das ist kein Beweis der Unveraendertheit, sondern ein Anzeiger fuer Veraenderung;
    die Grenze steht im Kopf von blindbaum.py.

    KEINE PIPE, KEIN timeout-KOMMANDO: der Agent laeuft ueber Start-Process -PassThru,
    wird mit WaitForExit(ms) begrenzt und notfalls per taskkill /F /T /PID beendet --
    also NUR ueber die selbst erzeugte PID, nie ueber einen Namen.

    HERKUNFT: C:\gamedev\composer-kit\kern\auftrag.ps1, dort verallgemeinert aus
    C:\gamedev\grandprix\tools\auftrag.ps1 (Stand 2026-09-09).
    NICHT aus hausverwaltung uebernommen wurden dessen npm-Teile (Workspace-Junctions,
    Container-Ports, der 'npm run'-Selbsttest) -- die stehen im Profil "code", weil sie
    in einem Dokumentprojekt nur Ballast waeren.
    Aenderungen an dieser Datei gehoeren mit Begruendung in den Baukasten zurueck.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Nummer,
    [string]$Kurzname = "auftrag",
    [string]$Modell = "composer-2.5",
    [int]$MaxMinuten = 30,
    [switch]$TrockenLauf,
    [switch]$Aufraeumen,
    [switch]$Selbsttest7,
    [switch]$SelbsttestParallel
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------- MODELLSPERRE
# Zugelassen ist GENAU EIN Modell. Der Sinn eines zweiten Ausfuehrenden ist ein ANDERES
# Modell als das des Orchestrators (VORLAGE_AUF.md, Kopfzeile "Modell") -- und ein anderes
# heisst nicht "irgendein anderes". Ein Auftrag, der gegen ein unbekanntes Modell laeuft,
# liefert eine Lieferung, die wie jede andere aussieht, aber von etwas anderem stammt als
# das Verfahren annimmt. Die Abnahme sieht dem Ergebnis nicht an, wer es erzeugt hat.
#
# Der Parameter -Modell bleibt bestehen, weil das Protokoll ihn ausgibt und weil eine
# Sperre, die man nicht ansprechen kann, auch nicht pruefbar ist. Er nimmt nur noch den
# einen Wert an.
#
# ACHTUNG, ZWEITE STELLE: Cursor waehlt fuer INTERNE Unteragenten ein eigenes Modell ueber
# ~/.cursor/cli-config.json -> "exploreSubagentModel". Stand "default" heisst NICHT
# composer-2.5. Diese Zeile hier erreicht das nicht -- die Datei liegt ausserhalb des Repos
# (Prozessdoku 5.2). Auf dieser Maschine am 2026-09-07 auf "composer-2.5" gesetzt.
$MODELL_ERLAUBT = "composer-2.5"
if ($Modell -ne $MODELL_ERLAUBT) {
    Write-Host ""
    Write-Host "[!] ABBRUCH: Modell '$Modell' ist fuer dieses Projekt nicht zugelassen."
    Write-Host "    Zugelassen ist ausschliesslich '$MODELL_ERLAUBT'."
    Write-Host "    Grund: der Ausfuehrende muss ein ANDERES Modell fahren als der Orchestrator,"
    Write-Host "    und zwar ein BENANNTES. Ein Auftrag gegen ein unbekanntes Modell liefert"
    Write-Host "    eine Lieferung, der man ihre Herkunft nicht ansieht."
    exit 1
}

$repo = Split-Path -Parent $PSScriptRoot
$auf = "AUF-$Nummer"
$wt = Join-Path $repo ".wt\$auf"
$wtWurzel = Join-Path $repo ".wt"
$zweig = "auf/$Nummer-$Kurzname"
$auftragDatei = "auftraege/$auf.md"
$lieferung = "auftraege/_ergebnisse/${auf}_lieferung.json"
$protokoll = Join-Path $repo "auftraege\_ergebnisse\${auf}_agentenlauf.txt"

# ================= KONFIGURATION DIESES PROJEKTS =================
# Vier Listen. Sie sind der einzige Ort, an dem dieses Skript weiss, WOMIT gearbeitet
# wird. Alles darunter ist projektunabhaengig.
#
# $wahrheitsQuellen  Dateien, deren SHA-256 gegen $manifestPfad gehalten wird, BEVOR
#                    etwas laeuft, und die schreibgeschuetzt in den Arbeitsort kommen.
#                    Eine Kopie ist erst dann die Quelle, wenn sie nachweislich
#                    dieselbe ist. Leer = keine gehashte Wahrheitsquelle; dann sagt
#                    Vorpruefung 4 ausdruecklich, dass sie NICHTS gemessen hat.
# $quellBaeume       Verzeichnisse, die in den Arbeitsort kopiert werden, weil git sie
#                    nicht auscheckt (gitignored). OHNE SIE SITZT DER AUSFUEHRENDE AUF
#                    LEEREM MATERIAL UND MERKT ES NICHT -- er liefert dann etwas
#                    Plausibles. Die Dateizahl wird nach dem Kopieren gegengeprueft.
# $einzelDateien     Einzelne gitignorierte Dateien, ohne Hash-Pruefung.
# $leerVerzeichnisse Werden LEER angelegt. Das ist kein Versehen: eine Write-Sperre auf
#                    ein Verzeichnis, das es nicht gibt, scheitert am fehlenden
#                    Verzeichnis statt an der Sperre -- das liest sich wie "die Sperre
#                    hat gehalten" und ist in Wahrheit "hier wurde nichts gemessen".
$manifestPfad      = ""
$manifestMuster    = 'SHA-256 \| `([0-9a-fA-F]{64})`'
$wahrheitsQuellen  = @()
# node_modules: 303,3 MB in 31.189 Dateien; Copy-Item braucht dafuer rund 17 Sekunden
# (gemessen 2026-09-22, robocopy zum Vergleich 23 s). OHNE diesen Baum kann der
# Ausfuehrende weder 'npm test' noch 'npx tsc' fahren -- die Achse 'getestet' des
# code-Profils waere damit fuer JEDEN Auftrag unerreichbar, und genau so stand es in
# composer-kit\projekte\klarzeit.json unter "_offen".
#
# *** KEINE JUNCTION STATT DER KOPIE. GEMESSEN, NICHT VERMUTET. ***
# 'git worktree remove --force' folgt einer Junction und LEERT ihr Ziel: 5 Dateien
# vorher, 0 danach, Exitcode 0, keine Warnung (2026-09-22, mit Wegwerfmaterial unter
# %TEMP% gemessen -- mit dem echten Baum waere die Messung ihr eigener Schaden
# gewesen). In hausverwaltung war nur bekannt, dass Junctions das Entfernen
# BLOCKIEREN; hier blockieren sie nicht, sie loeschen durch.
$quellBaeume       = @("node_modules")
$einzelDateien     = @()
$leerVerzeichnisse = @("dist", "docs")
# =================================================================

function Sagen($t) { Write-Host $t }
function Abbruch($t) { Write-Host ""; Write-Host "[!] ABBRUCH: $t"; exit 1 }

# Windows PowerShell 5.1 verpackt JEDE stderr-Zeile eines nativen Programms in einen
# ErrorRecord. Zusammen mit ErrorActionPreference = "Stop" bricht das den Lauf ab, BEVOR
# die eigene Pruefung ihr Urteil sprechen kann -- git meldet dann statt der
# Abbruchbegruendung einen PowerShell-Stapelauszug. Darum laufen alle nativen Aufrufe
# hier durch diese Huelle: Preference lokal auf Continue, Urteil nur am Exit-Code.
function Native {
    param([string]$Datei, [string[]]$Argumente)
    $ErrorActionPreference = "Continue"
    $aus = & $Datei @Argumente 2>&1 | Out-String
    return [pscustomobject]@{ Ausgabe = $aus; Code = $LASTEXITCODE }
}

# Pfad zum Ausfuehrenden und Uebernahme des Schluessels. An zwei Stellen gebraucht:
# Vorpruefung 2 und dem Selbsttest von Vorpruefung 7 (der ohne Auftragsdatei laeuft).
function Get-AgentPfad {
    $p = Join-Path $env:LOCALAPPDATA "cursor-agent\cursor-agent.cmd"
    if (-not (Test-Path $p)) { Abbruch "cursor-agent ist nicht installiert." }
    # Eine im Benutzerprofil gesetzte Variable erreicht LAUFENDE Prozesse nicht; sie wird
    # nur beim Prozessstart vererbt. Ohne diese Uebernahme scheitert der Agent mit
    # "Authentication required", obwohl der Schluessel gesetzt ist -- und Start-Process
    # vererbt genau diese Prozessumgebung an ihn.
    if (-not $env:CURSOR_API_KEY) {
        $u = [Environment]::GetEnvironmentVariable("CURSOR_API_KEY", "User")
        if ($u) { $env:CURSOR_API_KEY = $u }
    }
    return $p
}

<#
    DER MINI-LAUF -- das Messgeraet der Vorpruefung 7.

    WOGEGEN: im Schwesterprojekt (wikinger_one_new, AUF-005) konnte der Ausfuehrende
    KEINE Shell fahren. Alle 14 Befunde der Lieferung trugen 'gelesen' oder 'vermutet',
    kein einziges 'gemessen' -- und nichts im Ablauf hat das VOR dem Lauf bemerkt. Ein
    Auftrag, der Zaehlungen verlangt, ist unter dieser Bedingung sinnlos; er liefert dann
    Prosa, die wie ein Ergebnis aussieht.

    *** WARUM NICHT 'python -c "print(7*6)"' ***
    So stand es im Plan (docs\NEXT_SESSION.md, A.0): der Mini-Lauf solle 42 liefern.
    Das misst nichts. 7*6 rechnet jedes Sprachmodell im Kopf; die Antwort "42" ist mit
    "die Shell laeuft" und mit "es gibt gar keine Shell" gleich gut vertraeglich. Die
    Pruefung waere gruen in genau dem Fall, den sie fangen soll -- ein stiller Fehlschlag,
    der wie ein Ergebnis aussieht.

    STATTDESSEN: der SHA-256 eines Einmalworts, das dieses Skript erst beim Aufruf
    erzeugt. Er steht in keiner Datei, ist nicht zu erinnern und nicht zu erraten; ihn
    auszugeben verlangt zwingend einen ausgefuehrten Befehl. Die 42 wird trotzdem
    mitverlangt, aber nicht als Kriterium, sondern als DIAGNOSE: "42 da, Hash fehlt"
    heisst "der Ausfuehrende antwortet, ohne zu rechnen".

    Der Mini-Lauf laeuft in einem Wegwerf-Verzeichnis unter %TEMP%, nicht im Repo: er
    darf den Fingerabdruck nicht selbst bewegen. Die Rechtefassung wird ihm dorthin
    mitgegeben, damit er unter denselben Rechten misst wie der spaetere Lauf.
#>
function Start-MiniLauf {
    param(
        [Parameter(Mandatory = $true)][string]$Exe,
        [Parameter(Mandatory = $true)][string]$Rechte,
        [int]$MaxSekunden = 180
    )

    $nonce = [guid]::NewGuid().ToString('N')
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $soll = ([BitConverter]::ToString(
                    $sha.ComputeHash([Text.Encoding]::ASCII.GetBytes($nonce))) -replace '-', '').ToLower()
    } finally { $sha.Dispose() }

    $ort = Join-Path ([IO.Path]::GetTempPath()) ("auf_vp7_" + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Force (Join-Path $ort ".cursor") | Out-Null
    Copy-Item $Rechte (Join-Path $ort ".cursor\cli.json") -Force

    # EINE Zeile, und ohne Anfuehrungszeichen. Beides ist gemessen, nicht vorsorglich:
    #   - cursor-agent laeuft ueber cursor-agent.cmd, also ueber cmd.exe. Ein Argument mit
    #     eingebettetem Zeilenumbruch bricht dort nach der ERSTEN Zeile ab. Gemessen am
    #     2026-09-07: der Agent antwortete woertlich "Die Nachricht endet nach dem
    #     Doppelpunkt ohne die zwei konkreten Befehle" -- er hatte nur Zeile 1 bekommen.
    #   - Anfuehrungszeichen im Argument ueberleben dieselbe Kette nicht verlaesslich.
    #     Darum wird der Befehl beschrieben statt zitiert; bilden soll ihn der Agent.
    $text = ("Fuehre genau einen Shell-Befehl aus: berechne mit python den SHA-256 der " +
             "ASCII-Zeichenkette $nonce und gib den Hex-Wert aus. Nenne ausserdem das " +
             "Ergebnis von 7 mal 6. Rechne den Hash NICHT im Kopf und rate ihn nicht, " +
             "sondern fuehre den Befehl wirklich aus. Lege keine Datei an. Wird der Befehl " +
             "abgewiesen, gib den woertlichen Meldungstext zurueck und sonst nichts.")

    $argumente7 = @("--print", "--output-format", "text", "--model", $Modell,
                    "--workspace", $ort, "--trust", $text)

    $o = [IO.Path]::GetTempFileName()
    $e = [IO.Path]::GetTempFileName()
    # -WorkingDirectory: der Mini-Lauf soll unter DER Rechtefassung messen, die ihm
    # mitgegeben wurde. Ohne das erbt er das Arbeitsverzeichnis dieses Skripts (den
    # Repo-Stamm) -- und damit moeglicherweise eine ganz andere .cursor\cli.json.
    $pp = Start-Process -FilePath $Exe -ArgumentList $argumente7 -PassThru -NoNewWindow `
                        -WorkingDirectory $ort `
                        -RedirectStandardOutput $o -RedirectStandardError $e
    $fertig = $pp.WaitForExit($MaxSekunden * 1000)
    if (-not $fertig) {
        # NUR ueber die selbst erzeugte PID, nie ueber einen Namen.
        $null = Native taskkill @("/F", "/T", "/PID", "$($pp.Id)")
        Start-Sleep -Milliseconds 500
    }
    $aus = (@(Get-Content $o -ErrorAction SilentlyContinue) +
            @(Get-Content $e -ErrorAction SilentlyContinue)) -join "`n"
    Remove-Item $o, $e -Force -ErrorAction SilentlyContinue
    Remove-Item $ort -Recurse -Force -ErrorAction SilentlyContinue

    return [pscustomobject]@{
        Nonce    = $nonce
        Soll     = $soll
        Ausgabe  = $aus
        Fertig   = $fertig
        HashDa   = [bool]($aus -match [regex]::Escape($soll))
        VierZwei = [bool]($aus -match '(^|[^0-9])42([^0-9]|$)')
        Ort      = $ort
    }
}

# --------------------------------------------- WELCHE LAEUFE GERADE AKTIV SIND
<#
    MEHRERE AUSFUEHRENDE GLEICHZEITIG -- und warum der Fingerabdruck davon wissen muss.

    Bis zum 2026-09-07 nahm Get-Fingerabdruck genau EINEN Lauf an: aus der
    .wt-Nachbarschaft wurde nur der EIGENE Arbeitsort ausgenommen, aus 'git status' nur
    das EIGENE Protokoll. Startete daneben ein zweiter Auftrag, meldete jeder der beiden
    den anderen als Ausbruch -- zu Unrecht. Das Hindernis fuer mehrere Ausfuehrende war
    also nie eine Regel, sondern dieses Messgeraet.

    DIE QUELLE IST GIT SELBST ('git worktree list --porcelain'), keine gepflegte Liste
    und keine Zustandsdatei. Das ist Absicht und traegt die ganze Sicherheitsaussage:
    ein Verzeichnis unter .wt\, das KEIN registrierter Worktree ist, bleibt ein Ausbruch.
    Ein Ausfuehrender kann sich auch keinen eintragen -- 'Shell(git worktree)' steht auf
    der deny-Liste, und bei Shell wirkt die allow-Liste abschliessend (in AUF-000 und
    AUF-001 gemessen).

    WAS DAS SCHWAECHT, ausdruecklich und ohne Beschoenigung: solange AUF-nnn laeuft, ist
    re\_ergebnisse\AUF-nnn_agentenlauf.txt im Hauptbaum vom Vergleich ausgenommen. Wer
    dort hineinschreibt, wird nicht gesehen. Das galt vorher schon fuer den eigenen Lauf
    -- dieses Skript schreibt die Datei selbst --, neu ist allein, dass es fuer N Laeufe
    gilt statt fuer einen. Alles andere im Hauptbaum wird unveraendert gemessen, und ein
    Protokollname OHNE zugehoerigen aktiven Worktree wird gemeldet (Positiv-Kontrolle 3
    in -SelbsttestParallel).
#>
function Get-AktiveLaeufe {
    $namen = @()
    $r = Native git @("-C", $repo, "worktree", "list", "--porcelain")
    foreach ($z in ($r.Ausgabe -split "`n")) {
        if ($z -match '^worktree\s+(.+)$') {
            $pfad = $Matches[1].Trim()
            if (-not $pfad) { continue }
            $eltern = Split-Path -Parent $pfad
            if ($eltern -and (Split-Path -Leaf $eltern) -eq ".wt") {
                $namen += (Split-Path -Leaf $pfad)
            }
        }
    }
    return @($namen | Sort-Object -Unique)
}

# ------------------------------------------------- DER FINGERABDRUCK
# Steht hier oben und nicht erst hinter den Vorpruefungen, weil -SelbsttestParallel ihn
# braucht -- und der darf nicht verlangen, dass die Leine scharf ist.
function Get-Fingerabdruck {
    $aktive = Get-AktiveLaeufe
    $st = (Native git @("-C", $repo, "status", "--porcelain")).Ausgabe
    # Die Protokolle der AKTIVEN Laeufe ausnehmen -- die legen die Skripte selbst an.
    # Der eigene ist immer dabei, auch bevor sein Worktree steht (Vorpruefung 7 laeuft
    # vorher und nimmt bereits einen Fingerabdruck).
    $eigene = @(@($auf) + $aktive | Sort-Object -Unique)
    $st = ($st -split "`n" | Where-Object {
               $zeile = $_
               -not ($eigene | Where-Object { $zeile -match [regex]::Escape("${_}_agentenlauf.txt") })
           }) -join "`n"
    $aussen = @()
    if (Test-Path $wtWurzel) {
        # Ausgenommen sind ALLE registrierten Worktrees, nicht nur der eigene. Was sonst
        # unter .wt\ auftaucht -- ein blosses Verzeichnis, eine Datei --, bleibt Ausbruch.
        $aussen = @(Get-ChildItem $wtWurzel -Force -ErrorAction SilentlyContinue |
                    Where-Object { $aktive -notcontains $_.Name } |
                    ForEach-Object { $_.Name } | Sort-Object)
    }
    # Die blinden Baeume. Ohne sie waere der Fingerabdruck genau dort taub, wo dieses
    # Repo nachweislich hinschreibt.
    $blind = (Native "python" @("-u", (Join-Path $repo "tools\blindbaum.py"))).Ausgabe.Trim()
    return [pscustomobject]@{
        Status = $st.Trim()
        Aussen = ($aussen -join " | ")
        Quellen = (($wahrheitsQuellen | ForEach-Object {
                        $q = Join-Path $repo $_
                        if (Test-Path $q) { "$_  " + (Get-FileHash $q -Algorithm SHA256).Hash.ToUpper() }
                        else { "$_  FEHLT" }
                    }) -join "`n")
        Blind  = $blind
    }
}

# Der Vergleich zweier Fingerabdruecke. Steht als Funktion da, weil er ZWEIMAL gebraucht
# wird: nach dem Mini-Lauf der Vorpruefung 7 und nach dem eigentlichen Lauf. Beide starten
# einen Agenten; beide muessen darum gemessen werden.
<#
    DIE ARBEIT DES AUSFUEHRENDEN SICHERN -- ALS PATCH.

    WARUM SIE SONST VERLORENGEHT: der Ausfuehrende darf NICHT committen
    ('Shell(git commit)' steht auf deny, und das bleibt so -- die Historie gehoert dem
    Orchestrator). Seine Aenderungen liegen damit ausschliesslich als uncommitted
    changes im Arbeitsort. 'git worktree remove --force' nimmt sie restlos mit und
    meldet dabei sogar beruhigend "Zweig geloescht (keine eigenen Commits)".

    *** GEMESSEN AM 2026-09-22, AUF-004 ***
    Genau so ist ein vollstaendig abgenommener Code-Auftrag vernichtet worden: Lieferung,
    Protokolle und Abnahme (Exit 0) lagen gesichert im Hauptbaum, der Code war weg --
    243 geaenderte Zeilen in 10 Dateien, darunter ein neuer Migrationstest. Die Sicherung
    der Lieferung allein SIEHT AUS WIE eine Sicherung und ist keine.

    'git add -A' laeuft NUR im Arbeitsort und beruehrt nur dessen Index; der wird ohnehin
    gleich geloescht. Ohne ihn fehlten im Patch alle NEUEN Dateien -- und gerade neue
    Tests sind das Wertvollste an einem Code-Auftrag.

    'git diff --output=' laesst GIT die Datei schreiben, nicht PowerShell: Out-File
    haengt unter 5.1 eine BOM an und normalisiert Zeilenenden, und beides macht einen
    Patch fuer 'git apply' unbrauchbar.
#>
function Arbeit-Sichern {
    # Rueckgabe: $true = gesichert (oder nichts zu sichern), $false = NICHT gesichert.
    param([string]$Ort, [string]$Ziel)
    if (-not (Test-Path $Ort)) { return $true }
    # NUR DER EIGENE ARBEITSBAUM (klarzeit AUF-010). Ein verknuepfter Worktree traegt in
    # seiner Wurzel eine DATEI .git. Ein leerer Restordner nach gescheitertem 'worktree
    # remove' besteht Test-Path, hat sie aber nicht -- 'git -C' lief dann nach oben in den
    # HAUPTBAUM ('rev-parse --show-toplevel' = Hauptbaum, gemessen), 'git add -A' wirkte
    # dort, und der Patch wurde ueberschrieben.
    if (-not (Test-Path (Join-Path $Ort ".git") -PathType Leaf)) {
        Sagen "  [!] $Ort ist kein Arbeitsbaum (keine Datei .git) -- NICHTS gesichert, nichts veraendert."
        return $false
    }
    $null = Native git @("-C", $Ort, "add", "-A")
    New-Item -ItemType Directory -Force (Split-Path -Parent $Ziel) | Out-Null
    # NIE UEBERSCHREIBEN (klarzeit AUF-009 und AUF-026). Hat der Orchestrator auf dem
    # Auftragszweig committet, diffed ein zweiter Aufruf (-Aufraeumen) gegen den neuen HEAD
    # und machte aus dem Patch den Rest: 22.742 -> 2.162 und 14.370 -> 2.162 Bytes. Gibt es
    # die Datei schon, kommt der neue Patch mit Zeitstempel daneben; gleicher Inhalt faellt weg.
    $schreib = $Ziel
    if (Test-Path $Ziel) {
        $schreib = Join-Path (Split-Path -Parent $Ziel) ([IO.Path]::GetFileNameWithoutExtension($Ziel) +
            "." + (Get-Date -Format "yyyyMMdd-HHmmss") + ".patch")
        if (Test-Path $schreib) { Sagen "  [!] $(Split-Path -Leaf $schreib) gibt es schon -- NICHTS gesichert."; return $false }
    }
    $r = Native git @("-C", $Ort, "diff", "--cached", "HEAD", "--output=$schreib")
    if ($r.Code -ne 0) {
        Sagen "  [!] Patch konnte nicht gebildet werden -- die Arbeit ist NICHT gesichert:"
        Sagen "      $($r.Ausgabe.Trim())"
        return $false
    }
    if (-not (Test-Path $schreib)) { Sagen "  [!] Patchdatei fehlt nach dem Schreiben."; return $false }
    $gr = (Get-Item $schreib).Length
    if ($schreib -ne $Ziel) {
        if ((Get-FileHash $schreib).Hash -eq (Get-FileHash $Ziel).Hash) {
            Remove-Item $schreib
            Sagen "  Arbeit unveraendert          : $(Split-Path -Leaf $Ziel)  ($gr Bytes, schon gesichert)"
        } else {
            Sagen "  [!] Patch weicht vom gesicherten ab -- NICHT ueberschrieben:"
            Sagen "      bisher : $(Split-Path -Leaf $Ziel)  ($((Get-Item $Ziel).Length) Bytes)"
            Sagen "      neu    : $(Split-Path -Leaf $schreib)  ($gr Bytes)"
        }
        return $true
    }
    if ($gr -eq 0) {
        Sagen "  Arbeit des Ausfuehrenden     : KEINE Aenderung ausserhalb der Ergebnisse."
    } else {
        Sagen "  Arbeit gesichert             : $(Split-Path -Leaf $Ziel)  ($gr Bytes Patch)"
    }
    return $true
}

<#
    DER LEERE RESTORDNER (klarzeit AUF-043, Befund x).

    'git worktree remove --force' leert den Arbeitsort und scheitert an seiner Wurzel, wenn ein
    Prozess sie als Arbeitsverzeichnis hat ("failed to delete ...: Permission denied") -- in
    AUF-043 die Shell des Orchestrators nach einem 'cd' dorthin. Zurueck bleibt ein leerer Ordner
    ohne Datei .git; den Eintrag unter .git/worktrees loescht git trotzdem (gemessen 2026-11-19).
    Bis dahin brach -Aufraeumen dort ab, vor 'prune' und dem Zweig -- und jeder weitere Lauf
    ebenso, weil Arbeit-Sichern einen Ordner ohne .git zu Recht nicht anfasst (Befund b). Es half
    nur Handarbeit.

    Ein Ordner OHNE JEDEN Eintrag, auch ohne versteckten, traegt keine Arbeit mehr: er wird
    entfernt, nie rekursiv, und es geht weiter mit 'prune' und dem Zweig. Alles andere bleibt beim
    alten Weg -- sichern oder abbrechen.
#>
function Leerer-Rest {
    # $true nur fuer einen Ordner ohne jeden Eintrag. -Force zaehlt versteckte mit: die Datei .git
    # eines Worktrees kann versteckt sein. Laesst sich der Ordner nicht lesen: $false.
    param([string]$Ort)
    if (-not (Test-Path -LiteralPath $Ort -PathType Container)) { return $false }
    try { return (@(Get-ChildItem -LiteralPath $Ort -Force -ErrorAction Stop).Count -eq 0) } catch { return $false }
}

function Rest-Entfernen {
    # Nie rekursiv: [IO.Directory]::Delete(..., $false) entfernt nur einen leeren Ordner und wirft bei
    # allem anderen. Wirft es, bleibt der Ordner stehen, und es geht trotzdem weiter -- er ist leer.
    param([string]$Ort)
    try {
        [IO.Directory]::Delete($Ort, $false)
        Sagen "  Leeren Restordner entfernt: $Ort"
    } catch {
        Sagen "  [!] Der leere Ordner $Ort bleibt stehen: $($_.Exception.Message)"
        Sagen "      Steht ein Prozess darin (eine Shell nach 'cd' dorthin)? Danach -Aufraeumen noch einmal"
        Sagen "      oder von Hand: Remove-Item -LiteralPath '$Ort'   (ohne -Recurse)."
    }
}

function Vergleich {
    param($v, $n)
    $ausbruch = @()
    if ($n.Quellen -ne $v.Quellen) {
        $ausbruch += "EINE WAHRHEITSQUELLE WURDE VERAENDERT:"
        $a = @($v.Quellen -split "`n"); $b = @($n.Quellen -split "`n")
        for ($i = 0; $i -lt [Math]::Max($a.Count, $b.Count); $i++) {
            $x = if ($i -lt $a.Count) { $a[$i].Trim() } else { "(fehlt)" }
            $y = if ($i -lt $b.Count) { $b[$i].Trim() } else { "(fehlt)" }
            if ($x -ne $y) { $ausbruch += "  vorher : $x"; $ausbruch += "  nachher: $y" }
        }
    }
    if ($n.Status -ne $v.Status) {
        $ausbruch += "Der Hauptarbeitsbaum hat sich veraendert. git status vorher/nachher:"
        $ausbruch += "  vorher : " + $(if ($v.Status) { $v.Status -replace "`n", " ; " } else { "(sauber)" })
        $ausbruch += "  nachher: " + $(if ($n.Status) { $n.Status -replace "`n", " ; " } else { "(sauber)" })
    }
    if ($n.Aussen -ne $v.Aussen) {
        $ausbruch += "Neben dem Arbeitsort ist etwas entstanden: $($n.Aussen)"
    }
    if ($n.Blind -ne $v.Blind) {
        $ausbruch += "EIN BLINDER BAUM HAT SICH BEWEGT -- das sieht 'git status' nicht:"
        $a = @($v.Blind -split "`n"); $b = @($n.Blind -split "`n")
        for ($i = 0; $i -lt [Math]::Max($a.Count, $b.Count); $i++) {
            $x = if ($i -lt $a.Count) { $a[$i].Trim() } else { "(fehlt)" }
            $y = if ($i -lt $b.Count) { $b[$i].Trim() } else { "(fehlt)" }
            if ($x -ne $y) { $ausbruch += "  vorher : $x"; $ausbruch += "  nachher: $y" }
        }
    }
    return $ausbruch
}

# ---------------------------------------------------------------- AUFRAEUMEN
if ($Aufraeumen) {
    # 0  EIN LEERER RESTORDNER (Befund x, siehe Leerer-Rest): nichts darin zu sichern, nur entfernen.
    # 1  DIE LIEFERUNG ZUERST SICHERN. Sie liegt NUR im Arbeitsort -- 'worktree remove
    #    --force' nimmt sie mit, und dann ist der Beleg weg, waehrend das Protokoll im
    #    Hauptbaum stehenbleibt und so aussieht, als sei alles da.
    if (Leerer-Rest $wt) {
        Sagen "  Leerer Restordner .wt\$auf (kein Eintrag, keine Datei .git) -- nichts zu sichern."
        Rest-Entfernen $wt
    } elseif (Test-Path $wt) {
        $wtErg = Join-Path $wt "auftraege\_ergebnisse"
        $hauptErg = Join-Path $repo "auftraege\_ergebnisse"
        if (Test-Path $wtErg) {
            New-Item -ItemType Directory -Force $hauptErg | Out-Null
            $gerettet = 0
            foreach ($d in (Get-ChildItem $wtErg -File -ErrorAction SilentlyContinue)) {
                $ziel = Join-Path $hauptErg $d.Name
                if (-not (Test-Path $ziel)) {
                    Copy-Item $d.FullName $ziel -Force
                    $gerettet++
                    Sagen "  gesichert: $($d.Name)"
                }
            }
            if ($gerettet -eq 0) { Sagen "  Nichts zu sichern (alles liegt schon im Hauptbaum)." }
        }
        # 1a DIE PROBE SICHERN (lohnradar-azure S3 gemessen, S7 zurueckgefuehrt). Auch unter
        #    auftraege/_probe/ legt ein Ausfuehrender Belege ab -- Kopien fuer Mutanten,
        #    Probeausgaben. 'worktree remove --force' nahm sie mit; dort wurden sie bis S7 von
        #    Hand nach auftraege/_ergebnisse/<auf>_probe/ kopiert. quellbaum_kopieren.py kopiert Links
        #    als Links und bricht bei einem Link ab, der aus dem Ziel herausfuehrt; dann bleibt
        #    der Arbeitsort stehen und nichts ist verloren.
        $wtProbe = Join-Path $wt "auftraege\_probe"
        $probeZiel = Join-Path $repo ("auftraege\_ergebnisse\" + $auf + "_probe")
        $probeInhalt = @(Get-ChildItem $wtProbe -Force -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -ne ".gitkeep" })
        if ($probeInhalt.Count -eq 0) {
            Sagen "  Probe leer -- nichts zu sichern."
        } elseif (Test-Path $probeZiel) {
            Abbruch "$probeZiel gibt es schon; der Arbeitsort bleibt stehen. Erst ansehen, dann umbenennen oder entfernen."
        } else {
            $k = Native "python" @("-u", (Join-Path $repo "tools\quellbaum_kopieren.py"), $wtProbe, $probeZiel, $probeZiel)
            if ($k.Code -ne 0) {
                # Die Dateien kopiert quellbaum_kopieren.py vor den Links: unter $probeZiel steht
                # dann eine Teilkopie. Sie bleibt stehen -- ein rekursives Loeschen muesste
                # Verzeichnis-Links sicher auslassen, und das prueft hier niemand.
                Abbruch "Probe nicht vollstaendig gesichert (Exit $($k.Code)); $probeZiel enthaelt eine Teilkopie, der Arbeitsort bleibt stehen:`n$($k.Ausgabe)"
            }
            Sagen "  gesichert: auftraege/_probe/ -> auftraege/_ergebnisse/${auf}_probe/ ($($probeInhalt.Count) Eintraege oben)"
        }
        # 1b DIE ARBEIT SICHERN, bevor der Worktree faellt. Siehe Arbeit-Sichern: der
        #    Ausfuehrende kann nicht committen, sein Code lebt nur hier. Ist sie NICHT
        #    gesichert, bleibt der Arbeitsort stehen -- 'worktree remove --force' naehme sie mit.
        if (-not (Arbeit-Sichern -Ort $wt -Ziel (Join-Path $repo "auftraege\_ergebnisse\${auf}_arbeit.patch"))) {
            Abbruch "Die Arbeit ist nicht gesichert; der Arbeitsort bleibt stehen. Erst ansehen, dann von Hand sichern oder entfernen."
        }
        Sagen "  Worktree entfernen: .wt\$auf"
        $r = Native git @("-C", $repo, "worktree", "remove", "--force", ".wt/$auf")
        if ($r.Code -ne 0) {
            # Befund x: Hat git den Arbeitsort geleert und nur die Wurzel nicht geloescht, ist die
            # Arbeit oben gesichert und nichts mehr darin -- weiter mit 'prune' und dem Zweig.
            if (-not (Leerer-Rest $wt)) { Abbruch "git worktree remove ging nicht durch:`n$($r.Ausgabe)" }
            Sagen "  [!] git worktree remove ging nicht ganz durch, der Arbeitsort ist aber leer:"
            Sagen "      $($r.Ausgabe.Trim())"
            Rest-Entfernen $wt
        }
    } else {
        Sagen "  Kein Worktree unter .wt\$auf -- nichts zu entfernen."
    }
    $null = Native git @("-C", $repo, "worktree", "prune")

    # 2  DEN ZWEIG SUCHEN, NICHT RATEN. -Aufraeumen wird ueblicherweise OHNE -Kurzname
    #    aufgerufen; $zweig traegt dann den Vorgabewert und meint einen Zweig, den es nie
    #    gab -- waehrend der echte stehen bleibt und den naechsten Lauf mit
    #    "a branch named 'auf/000-leine' already exists" blockiert.
    #    GEMESSEN AM 2026-09-09 in gamedesign, zweiter Anlauf von AUF-000: genau das trat
    #    ein, nachdem ein Abbruch nach 'worktree add' den Zweig hinterlassen hatte.
    $gefunden = @()
    $r = Native git @("-C", $repo, "branch", "--list", "auf/$Nummer-*")
    foreach ($z in ($r.Ausgabe -split "`n")) {
        $z = $z.TrimStart('*', ' ').Trim()
        if ($z) { $gefunden += $z }
    }
    if ($gefunden.Count -eq 0) {
        Sagen "  Kein Zweig auf/$Nummer-* vorhanden."
    } else {
        foreach ($z in $gefunden) {
            # Nur loeschen, was KEINE eigenen Commits traegt. Ein Zweig mit Arbeit darauf
            # bleibt stehen und wird gemeldet -- Aufraeumen darf nichts vernichten.
            $r = Native git @("-C", $repo, "rev-list", "--count", "HEAD..$z")
            $eigene = 0
            [void][int]::TryParse($r.Ausgabe.Trim(), [ref]$eigene)
            if ($eigene -gt 0) {
                Sagen "  [!] Zweig $z traegt $eigene eigene(n) Commit(s) und BLEIBT stehen."
                continue
            }
            $d = Native git @("-C", $repo, "branch", "-D", $z)
            if ($d.Code -eq 0) { Sagen "  Zweig geloescht: $z  (keine eigenen Commits)" }
            else { Sagen "  Zweig $z liess sich NICHT loeschen:"; Sagen $d.Ausgabe }
        }
    }
    Sagen "  Die Lieferung unter auftraege/_ergebnisse/ bleibt -- sie ist der Beleg."
    exit 0
}

# ------------------------------------------------- SELBSTTEST DER VORPRUEFUNG 7
# Eine Pruefung, die niemand rot bekommen hat, ist selbst ungeprueft (dasselbe Prinzip
# wie tools\gate_probe.py und tools\tracker_probe.py). Hier wird nicht der Code mutiert,
# sondern die EINGABE: dieselbe Pruefung laeuft zweimal, einmal mit der scharfen
# Rechtefassung und einmal mit einer, der Shell(python) fehlt.
#   Positiv-Kontrolle: mit der AN-Fassung MUSS der Hash kommen.
#   Negativ-Kontrolle: ohne Shell(python) darf er NICHT kommen -- die allow-Liste wirkt
#                      abschliessend (in AUF-000 gemessen: 'git log' steht auf keiner
#                      Liste und wurde mit 'Rejected:' abgewiesen).
# Faellt die Negativ-Kontrolle durch, prueft Vorpruefung 7 nicht die Ausfuehrbarkeit,
# sondern gar nichts.
if ($Selbsttest7) {
    Sagen ""
    Sagen "  Selbsttest der Vorpruefung 7 -- kann sie rot werden?"
    Sagen ("  " + ("-" * 66))
    $exe = Get-AgentPfad
    $an = Join-Path $repo ".cursor\cli.an.json"
    if (-not (Test-Path $an)) { Abbruch ".cursor\cli.an.json fehlt." }

    # Die Negativ-Fassung: dieselbe Leine, ohne Shell(python).
    $j = Get-Content $an -Raw | ConvertFrom-Json
    $vorZahl = @($j.permissions.allow).Count
    $j.permissions.allow = @($j.permissions.allow | Where-Object { $_ -ne "Shell(python)" })
    $nachZahl = @($j.permissions.allow).Count
    if ($nachZahl -ne ($vorZahl - 1)) {
        Abbruch "Die Negativ-Fassung unterscheidet sich nicht von der AN-Fassung (allow $vorZahl -> $nachZahl). Der Selbsttest wuerde zweimal dasselbe messen."
    }
    $ohne = Join-Path ([IO.Path]::GetTempPath()) ("auf_vp7_ohne_python_" + [guid]::NewGuid().ToString('N').Substring(0, 8) + ".json")
    $j | ConvertTo-Json -Depth 8 | Set-Content $ohne -Encoding utf8
    Sagen "  Werkzeugkontrolle: allow $vorZahl -> $nachZahl (Shell(python) entfernt)"

    Sagen ""
    Sagen "  1/2  Positiv-Kontrolle (AN-Fassung) laeuft ..."
    $pos = Start-MiniLauf -Exe $exe -Rechte $an
    Sagen "       Einmalwort $($pos.Nonce.Substring(0,8))...  Hash da: $($pos.HashDa)  42 da: $($pos.VierZwei)  fertig: $($pos.Fertig)"

    Sagen ""
    Sagen "  2/2  Negativ-Kontrolle (ohne Shell(python)) laeuft ..."
    $neg = Start-MiniLauf -Exe $exe -Rechte $ohne
    Sagen "       Einmalwort $($neg.Nonce.Substring(0,8))...  Hash da: $($neg.HashDa)  42 da: $($neg.VierZwei)  fertig: $($neg.Fertig)"
    Remove-Item $ohne -Force -ErrorAction SilentlyContinue

    Sagen ""
    Sagen ("  " + ("-" * 66))
    $fehler = @()
    if (-not $pos.HashDa) { $fehler += "Positiv-Kontrolle: der Hash kam NICHT. Vorpruefung 7 wuerde jeden Lauf abbrechen." }
    if ($neg.HashDa) { $fehler += "Negativ-Kontrolle: der Hash kam TROTZ entzogener Shell(python). Vorpruefung 7 misst nicht die Ausfuehrbarkeit." }
    if ($fehler.Count -gt 0) {
        Sagen "  [!] SELBSTTEST GESCHEITERT:"
        $fehler | ForEach-Object { Sagen "      $_" }
        Sagen ""
        Sagen "  Ausgabe der Positiv-Kontrolle:"
        ($pos.Ausgabe -split "`n") | ForEach-Object { Sagen "      $_" }
        Sagen ""
        Sagen "  Ausgabe der Negativ-Kontrolle:"
        ($neg.Ausgabe -split "`n") | ForEach-Object { Sagen "      $_" }
        exit 1
    }
    Sagen "  [x] Selbsttest bestanden: die Pruefung schlaegt an, wo sie soll, und nur dort."
    Sagen "      Mit Shell(python)  : Hash geliefert"
    Sagen "      Ohne Shell(python) : kein Hash (42 im Text: $($neg.VierZwei) -- genau darum"
    Sagen "                           ist 42 kein Kriterium, sondern nur Diagnose)"
    Sagen ""
    exit 0
}

# ------------------------------- SELBSTTEST: MEHRERE LAEUFE NEBENEINANDER
# Der Fingerabdruck ist seit dem 2026-09-07 NACHSICHTIGER: er nimmt die Arbeitsorte und
# Protokolle ALLER aktiven Laeufe aus, nicht nur die des eigenen. Ein Messgeraet zu
# lockern, ohne zu pruefen, ob es noch rot werden kann, ist genau der Fehler, gegen den
# dieses ganze Verfahren gebaut ist -- 'gruen' saehe danach aus wie vorher.
#   Null-Diff          : zwei Messungen desselben Standes muessen gleich sein.
#   Werkzeug-Kontrolle : Get-AktiveLaeufe findet einen frisch angelegten Worktree.
#   Negativ-Kontrolle  : ein REGISTRIERTER zweiter Arbeitsort loest KEINEN Ausbruch aus
#                        -- sonst ist kein zweiter Lauf moeglich.
#   Positiv 1          : ein blosses Verzeichnis unter .wt\ loest einen aus.
#   Positiv 2          : eine fremde Datei im Hauptbaum loest einen aus.
#   Positiv 3          : das Protokoll eines NICHT aktiven Laufs loest einen aus -- die
#                        Lockerung ist an einen lebenden Worktree gebunden, nicht an den
#                        Dateinamen.
# Dieser Selbsttest startet KEINEN Agenten und braucht die Leine nicht.
if ($SelbsttestParallel) {
    Sagen ""
    Sagen "  Selbsttest: mehrere Ausfuehrende nebeneinander"
    Sagen "  (kann der gelockerte Fingerabdruck noch rot werden?)"
    Sagen ("  " + ("-" * 66))

    $pNr   = "AUF-999"
    $pZw   = "auf/999-selbsttest"
    $pWt   = Join-Path $wtWurzel $pNr
    $pDir  = Join-Path $wtWurzel "_probe_kein_worktree"
    $pDat  = Join-Path $repo "re\_ergebnisse\_probe_fremd.txt"
    $pProt = Join-Path $repo "re\_ergebnisse\AUF-998_agentenlauf.txt"
    $fehler = @()

    if (Test-Path $pWt)   { Abbruch "$pWt gibt es schon. Der Selbsttest legt ihn selbst an." }
    if (Test-Path $pDat)  { Abbruch "$pDat gibt es schon." }
    if (Test-Path $pProt) { Abbruch "$pProt gibt es schon." }

    try {
        $grund = Get-Fingerabdruck
        Sagen "  Grundlinie: Nachbarschaft '$($grund.Aussen)', aktiv: $((Get-AktiveLaeufe) -join ', ')"

        # --- Null-Diff: streut das Messgeraet ohne jede Aenderung? -----------------
        if ((Vergleich $grund (Get-Fingerabdruck)).Count -ne 0) {
            $fehler += "NULL-DIFF: zwei Messungen desselben unveraenderten Standes sind verschieden. Jeder Vorher/Nachher-Vergleich misst dann Rauschen, nicht Wirkung."
        } else { Sagen "  Null-Diff                       : PASS" }

        # --- Werkzeug- und Negativ-Kontrolle: ein REGISTRIERTER zweiter Arbeitsort --
        $r = Native git @("-C", $repo, "worktree", "add", "-b", $pZw, ".wt/$pNr", "HEAD")
        if ($r.Code -ne 0) { throw "git worktree add fuer den Selbsttest ging nicht durch:`n$($r.Ausgabe)" }
        $aktiv = Get-AktiveLaeufe
        if ($aktiv -notcontains $pNr) {
            $fehler += "WERKZEUG-KONTROLLE: Get-AktiveLaeufe findet den frisch angelegten Worktree $pNr nicht (gefunden: $($aktiv -join ', ')). Alles Folgende misst dann etwas anderes als gedacht."
        } else { Sagen "  Werkzeug-Kontrolle              : PASS (aktiv: $($aktiv -join ', '))" }

        $mitWt = Get-Fingerabdruck
        if ((Vergleich $grund $mitWt).Count -ne 0) {
            $fehler += "NEGATIV-KONTROLLE: ein REGISTRIERTER zweiter Arbeitsort gilt als Ausbruch. Damit ist kein zweiter Lauf neben einem ersten moeglich -- genau der Zustand, den dieser Umbau beseitigen sollte."
        } else { Sagen "  Negativ-Kontrolle (2. Lauf)     : PASS -- kein Ausbruch gemeldet" }

        # --- Positiv 1: ein Verzeichnis unter .wt\, das KEIN Worktree ist ----------
        New-Item -ItemType Directory -Force $pDir | Out-Null
        if (((Vergleich $mitWt (Get-Fingerabdruck)) -join " ") -notmatch "Neben dem Arbeitsort") {
            $fehler += "POSITIV-KONTROLLE 1: ein blosses Verzeichnis unter .wt\ wird NICHT gemeldet. Der Fingerabdruck nimmt dann alles aus, was dort liegt."
        } else { Sagen "  Positiv-Kontrolle 1 (Ordner)    : PASS -- gemeldet" }
        Remove-Item $pDir -Recurse -Force

        # --- Positiv 2: eine fremde Datei im Hauptbaum -----------------------------
        Set-Content $pDat "Selbsttest -SelbsttestParallel" -Encoding utf8
        if (((Vergleich $mitWt (Get-Fingerabdruck)) -join " ") -notmatch "Hauptarbeitsbaum") {
            $fehler += "POSITIV-KONTROLLE 2: eine neue Datei im Hauptbaum wird NICHT gemeldet. Der Statusvergleich ist blind."
        } else { Sagen "  Positiv-Kontrolle 2 (Datei)     : PASS -- gemeldet" }
        Remove-Item $pDat -Force

        # --- Positiv 3: Protokollname OHNE aktiven Worktree ------------------------
        # AUF-998 hat keinen Arbeitsort. Wuerde die Ausnahme am blossen Dateinamen
        # haengen statt am lebenden Worktree, waere sie unbegrenzt.
        Set-Content $pProt "Selbsttest -SelbsttestParallel" -Encoding utf8
        if (((Vergleich $mitWt (Get-Fingerabdruck)) -join " ") -notmatch "Hauptarbeitsbaum") {
            $fehler += "POSITIV-KONTROLLE 3: das Protokoll eines NICHT aktiven Laufs (AUF-998) wird ausgenommen. Die Lockerung haengt dann am Dateinamen statt am lebenden Worktree und ist unbegrenzt."
        } else { Sagen "  Positiv-Kontrolle 3 (Protokoll) : PASS -- gemeldet" }
        Remove-Item $pProt -Force
    }
    finally {
        Remove-Item $pDir  -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item $pDat  -Force -ErrorAction SilentlyContinue
        Remove-Item $pProt -Force -ErrorAction SilentlyContinue
        if (Test-Path $pWt) {
            $null = Native git @("-C", $repo, "worktree", "remove", "--force", ".wt/$pNr")
        }
        $null = Native git @("-C", $repo, "worktree", "prune")
        $rb = Native git @("-C", $repo, "branch", "--list", $pZw)
        if ($rb.Ausgabe.Trim()) { $null = Native git @("-C", $repo, "branch", "-D", $pZw) }
    }

    # --- Werkzeug-Kontrolle zum Schluss: der Selbsttest darf nichts hinterlassen ---
    $rest = @()
    if (Test-Path $pWt)   { $rest += "der Worktree $pWt steht noch" }
    if (Test-Path $pDir)  { $rest += "das Verzeichnis $pDir steht noch" }
    if (Test-Path $pDat)  { $rest += "die Datei $pDat steht noch" }
    if (Test-Path $pProt) { $rest += "die Datei $pProt steht noch" }
    if ((Native git @("-C", $repo, "branch", "--list", $pZw)).Ausgabe.Trim()) {
        $rest += "der Zweig $pZw steht noch"
    }
    if ((Get-AktiveLaeufe) -contains $pNr) { $rest += "$pNr gilt weiterhin als aktiver Lauf" }
    if ($rest.Count -gt 0) {
        $fehler += ("WERKZEUG-KONTROLLE (Aufraeumen): " + ($rest -join "; ") +
                    ". Ein Selbsttest, der etwas liegen laesst, verfaelscht jede spaetere Messung.")
    } else { Sagen "  Werkzeug-Kontrolle (Aufraeumen) : PASS -- nichts liegengeblieben" }

    Sagen ""
    if ($fehler.Count -gt 0) {
        Sagen "  [!] SELBSTTEST GESCHEITERT:"
        $fehler | ForEach-Object { Sagen "      - $_" }
        Sagen ""
        exit 1
    }
    Sagen "  [x] Selbsttest bestanden: der Fingerabdruck laesst mehrere REGISTRIERTE"
    Sagen "      Arbeitsorte zu und meldet weiterhin alles andere."
    Sagen "      Ausdruecklich NICHT gedeckt: wer waehrend eines Laufs in das Protokoll"
    Sagen "      eines ANDEREN aktiven Laufs schreibt, wird nicht gesehen."
    Sagen ""
    exit 0
}

# ------------------------------------------------------------ VORPRUEFUNG 1-7
# Ein Startskript, das auf halbem Weg abbricht, hinterlaesst einen halben Worktree und
# einen Agenten, der mit der falschen Grundlage arbeitet. Alle Bedingungen stehen darum
# VOR der ersten Veraenderung.
# 1-6 stehen hier, 7 steht weiter unten -- sie braucht den Fingerabdruck, weil sie als
# einzige Vorpruefung selbst einen Agenten startet.
Sagen ""
Sagen "  $auf -- Vorpruefung"
Sagen ("  " + ("-" * 66))

# 1  Der Auftrag existiert UND ist versioniert und sauber. Ein nicht committeter Auftrag
#    waere im Worktree nicht vorhanden -- der Agent bekaeme eine leere Anweisung.
if (-not (Test-Path (Join-Path $repo $auftragDatei))) { Abbruch "$auftragDatei gibt es nicht." }
$r = Native git @("-C", $repo, "ls-files", "--", $auftragDatei)
if (-not $r.Ausgabe.Trim()) {
    Abbruch "$auftragDatei ist nicht committet. Im Worktree waere er nicht vorhanden, und der Agent bekaeme eine leere Anweisung."
}
$r = Native git @("-C", $repo, "status", "--porcelain", "--", $auftragDatei)
if ($r.Ausgabe.Trim()) { Abbruch "$auftragDatei hat uncommittete Aenderungen. Der Agent bekaeme den alten Stand." }
Sagen "  1  Auftrag committet         : ja  ($auftragDatei)"

# 2  Der Agent ist arbeitsfaehig. Direkt gemessen, nicht ueber einen Stellvertreter.
#    ABER: --list-models sagt nur, dass die Anmeldung steht. Ob er auch einen Befehl
#    AUSFUEHREN kann, misst erst Vorpruefung 7.
$exe = Get-AgentPfad
$r = Native $exe @("--list-models")
if ($r.Code -ne 0) {
    Abbruch "cursor-agent ist nicht arbeitsfaehig (--list-models Exit $($r.Code)). Der Schluessel fehlt oder ist abgelaufen:`n$($r.Ausgabe)"
}
if ($r.Ausgabe -notmatch [regex]::Escape($Modell)) {
    Abbruch "Das Modell '$Modell' steht nicht in der Modellliste des Agenten. Ein Auftrag gegen ein Modell, das es nicht gibt, laeuft ins Leere."
}
Sagen "  2  Agent arbeitsfaehig       : ja  (--list-models Exit 0, $Modell in der Liste)"

# 3  Die Rechte stehen auf AN.
$cli = Join-Path $repo ".cursor\cli.json"
$an  = Join-Path $repo ".cursor\cli.an.json"
if (-not (Test-Path $cli) -or -not (Test-Path $an)) { Abbruch ".cursor\cli.json oder cli.an.json fehlt." }
$rechteAn = (Get-FileHash $cli -Algorithm SHA256).Hash -eq (Get-FileHash $an -Algorithm SHA256).Hash
if (-not $rechteAn) {
    Abbruch "Die Rechte stehen auf AUS. Dieses Skript schaltet sie NICHT scharf -- das ist 'tools\cursor.ps1 -An' und Sache des Nutzers."
}
Sagen "  3  Rechte                    : AN"

# 4  Die Wahrheitsquellen sind unveraendert.
#    ★ Hat dieses Projekt keine gehashte Wahrheitsquelle, wird das AUSGESPROCHEN. Eine
#      uebersprungene Pruefung, die wie eine bestandene aussieht, ist schlimmer als
#      keine: sie erzeugt Vertrauen, das nichts traegt.
$quellSoll = @{}
if ($wahrheitsQuellen.Count -eq 0) {
    Sagen "  4  Wahrheitsquellen          : KEINE definiert -- diese Pruefung hat NICHTS gemessen [?]"
} else {
    $manifest = Join-Path $repo $manifestPfad
    if (-not (Test-Path $manifest)) { Abbruch "$manifestPfad fehlt -- die Wahrheitsquellen haben keinen Integritaetsanker." }
    $zeilen = @(Select-String -Path $manifest -Pattern $manifestMuster)
    if ($zeilen.Count -eq 0) { Abbruch "In $manifestPfad steht kein SHA-256 im erwarteten Muster ($manifestMuster)." }
    foreach ($q in $wahrheitsQuellen) {
        $datei = Join-Path $repo $q
        if (-not (Test-Path $datei)) { Abbruch "Die Wahrheitsquelle fehlt: $q" }
        $ist = (Get-FileHash $datei -Algorithm SHA256).Hash.ToUpper()
        $treffer = @($zeilen | Where-Object { $_.Matches[0].Groups[1].Value.ToUpper() -eq $ist })
        if ($treffer.Count -eq 0) {
            Abbruch "Der SHA-256 von $q steht nicht in $manifestPfad. Veraendert oder verwechselt? ist $($ist.Substring(0,12))..."
        }
        $quellSoll[$q] = $ist
        Sagen "  4  Quelle unveraendert       : $q  ($($ist.Substring(0,12))...)"
    }
}

# 5  Das Tor ist gruen, BEVOR der Agent laeuft. Sonst ist hinterher nicht zu trennen, was
#    er verursacht hat und was schon vorher schief stand. -ImLauf, weil das Tor sonst
#    genau die Rechte beanstandet, die Vorpruefung 3 gerade verlangt hat.
& (Join-Path $repo "tools\gate.ps1") -ImLauf > $null
if ($LASTEXITCODE -ne 0) { Abbruch "Das Tor ist ROT, bevor der Agent ueberhaupt laeuft. Erst 'tools\gate.ps1' sauber bekommen." }
Sagen "  5  Tor vor dem Lauf          : gruen"

# 6  Kein alter Worktree im Weg.
if (Test-Path $wt) { Abbruch ".wt\$auf gibt es schon. Erst 'tools\auftrag.ps1 -Nummer $Nummer -Aufraeumen'." }
Sagen "  6  Arbeitsort frei           : ja  (.wt\$auf)"

# 6b Windows-Langpfade, sobald ueberhaupt ein Quellbaum kopiert wird.
#    GEMESSEN am 2026-09-22: mit node_modules im Arbeitsort entstehen Pfade bis 292
#    Zeichen -- die Capacitor-Plugins bringen gebaute Android-Artefakte mit
#    (node_modules\@capacitor\filesystem\android\build\.transforms\...\*.dex). Ohne
#    core.longpaths scheitert 'git worktree remove' mit "Filename too long", und zwar
#    NACHDEM git die Worktree-Metadaten bereits geloescht hat. Zurueck bleibt ein
#    verwaister 300-MB-Ordner, den git danach nicht mehr anfasst ("is not a working
#    tree") -- er muss von Hand weg (robocopy /MIR aus einem leeren Verzeichnis).
#    Einmal passiert, einmal von Hand aufgeraeumt. Das reicht als Anlass fuer diese
#    vier Zeilen.
if ($quellBaeume.Count -gt 0) {
    $lp = (Native git @("-C", $repo, "config", "--get", "core.longpaths")).Ausgabe.Trim()
    if ($lp -ne "true") {
        Abbruch "core.longpaths steht auf '$lp', es werden aber $($quellBaeume.Count) Quellbaum/-baeume kopiert. Der Arbeitsort laesst sich danach womoeglich nicht mehr entfernen. Setzen mit:  git config core.longpaths true"
    }
    Sagen "  6b Windows-Langpfade         : an  (core.longpaths=true)"
}

# ------------------------------------------------- FINGERABDRUCK VOR DEM LAUF
# Get-Fingerabdruck und Vergleich stehen weiter oben bei den Hilfsfunktionen --
# -SelbsttestParallel braucht sie, bevor die Vorpruefungen laufen.

Sagen ""
Sagen "  Fingerabdruck vor Vorpruefung 7 und vor dem Lauf"
Sagen "  (git status, Nachbarschaft, Wahrheitsquellen, blinde Baeume)"
$vorher = Get-Fingerabdruck
Sagen "  blinde Baeume:"
$vorher.Blind -split "`n" | ForEach-Object { Sagen "      $_" }

# 7  Kann der Ausfuehrende einen Befehl AUSFUEHREN? Gemessen an einem Ergebnis, das ohne
#    Ausfuehrung nicht zu bekommen ist. Warum nicht an 'print(7*6)': siehe der Kopf von
#    Start-MiniLauf -- die 42 waere gruen genau in dem Fall, den diese Pruefung fangen soll.
Sagen ""
Sagen "  7  Ausfuehrender rechnet     : wird gemessen (Mini-Lauf, hoechstens 3 Minuten) ..."
$m7 = Start-MiniLauf -Exe $exe -Rechte $an
if (-not $m7.HashDa) {
    $grund = if ($m7.VierZwei) {
        "Er lieferte 42, aber nicht den SHA-256 des Einmalworts: er antwortet, OHNE zu rechnen. Genau diesen Fall haette eine Pruefung auf '42' fuer bestanden erklaert."
    } elseif (-not $m7.Fertig) {
        "Der Mini-Lauf lief in die Zeitgrenze und wurde ueber seine eigene PID beendet."
    } else {
        "Der SHA-256 des Einmalworts steht nicht in seiner Ausgabe."
    }
    Abbruch @"
Der Ausfuehrende kann keinen Befehl ausfuehren. $grund

Ein Auftrag mit Zaehlungen ist unter dieser Bedingung sinnlos -- er liefert dann 'gelesen'
und 'vermutet', wo 'gemessen' verlangt war, und das faellt erst bei der Abnahme auf.
(So gemessen im Schwesterprojekt: wikinger_one_new, AUF-005, 14 von 14 Befunden.)

  Einmalwort : $($m7.Nonce)
  erwartet   : $($m7.Soll)
  42 im Text : $($m7.VierZwei)
  Ausgabe    :
$($m7.Ausgabe)
"@
}
Sagen "  7  Ausfuehrender rechnet     : ja  (SHA-256 des Einmalworts $($m7.Soll.Substring(0,12))... geliefert)"

# Der Mini-Lauf war ein Agentenlauf. Also wird er auch gemessen.
$nachMini = Get-Fingerabdruck
$spurMini = Vergleich $vorher $nachMini
if ($spurMini.Count -gt 0) {
    Sagen ""
    Sagen "  [!] Der MINI-LAUF der Vorpruefung 7 hat ausserhalb seines Wegwerf-Ortes gewirkt:"
    $spurMini | ForEach-Object { Sagen "      $_" }
    Abbruch "Der Mini-Lauf hat den Hauptbaum bewegt. Erst das klaeren -- der eigentliche Lauf waere danach nicht mehr von ihm zu trennen."
}
Sagen ("  " + ("-" * 66))

if ($TrockenLauf) {
    Sagen ""
    Sagen "  TROCKENLAUF: alle sieben Vorpruefungen bestanden. Es wurde kein Worktree"
    Sagen "  angelegt und kein Auftrag gestartet. Vorpruefung 7 hat einen Agenten in einem"
    Sagen "  Wegwerf-Verzeichnis unter %TEMP% gefahren; ausserhalb hat sich dabei nichts"
    Sagen "  geaendert (Fingerabdruck vorher/nachher gleich)."
    exit 0
}

# --------------------------------------------------------------- WORKTREE BAUEN
Sagen ""
Sagen "  Arbeitsort einrichten"
$r = Native git @("-C", $repo, "worktree", "add", "-b", $zweig, ".wt/$auf", "HEAD")
if ($r.Code -ne 0) { Abbruch "git worktree add ging nicht durch:`n$($r.Ausgabe)" }

# Die Wahrheitsquellen hinein, schreibgeschuetzt -- und JEDE Kopie nachgehasht.
# Eine Kopie ist erst dann die Quelle, wenn sie nachweislich dieselbe ist.
foreach ($q in $wahrheitsQuellen) {
    $ziel = Join-Path $wt $q
    New-Item -ItemType Directory -Force (Split-Path -Parent $ziel) | Out-Null
    Copy-Item (Join-Path $repo $q) $ziel -Force
    Set-ItemProperty $ziel -Name IsReadOnly -Value $true
    $istWt = (Get-FileHash $ziel -Algorithm SHA256).Hash.ToUpper()
    if ($istWt -ne $quellSoll[$q]) {
        $null = Native git @("-C", $repo, "worktree", "remove", "--force", ".wt/$auf")
        Abbruch "Die Kopie von $q im Arbeitsort stimmt nicht mit $manifestPfad ueberein."
    }
    Sagen "  Quellkopie geprueft          : $q  SHA-256 stimmt"
}

# Die unversionierten Quellbaeume hinein.
#
# *** GEMESSEN AM 2026-09-09 IN gamedesign, AUF-000: 'Copy-Item <quelle> <ziel> -Recurse'
#     legt den Ordner IN das Ziel, sobald das Ziel schon EXISTIERT. Aus books\md wurde
#     books\md\md, die Gegenprobe unten meldete "27 von 26" und der Lauf brach ab.
#     Im Vorbild grandprix konnte das nie auftreten: dort ist kein Quellbaum versioniert,
#     das Ziel existierte also nie vorher. In gamedesign traegt books\md eine
#     versionierte .gitkeep -- der Worktree checkt sie aus, und damit ist das
#     Verzeichnis da.
#     Kopiert wird darum der INHALT ("$q\*"), und das Ziel wird vorher angelegt.
#     Ohne die Gegenprobe unten waere daraus ein Arbeitsort geworden, in dem die
#     Volltexte eine Ebene zu tief liegen -- der Ausfuehrende haette sie nicht
#     gefunden und "0 Treffer" als Ergebnis gemeldet.
foreach ($p in $quellBaeume) {
    $q = Join-Path $repo $p
    if (Test-Path $q) {
        $ziel = Join-Path $wt $p
        New-Item -ItemType Directory -Force $ziel | Out-Null
        Copy-Item (Join-Path $q "*") $ziel -Recurse -Force
    } else {
        Sagen "  [!] $p gibt es nicht -- der Ausfuehrende arbeitet ohne diesen Baum."
    }
}
foreach ($p in $einzelDateien) {
    $q = Join-Path $repo $p
    if (Test-Path $q) {
        $ziel = Join-Path $wt $p
        New-Item -ItemType Directory -Force (Split-Path -Parent $ziel) | Out-Null
        Copy-Item $q $ziel -Force
    } else {
        Sagen "  [!] $p gibt es nicht -- fuenf Werkzeuge lesen diese Datei."
    }
}
New-Item -ItemType Directory -Force (Join-Path $wt "auftraege\_ergebnisse") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $wt "auftraege\_probe") | Out-Null

# Die Leerverzeichnisse. Sie werden bewusst NICHT befuellt: eine Write-Sperre auf ein
# Verzeichnis, das es gar nicht gibt, scheitert am fehlenden Verzeichnis statt an der
# Sperre. In AUF-000 des Vorbildprojekts las sich genau das wie "die Sperre hat
# gehalten" und war in Wahrheit "hier wurde nichts gemessen".
foreach ($d in $leerVerzeichnisse) {
    New-Item -ItemType Directory -Force (Join-Path $wt $d) | Out-Null
}

# Gegenprobe: sind die Baeume im Arbeitsort so gross wie im Hauptbaum? Ein halb
# kopierter Baum ist schlimmer als keiner -- der Ausfuehrende merkt es nicht.
$abW = (Native "python" @("-u", (Join-Path $repo "tools\blindbaum.py"))).Ausgabe
Sagen "  Quellbaeume kopiert          : $($quellBaeume.Count) Baeume, $($einzelDateien.Count) Einzeldatei(en)"
foreach ($p in $quellBaeume) {
    $a = @(Get-ChildItem (Join-Path $repo $p) -Recurse -File -ErrorAction SilentlyContinue).Count
    $b = @(Get-ChildItem (Join-Path $wt $p)   -Recurse -File -ErrorAction SilentlyContinue).Count
    $marke = if ($a -eq $b) { "ok" } else { "!!" }
    Sagen "      [$marke] $p  Haupt $a / Arbeitsort $b"
    if ($a -ne $b) {
        $null = Native git @("-C", $repo, "worktree", "remove", "--force", ".wt/$auf")
        Abbruch "Der Baum $p wurde unvollstaendig kopiert ($b von $a). Der Ausfuehrende saesse auf halber Quelle und wuerde das nicht merken."
    }
}

# Die scharfen Rechte in den Arbeitsort. Im Worktree steht der versionierte Stand von
# cli.json, und der ist die AUS-Fassung.
Copy-Item $an (Join-Path $wt ".cursor\cli.json") -Force
Sagen "  Rechte im Arbeitsort         : AN-Fassung eingesetzt"

# FREMD-HOOKS IM ARBEITSORT NEUTRALISIEREN (S238, gemessen an AUF-019 und AUF-020).
# Die Cursor-CLI laedt Claude-Code-Hooks aus .claude/settings.local.json (Cursor-Doku
# "Third Party Hooks": settings.local.json, settings.json, ~/.claude/settings.json; matcher
# und type:prompt werden unterstuetzt). Die Datei ist hier GETRACKT und steht darum in jedem
# Worktree. Ihr PreToolUse-PROMPT-Hook auf Edit|Write ("Jeder Code muss 1:1 aus dem
# Original-Java portiert sein ...") traegt ein "if": "Edit(game/src/**)|Write(game/src/**)"
# -- das kennt Cursor nicht und wendet den Hook auf ALLES an. Im Transcript gezaehlt:
# AUF-019 rund 12 von 20 Schreibvorgaengen abgewiesen (main.gd viermal), AUF-020 rund 9 von
# 26 -- und derselbe Inhalt kam mal durch, mal nicht (LLM-Gate, nicht deterministisch).
# Der Hook gilt dem Orchestrator im Hauptrepo; dort bleibt die Datei unberuehrt. Im
# Arbeitsort ersetzt sie ein leeres Objekt. Der Fingerabdruck misst den eigenen Arbeitsort
# nicht, die Nachkontrolle bleibt davon unberuehrt.
$claudeLocal = Join-Path $wt ".claude\settings.local.json"
if (Test-Path $claudeLocal) {
    [System.IO.File]::WriteAllText($claudeLocal, "{}`n", (New-Object System.Text.UTF8Encoding($false)))
    $claudeRest = @(Get-Content $claudeLocal | Select-String -Pattern '"hooks"').Count
    if ($claudeRest -ne 0) { Abbruch ".claude\settings.local.json im Arbeitsort traegt nach dem Ersetzen noch 'hooks'." }
    Sagen "  Fremd-Hooks im Arbeitsort    : .claude\settings.local.json -> {}  (Cursor laedt Claude-Hooks; 'hooks' danach 0x)"
}

# ------------------------------------------------------------- AGENT STARTEN
# *** EINE ZEILE. DAS IST GEMESSEN, NICHT STIL. ***
# Bis zum 2026-09-07 stand hier ein mehrzeiliges Here-String. Davon kam beim Agenten NUR
# DIE ERSTE ZEILE an -- alles ab dem ersten Zeilenumbruch ging auf dem Weg verloren.
# Zwei unabhaengige Kanaele:
#   1. Der Agent selbst, im Selbsttest der Vorpruefung 7: "Die Nachricht endet nach dem
#      Doppelpunkt ohne die zwei konkreten Befehle."
#   2. Eine Messung ohne Agent: dieselbe Start-Process-Kette gegen eine eigene .cmd, die
#      ihre Argumente ausgibt. Einzeilig kommt der Text an, mehrzeilig endet er nach
#      Zeile 1, und %2 ist leer -- der Rest verschwindet, er rutscht nicht weiter.
# Folge fuer AUF-000: der damalige Lauf hat von diesen Saetzen nur den ersten bekommen.
# Der Auftrag selbst stand in der Auftragsdatei, darum trug das Ergebnis -- die Annahme
# "der Agent hat diese Anweisung gelesen" war aber falsch.
$anweisung = (
    "Lies $auftragDatei in diesem Arbeitsbaum und fuehre GENAU diesen einen Auftrag aus. " +
    "Es gilt CLAUDE.md im Projektstamm und die Regel in .cursor/rules/00-auftrag.mdc. " +
    "Du bist Ausfuehrender, nicht Entscheider. Du setzt keine Marker, du schlaegst sie vor. " +
    "Deine Lieferung ist die Datei $lieferung, gebildet gegen tools/lieferschema.json. " +
    "Schreibe nichts ausserhalb von auftraege/_ergebnisse/ und auftraege/_probe/, ausser wo der Auftrag " +
    "ausdruecklich einen protokollierten Versuch dagegen verlangt. Fasse tools/ nicht an: dort steht das Pruefgeraet UND tools/privacy-scan.mjs, das die zu schuetzenden Klarnamen als Suchmuster enthaelt -- lies es nicht und zitiere daraus nichts. node_modules liegt als KOPIE im Arbeitsort: 'npm test' und 'npx tsc --noEmit' sollst du fahren und ihre Ausgabe in die Lieferung nehmen -- ein Code-Befund ohne Testlauf traegt hoechstens die Achse 'implementiert'. Installiere nichts nach und aendere package.json nicht; was fehlt, gehoert nach nicht_erreicht. " +
    "Ein Sucher, der .gitignore achtet, meldet in ignorierten Baeumen 0 Treffer, ohne " +
    "gesucht zu haben. Jede Nullaussage braucht eine Positiv-Kontrolle mit einem bekannten " +
    "Treffer, mit demselben Werkzeug und derselben Wurzel. " +
    "Eine Vermutung als Messung auszugeben ist der einzige Fehler, der hier nicht verziehen wird."
)

$argumente = @(
    "--print",
    "--output-format", "text",
    "--model", $Modell,
    "--workspace", $wt,
    "--trust",
    $anweisung
)

Sagen ""
Sagen "  Agent starten"
Sagen "  Modell   : $Modell"
Sagen "  Grenze   : $MaxMinuten Minuten"
# Die Variable, nicht der Text: hier stand der Pfad des Vorbilds fest verdrahtet
# und meldete "re\_ergebnisse\..." in einem Projekt, das dieses Verzeichnis gar
# nicht hat. Geschrieben wurde immer richtig -- nur die Anzeige log.
Sagen "  Protokoll: $protokoll"
Sagen ""

# Die verwendete Kommandozeile gehoert ins Protokoll. Ohne sie ist spaeter nicht
# nachvollziehbar, unter WELCHEN Bedingungen gemessen wurde.
$kopf = @(
    "=== LAUF $auf ===",
    "Zeit       : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
    "Modell     : $Modell",
    "Arbeitsort : $wt",
    "Zweig      : $zweig",
    "Basis      : $((Native git @('-C', $repo, 'rev-parse', 'HEAD')).Ausgabe.Trim())",
    "Quellen    : " + (($quellSoll.Keys | Sort-Object | ForEach-Object { "$_ $($quellSoll[$_].Substring(0,12))..." }) -join " ; "),
    "Aufruf     : cursor-agent --print --output-format text --model $Modell --workspace <arbeitsort> --trust <anweisung>",
    "Arbeitsverz: $wt   (bestimmt die wirksame Rechtefassung, s. HINWEIS)",
    "Rechte     : .cursor/cli.json == cli.an.json (SHA-256 geprueft), im Haupt- UND im Arbeitsbaum",
    "Vorpr. 7   : Mini-Lauf bestanden -- der Ausfuehrende hat einen Befehl wirklich",
    "             ausgefuehrt (SHA-256 eines Einmalworts, ohne Ausfuehrung nicht zu haben).",
    "HINWEIS    : weder --force noch --yolo noch --sandbox gesetzt.",
    "HINWEIS    : gemessen am 2026-09-07 -- nicht --workspace entscheidet ueber die Rechte,",
    "             sondern das Arbeitsverzeichnis des Prozesses. Darum -WorkingDirectory.",
    "HINWEIS    : die Anweisung geht als EINE Zeile hinaus. Mehrzeilig kam beim Agenten",
    "             nur die erste Zeile an (gemessen, zwei Kanaele).",
    "HINWEIS    : eine zweite, repo-EXTERNE Rechtequelle liegt in ~/.cursor/cli-config.json",
    "             und traegt auf dieser Maschine sandbox.mode = disabled. Wer die Leine",
    "             beurteilt, muss beide Quellen kennen.",
    "=== AUSGABE ==="
)
New-Item -ItemType Directory -Force (Split-Path -Parent $protokoll) | Out-Null
$kopf | Set-Content $protokoll -Encoding utf8

$roh = [System.IO.Path]::GetTempFileName()
$rohErr = [System.IO.Path]::GetTempFileName()
# *** -WorkingDirectory: DIE RECHTE HAENGEN AM ARBEITSVERZEICHNIS, NICHT AN --workspace. ***
# Gemessen am 2026-09-07, zwei Laeufe, ein einziger geaenderter Faktor: bei --workspace auf
# einem Ort mit der AN-Fassung und Arbeitsverzeichnis im Repo-Stamm (dort stand die
# AUS-Fassung) wurde 'python' mit "Permission denied: Command blocked by permissions
# configuration" abgewiesen; mit Arbeitsverzeichnis auf demselben Ort lief es.
# Folge: die Zeile weiter oben, die cli.an.json in den Arbeitsort kopiert, war bis heute
# DEKORATION -- gewirkt hat die Fassung im Repo-Stamm, und dass beide gleich waren, ist
# allein Vorpruefung 3 zu verdanken. Mit dieser Zeile ist die Leine des Laufs die Datei,
# die dieses Skript selbst in den Arbeitsort geschrieben hat.
$p = Start-Process -FilePath $exe -ArgumentList $argumente -PassThru -NoNewWindow `
                   -WorkingDirectory $wt `
                   -RedirectStandardOutput $roh -RedirectStandardError $rohErr
$fertig = $p.WaitForExit($MaxMinuten * 60 * 1000)
if (-not $fertig) {
    Sagen "  [!] Die Zeitgrenze von $MaxMinuten Minuten ist erreicht. Beenden ueber die eigene PID $($p.Id)."
    # NUR ueber die selbst erzeugte PID, nie ueber einen Namen.
    $null = Native taskkill @("/F", "/T", "/PID", "$($p.Id)")
    Start-Sleep -Milliseconds 500
    Add-Content $protokoll "`n=== ABGEBROCHEN nach $MaxMinuten Minuten (PID $($p.Id)) ==="
    $code = -1
} else {
    # Refresh(): ohne das ist ExitCode bei Start-Process -PassThru oft leer, und das
    # Protokoll endet mit "Agent beendet, Exit " ohne Zahl.
    $p.Refresh()
    $code = $p.ExitCode
    if ($null -eq $code) { $code = "unbekannt (ExitCode nicht gesetzt)" }
}
Get-Content $roh -ErrorAction SilentlyContinue | Add-Content $protokoll
$fehlertext = Get-Content $rohErr -ErrorAction SilentlyContinue
if ($fehlertext) {
    Add-Content $protokoll "`n=== STDERR ==="
    $fehlertext | Add-Content $protokoll
}
Remove-Item $roh, $rohErr -Force -ErrorAction SilentlyContinue
Add-Content $protokoll "`n=== ENDE, Exit $code ==="

# ------------------------------------------------------------- NACHKONTROLLE
# Nicht "der Agent durfte das nicht", sondern "was hat er getan". Gemessen, weil die
# Rechtedatei es nachweislich nicht verhindert.
$nachher = Get-Fingerabdruck
# Verglichen wird gegen den Stand VOR Vorpruefung 7. Beide Agentenlaeufe stehen damit in
# derselben Messung; ein Ausbruch des Mini-Laufs kann sich nicht in die Grundlinie legen.
$ausbruch = Vergleich $vorher $nachher

Sagen ""
Sagen ("  " + ("-" * 66))
if ($ausbruch.Count -gt 0) {
    Sagen "  [!] AUSSERHALB DES ARBEITSORTS HAT SICH ETWAS GEAENDERT:"
    $ausbruch | ForEach-Object { Sagen "      $_" }
    Sagen ""
    Sagen "      Das ist ein BEFUND ueber den Lauf, kein Fehler des Skripts."
    Sagen "      Vor allem Weiteren pruefen und zuruecksetzen."
    Add-Content $protokoll "`n=== NACHKONTROLLE: AUSBRUCH ==="
    $ausbruch | ForEach-Object { Add-Content $protokoll "  $_" }
} else {
    Sagen "  Nachkontrolle: ausserhalb des Arbeitsorts unveraendert"
    Sagen "                 (Wahrheitsquellen, Hauptbaum, .wt-Nachbarschaft, blinde Baeume)"
    Add-Content $protokoll "`n=== NACHKONTROLLE: nichts ausserhalb des Arbeitsorts veraendert ==="
    Add-Content $protokoll ($vorher.Blind -split "`n" | ForEach-Object { "  $_" })
}

# ---------------------------------------------------------------------- URTEIL
Sagen ""
Sagen "  Agent beendet, Exit $code"

# SOFORT sichern, nicht erst beim Aufraeumen. Zwischen Lauf und Aufraeumen liegen
# Abnahme, Nachlesen und Merge -- und in AUF-004 lag dazwischen der Datenverlust.
$null = Arbeit-Sichern -Ort $wt -Ziel (Join-Path $repo "auftraege\_ergebnisse\${auf}_arbeit.patch")

$lief = Join-Path $wt ($lieferung -replace '/', '\')
if (Test-Path $lief) {
    Sagen "  Lieferung liegt vor          : $lieferung"
    Sagen ""
    Sagen "  Naechster Schritt -- die Lieferung ist eine Hypothese, kein Beleg:"
    Sagen "      python -u tools\abnahme.py `"$lief`" --basis `"$wt`""
} else {
    Sagen "  [!] KEINE Lieferung unter $lieferung"
    Sagen "      Das Protokoll sagt, wie weit er gekommen ist:"
    Sagen "      re\_ergebnisse\${auf}_agentenlauf.txt"
}
Sagen ""
Sagen "  Der Arbeitsort bleibt stehen. Entfernen mit:"
Sagen "      tools\auftrag.ps1 -Nummer $Nummer -Aufraeumen"
Sagen ""
Sagen "  [!] Die Rechte stehen noch auf AN. Ausschalten, sobald nichts mehr laeuft:"
Sagen "      tools\cursor.ps1 -Aus"
Sagen "  Das Tor beanstandet die AN-Fassung sonst beim naechsten Lauf ohne -ImLauf."
Sagen ""

# Kontrolle, kein Messgeraet: der Zustand steht im Protokoll, nicht im Exit-Code.
exit 0
