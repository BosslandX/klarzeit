# Klarzeit (klarzeit)

> Offline-Arbeitszeiterfassung als Android-App. Single-User, kein Server, keine Cloud.

## Quick Reference
- **Typ:** Capacitor-Android-App (lokale Zeiterfassung)
- **Stack:** Vite + React 19 + TypeScript, Capacitor 8, Dexie (IndexedDB), jsPDF, date-fns
- **App-ID:** `io.github.bosslandx.klarzeit` · webDir: `dist`
- **Version:** 1.4 (`versionCode 5`)

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
  Zeiteinträge in Dexie, Profil/laufende Session/**Vertragsdaten + Urlaubstage** in
  `@capacitor/preferences` (`src/db/employment.ts`).
- **Arbeitszeitkonto & gesetzlicher Urlaub:** Logik rein in `src/domain/employment.ts`
  (Soll/Saldo + BUrlG), getestet; nur Monatsreports erhalten die PDF-Blöcke via `ReportExtras`.
  Rechtsgrundlagen als Kommentar/Fußnote referenziert (BUrlG §§ 3–5).
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

Es sind interne Bezeichner, keine Produktnamen. Eine Umbenennung würde bestehende
Datenbanken unerreichbar und ältere Backups nicht mehr importierbar machen.

## Veröffentlichung
- Repo `BosslandX/klarzeit` (MIT). **Derzeit noch PRIVAT** — public erst nach Logo-Lieferung,
  weil sämtliche Icons noch den Schriftzug der Vorgänger-App tragen und `privacy-scan.mjs`
  **keine Bilddateien prüft**. Vor dem Public-Schalten daher zusätzlich zum Scan die Icons
  unter `assets/` und `android/app/src/main/res/mipmap-*`/`drawable-*` visuell kontrollieren.
- Releases (APK + `version.json`) liegen im selben Repo; `src/update/updater.ts` zieht sie über
  `releases/latest/download`. **Solange das Repo privat ist, liefert dieser Pfad unauthentifiziert
  HTTP 404** (`CapacitorHttp` schickt kein Token) — der In-App-Updater funktioniert erst ab dem
  Public-Schalten. Kein Bug im Updater.
- Im `version.json` muss die `url` exakt den Asset-Dateinamen tragen. Der enthält die Version
  (`klarzeit-<version>-release.apk`), also die **Tag-URL** `releases/download/vX.Y/…` verwenden,
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

**Die `deny`-Listen in `.cursor/cli.an.json` halten nicht.** In beiden Vorbildprojekten
fiel jede von fünf geprüften Sperren. Sie sind eine Absichtserklärung, keine Grenze. Die
wirksame Grenze ist der git-Worktree plus der Fingerabdruck, den `auftrag.ps1` hinterher
zieht. **AUF-000 misst, welche Einträge hier tatsächlich halten** — bis dahin ist das
eine Erwartung.

**Der Geprüfte darf das Prüfgerät nicht besitzen.** `tools/` ist für den Ausführenden
gesperrt, weil dort `abnahme.py`, `gate.ps1` und `beleg_pruefen.py` stehen. Wer sein
eigenes Tor umschreiben darf, stellt sich sein Grün selbst her.

### Herkunft

`C:\gamedev\composer-kit`, Profil `code`. Änderungen an `tools/` gehören mit
Begründung in den Baukasten zurück — sonst divergieren die Fassungen lautlos, wie es
zwischen den vier Bestandsprojekten geschehen ist (22–51 % abweichende Zeilen).
