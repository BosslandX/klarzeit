# Klarzeit (klarzeit)

> Offline-Arbeitszeiterfassung als Android-App. Single-User, kein Server, keine Cloud.

## Quick Reference
- **Typ:** Capacitor-Android-App (lokale Zeiterfassung)
- **Stack:** Vite + React 19 + TypeScript, Capacitor 8, Dexie (IndexedDB), jsPDF, date-fns
- **App-ID:** `io.github.bosslandx.klarzeit` · webDir: `dist`
- **Version:** 1.5.1 (`versionCode 7`)

## Build & Run
```bash
npm install
npm run dev                 # Web-Dev (Browser, Daten via IndexedDB)
npm run build               # tsc --noEmit + vite build -> dist/
npm test                    # vitest run (Domain-Tests, u.a. Arbeitszeitkonto/Urlaub)
npm run apk                 # build + cap sync + gradlew assembleDebug
npm run apk:release         # signierte Release-APK (braucht android/keystore.properties)
npm run icons               # Icon/Splash neu generieren (tools/gen-icons.mjs + capacitor-assets)
node tools/privacy-scan.mjs # lokales Werkzeug (gitignored): prueft Arbeitsverzeichnis
                            # + Git-Historie auf private Angaben vor dem Push
# APK: android/app/build/outputs/apk/{debug,release}/
```
- Android SDK-Pfad in `android/local.properties` (`sdk.dir=...`, gitignored, rechnerspezifisch).
- JDK 21 (`JAVA_HOME`), Gradle-Wrapper 8.14.x, compileSdk/targetSdk 36, minSdk 24.
- **Release-Signing:** `android/app/build.gradle` liest `android/keystore.properties`
  (gitignored, Vorlage: `keystore.properties.example`). Fehlt sie → unsigniert. Niemals
  Keystore/Passwort committen.
- **Icons/Splash:** Quellen in `assets/`, Motiv in `tools/gen-icons.mjs`. Splash aktiv via
  `@capacitor/splash-screen` (Config in `capacitor.config.ts`); Android-12+-Theme-Attribute
  in `android/app/src/main/res/values/styles.xml` + Farbe in `values/colors.xml`;
  Ausblenden via `SplashScreen.hide()` in `src/ui/App.tsx`.

## Architektur-Konventionen
- **Immutability**, viele kleine Dateien, Fehler explizit behandeln.
- Persistenz-Abstraktion: `src/db/` ist die einzige Stelle für Datenzugriffe.
  Zeiteinträge in Dexie, Profil/laufende Session/**Beschäftigungen + Urlaubstage** in
  `@capacitor/preferences` (`src/db/employment.ts`).
- **Mehrere Beschäftigungen (seit 1.5):** `employments` hält eine **Liste**; jeder
  `TimeEntry`, `VacationDay` und die `RunningSession` tragen `employmentId` als
  Pflichtfeld. Dexie steht auf `version(2)` mit Index auf `employmentId`; der
  `upgrade`-Hook gibt Bestandseinträgen `emp-1`. Der alte Einzelschlüssel `employment`
  bleibt liegen — er ist der Rückweg, falls die Migration schiefgeht.
  - **IDs:** `emp-1` für die Migration (fest, damit sie deterministisch prüfbar ist),
    sonst `emp-<zeitstempel>-<zufall>`. **Kein** `crypto.randomUUID` (in alten
    Android-WebViews nicht überall vorhanden) und **keine** fortlaufende Nummer: eine
    gelöschte würde neu vergeben, und alte Einträge hingen an der falschen
    Beschäftigung.
  - **Aktive Beschäftigung:** Schlüssel `activeEmployment`. `getActiveEmploymentId()`
    prüft die gespeicherte ID gegen die Liste und fällt auf die erste zurück — sonst
    bliebe nach `removeEmployment` eine tote ID stehen.
  - **Löschen** ist gesperrt, solange Zeiteinträge oder Urlaubstage daran hängen, und
    ebenso für die letzte verbliebene Beschäftigung.
  - **Kein Sammelbericht über alle Beschäftigungen.** Ein Nachweis, der die Stunden
    zweier Arbeitgeber addiert, ist für beide unbrauchbar; der Bericht gilt für die
    gewählte Beschäftigung, und der PDF-Kopf nimmt Arbeitgeber, Personalnummer und
    Abteilung von dort (Name weiter aus dem Profil).
  - **`Profile` behält `arbeitgeber`/`personalnummer`/`abteilung`**, obwohl sie in der
    Oberfläche nicht mehr vorkommen: ältere Backups tragen sie, `cleanProfile` liest
    sie, und aus ihnen entsteht beim Import die erste Beschäftigung.
  - ⛔ **`isValidEntry` in `src/db/backup.ts` niemals um `employmentId` verschärfen.**
    Die Prüfung läuft in `restoreBackup` **vor** der Normalisierung — ein verschärftes
    `isValidEntry` weist jedes ältere Backup ab, auch das automatische beim Start mit
    leerer Datenbank. Das ist einmal passiert (AUF-004, erster Anlauf) und wird seither
    durch einen Test gefangen (`src/db/backup.test.ts`).
- **Arbeitszeitkonto & gesetzlicher Urlaub:** Logik rein in `src/domain/employment.ts`
  (Soll/Saldo + BUrlG), getestet; nur Monatsreports erhalten die PDF-Blöcke via `ReportExtras`.
  Rechtsgrundlagen als Kommentar/Fußnote referenziert (BUrlG §§ 3–5).
- **Vertraglicher Urlaub (AUF-009):** `Employment.contractVacationDays`, `null` = kein
  Vertragswert. Entschieden wird **nur** in `annualEntitlement(emp)`: der Vertragswert gilt,
  aber **nie unter dem gesetzlichen Minimum** (§ 13 Abs. 1 BUrlG) — ein kleinerer Wert fällt
  auf das Minimum zurück, das Formular zeigt dazu einen Hinweis. Wartezeit, Zwölftelung und
  Austrittsregeln laufen unverändert über diese Zahl; regelt ein Vertrag den Mehrurlaub
  eigens, weicht die Anzeige im Eintritts-/Austrittsjahr ab. Ändern sich die Arbeitstage pro
  Woche, wird der Vertragswert **nicht** umgerechnet. Backupformat bleibt Version 3
  (`cleanEmployment` trägt das Feld, ältere Backups ergeben `null`). Der Text des
  PDF-Urlaubsblocks entsteht in `buildVacationPanelText` (rein, getestet).
- **Urlaub entlastet das Konto (seit 1.4):** `buildBalanceLedger(emp, entries, ref, vacationDates?)`
  weist je Monat `vacationDays` + `vacationCreditMs` aus; `saldoMs = istMs + vacationCreditMs − sollMs`.
  Ohne den 4. Parameter rechnet die Funktion unverändert. **Zwei Deckel nicht verwechseln:**
  taggenau in `vacationOfMonth` via `max(0, Tagessoll − Ist dieses Tages)` gegen Doppelzählung,
  wenn derselbe Tag zusätzlich als Zeiteintrag erfasst wurde; monatlich via `min(credit, sollMs)`,
  damit reiner Urlaub keine Überstunden erzeugt. Nicht gegen das Monats-`istMs` deckeln — das zöge
  das Ist zweimal ab und entwertete Arbeit an urlaubsfreien Tagen.
- **Nicht abgebildet:** Feiertage, Krankheit und sonstige bezahlte Freistellung erzeugen weiterhin
  Minusstunden; halbe Urlaubstage sind konstruktiv unmöglich (`taken` ist `.length`); kein
  Resturlaub-Übertrag (§ 7 III BUrlG); `VacationDay.note` existiert, ist in der UI aber tot.
- Zeiten immer als **Epoch-Millisekunden** speichern; Formatierung nur in `src/domain/time.ts`.
- PDF/Teilen ausschließlich über `src/pdf/`. Web-Fallback (Download) ist eingebaut.
- `vite.config.ts`: `base: './'` ist Pflicht (Capacitor lädt via file://).

## Stabile Bezeichner — NICHT umbenennen
Diese Werte sehen nach Altlast aus, sind aber bewusst eingefroren:
- `src/db/db.ts` → Dexie-DB-Name `'zeiterfassung'`
- `src/db/backup.ts` + `src/db/auto-backup.ts` → Format-Kennung `app: 'zeiterfassung'`
- `src/domain/employment.ts` → Feldname `contractVacationDays` (steht in Preferences
  `employments` und in jedem Backup; umbenannt verwirft `cleanEmployment` den alten Wert,
  und der Vertragsurlaub fällt still auf das gesetzliche Minimum zurück)

Es sind interne Bezeichner, keine Produktnamen. Eine Umbenennung würde bestehende
Datenbanken unerreichbar und ältere Backups nicht mehr importierbar machen.

## Veröffentlichung
- Repo `BosslandX/klarzeit` (MIT). **Derzeit noch PRIVAT** — public erst nach Logo-Lieferung,
  weil sämtliche Icons noch den Schriftzug der Vorgänger-App tragen und `privacy-scan.mjs`
  **keine Bilddateien prüft**. Vor dem Public-Schalten daher zusätzlich zum Scan die Icons
  unter `assets/` und `android/app/src/main/res/mipmap-*`/`drawable-*` visuell kontrollieren.
- **Releases (APK + `version.json`) liegen seit 1.5.1 im ÖFFENTLICHEN `BosslandX/klarzeit-releases`**
  — einem reinen Release-Repo ohne Quellcode (Muster `zeiterfassung-releases`).
  `src/update/updater.ts` zieht `releases/latest/download/version.json` von dort. Grund: Das private
  Code-Repo liefert unauthentifiziert **HTTP 404** (`CapacitorHttp` schickt kein Token), der Updater
  war damit tot. Die öffentliche APK trägt noch die Icons der Vorgänger-App — vom User bewusst in Kauf genommen
  (2026-09-23). Releases bis v1.4 liegen weiter im privaten Code-Repo und sind für den Updater
  unerreichbar: Wer eine ältere Version installiert hat, installiert 1.5.1 einmal von Hand.
- Commits im Releases-Repo nur als `BosslandX <20750642+BosslandX@users.noreply.github.com>` —
  kein Klarname in öffentlicher Historie.
- Im `version.json` muss die `url` exakt den Asset-Dateinamen tragen. Der enthält die Version
  (`klarzeit-<version>-release.apk`), also die **Tag-URL**
  `https://github.com/BosslandX/klarzeit-releases/releases/download/vX.Y/…` verwenden,
  nicht `releases/latest/download/…`.
- **Vor jedem Push:** `node tools/privacy-scan.mjs` muss null Treffer melden.
- `docs/` ist gitignored (persönliches Arbeitsjournal, nicht Teil der Veröffentlichung).

---

## Auftragskette: Orchestrator (Opus) ↔ Ausführender (composer-2.5)

**Du bist Orchestrator.** Der Ausführende ist `composer-2.5` über `tools\auftrag.ps1`.

- Du schreibst Auftrag **und Erwartung** VOR dem Lauf, nie danach. Eine Erwartung, die
  nach dem Ergebnis entsteht, kann nicht mehr widerlegt werden.
- Du liest **jeden** gelieferten Beleg selbst an der Quelle nach. Ein Agentenbericht ist
  eine Hypothese, kein Beleg.
- Du entscheidest über Marker. Ein Ausführender schlägt vor, er setzt nicht.
- Schreibhoheit: alles außer `auftraege/_ergebnisse/` und `auftraege/_probe/` änderst nur du.
- Vor jedem Merge eines Auftrags-Zweigs: `tools\gate.ps1` fahren.

### Wer welche Arbeit macht

**Handarbeit am Material gehört an `composer-2.5`.** Das ist der Standardweg, nicht die
Ausnahme. Darunter fällt alles, was Sichten und Zählen ist:

lesen · zählen · suchen · greppen · Dokumente sichten · Stellen gegeneinander halten ·
Zahlen nachrechnen · Skripte schreiben, die messen

### Claude-Subagenten

**Für ausführende Arbeit gesperrt.** Kein Task-Agent, kein Workflow, keine Fan-outs für
das, was oben steht — auch nicht kurz, auch nicht auf Haiku. Der Grund aus dem
Vorbildprojekt: für die Prüfung eines einzigen Auftrags liefen dort sechs Opus-Agenten.

**Lesende Claude-Agenten für Recherche und Review bleiben erlaubt** — aber nur mit
ausdrücklichem `model`-Schalter. Ohne ihn erbt der Subagent das Orchestrator-Modell,
also Opus. Genau so sind die sechs entstanden.

`ultracode` hebt diese Regel nicht auf. Wo `ultracode` „nimm einen Workflow" sagt und
diese Datei „nimm den Composer", gilt diese Datei.

| Lage | richtig |
|---|---|
| Handarbeit am Material ist nötig | `tools\auftrag.ps1` mit `composer-2.5` |
| ein Auftrag soll vor dem Lauf geprüft werden | **selbst prüfen**: Anker zählen, Kontrollen fahren, Rechnungen nachrechnen. Das ist billig und findet erfahrungsgemäß das meiste. |
| ein Befund trägt eine Markerentscheidung | **selbst an der Quelle nachlesen** |
| der Composer kommt an das Material nicht heran | **Material in den Arbeitsort legen** (`tools\auftrag.ps1`, Liste `$quellBaeume`), nicht „dann eben Opus" |

### Wege

| Was | Wo |
|-----|-----|
| Aufträge | `auftraege/AUF-nnn.md`, Vorlage daneben |
| Lieferungen der Ausführenden | `auftraege/_ergebnisse/` |
| Erprobung, nicht versioniert | `auftraege/_probe/` |
| Statuszahlen (einzige Quelle) | `tools/tracking.db` |
| Rechteschalter | `tools\cursor.ps1 -Status` / `-An` / `-Aus` |
| Tor vor dem Merge | `tools\gate.ps1` |
| Abnahme einer Lieferung | `python -u tools/abnahme.py <lieferung.json>` |

### Zwei Sätze, die den ganzen Aufbau tragen

**Die `deny`-Listen in `.cursor/cli.an.json` halten nicht.** Am 2026-09-09 gemessen
(AUF-002): das `Write`-Werkzeug wird blockiert, **`Shell(python)` umgeht die Liste
vollständig** — bis hin zu einer Datei außerhalb des Arbeitsorts. Sie ist eine
Absichtserklärung, keine Grenze. Was hält, ist der Fingerabdruck aus `auftrag.ps1`;
er hat den Ausbruch gemeldet. Einzelheiten: `.cursor/RECHTE.md`.

**Der Geprüfte darf das Prüfgerät nicht besitzen.** `tools/` ist für den Ausführenden
gesperrt, weil dort `abnahme.py`, `gate.ps1` und `beleg_pruefen.py` stehen. Wer sein
eigenes Tor umschreiben darf, stellt sich sein Grün selbst her.

### Herkunft

`C:\gamedev\composer-kit`, Profil `code`. Änderungen an `tools/` gehören mit
Begründung in den Baukasten zurück — sonst divergieren die Fassungen lautlos, wie es
zwischen den vier Bestandsprojekten geschehen ist (22–51 % abweichende Zeilen).


---

## ⛔ Die deny-Liste in `.cursor/cli.an.json` ist KEINE Grenze

**Am 2026-09-09 gemessen** (`klarzeit`, AUF-002): Das `Write`-Werkzeug wird von der
deny-Liste blockiert — **`Shell(python)` umgeht sie vollständig.** Im Versuch wurden alle
zwölf Ziele geschrieben, darunter `CLAUDE.md`, eine Datei ohne Endung, drei Ebenen tief —
und eine Datei **außerhalb des Arbeitsorts**.

Solange `Shell(python)` erlaubt ist — und ohne das kann ein Ausführender nichts messen —
ist jede Write-Sperre eine Absichtserklärung.

**Was tatsächlich hält, ist der Fingerabdruck** in `tools/auftrag.ps1`. Er hat den
Ausbruch gemeldet. Er misst vor und nach dem Lauf `git status`, die `.wt`-Nachbarschaft,
die Wahrheitsquellen und über `tools/blindbaum.py` die Bäume, die `git status` nicht sieht.

Der Worktree begrenzt, wohin **versehentlich** geschrieben wird. Er verhindert keinen
absichtlichen Ausbruch.

**Folge für jeden Auftrag:** Was nicht angefasst werden soll, gehört **in den
Auftragstext**, nicht nur in die deny-Liste. Der Auftragstext erreicht den Ausführenden;
die deny-Liste erreicht nur sein `Write`-Werkzeug.

**Folge für dieses Projekt:** Wer einem Ausführenden Material anvertraut, dessen Verlust
wehtut, braucht eine echte Sandbox — nicht diese Datei. Einzelheiten und die gemessenen
Zahlen: `.cursor/RECHTE.md`.
