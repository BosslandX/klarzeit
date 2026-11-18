# Klarzeit (klarzeit)

> Offline-Arbeitszeiterfassung als Android-App. Single-User, kein Server, keine Cloud.

## Quick Reference
- **Typ:** Capacitor-Android-App (lokale Zeiterfassung)
- **Stack:** Vite + React 19 + TypeScript, Capacitor 8, Dexie (IndexedDB), jsPDF, date-fns
- **App-ID:** `io.github.bosslandx.klarzeit` · webDir: `dist`
- **Version:** 1.14.1 (`versionCode 20`)

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
python -I tools/apk_pruefen.py <apk> <neues-verzeichnis> <neu> <alt>
                            # APK entpacken, Versions-Strings im Web-Bundle zaehlen
node tools/version-json-pruefen.mjs <version.json> <build.gradle> <apk-dateiname> <alter-versionCode>
                            # version.json fuer den Update-Kanal + vier Negativkontrollen
# APK: android/app/build/outputs/apk/{debug,release}/
```
- **Prüfwerkzeuge des Orchestrators** (seit 2026-11-17 versioniert, vorher nur im Scratchpad):
  `tools/zitat-pruefen.mjs` und `tools/kontext.mjs` prüfen Zitate gegen den Seitentext (Chrome
  kopflos über `puppeteer-core`, eigenes Profil); `tools/oberflaeche/aufNNN_ui.mjs` sind die
  Oberflächenproben der Aufträge 027–043 (`node tools/oberflaeche/auf037_ui.mjs <url>` gegen
  `npm run dev`, Stand ihres Auftrags). Einspiel-Vorlage, Auftragstext-Erzeuger und Stückprüfung
  liegen im Baukasten unter `C:\gamedev\composer-kit\orchestrator\` und werden von dort gerufen.
- Android SDK-Pfad in `android/local.properties` (`sdk.dir=...`, gitignored, rechnerspezifisch).
- JDK 21 (`JAVA_HOME`), Gradle-Wrapper 8.14.x, compileSdk/targetSdk 36, minSdk 24.
- **Release-Signing:** `android/app/build.gradle` liest `android/keystore.properties`
  (gitignored, Vorlage: `keystore.properties.example`). Fehlt sie → unsigniert. Niemals
  Keystore/Passwort committen.
- **Logo (seit 2026-11-18):** Pixelart-Stoppuhr, deren Zeiger einen Haken bilden, 32 × 32 mit transparentem
  Grund in `assets/source-logo.png`, erzeugt von `tools/logo_bauen.py` (Raster, Farben aus der App: Ring
  `#2563eb`, Haken `#16a34a`); im README-Banner als SVG-Rechtecke eingebettet. `tools/gen-icons.mjs`
  vergrößert ein Motiv bis 128 px Kante nur ganzzahlig und ohne Glätten (`kernel: nearest`) — mit dem
  Standardfilter verschwämmen die Pixelkanten. Der alte Schriftzug der Vorgänger-App ist damit aus allen
  Icons und Splashs heraus (jede versionierte Bilddatei neu erzeugt, die einfarbig weißen Hintergründe
  ausgenommen).
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
  - **Urlaubstage je Beschäftigung eindeutig (AUF-018):** doppelt ist nur derselbe Tag
    derselben Beschäftigung (`vacationDayKey` in `src/domain/employment.ts`, genutzt von
    `cleanVacationDays` und `mergeVacationDays`); derselbe Kalendertag darf in zwei
    Beschäftigungen Urlaub sein. `cleanVacationDays` setzt den Rückfall auf `emp-1` **vor**
    der Doppelprüfung. Eintragen/Entfernen über `addVacationDay`/`removeVacationDay`
    (`src/db/employment.ts`), `remove` verlangt die Beschäftigung. Bis 1.8 war das Datum
    allein der Schlüssel — ein zweiter Urlaubstag am selben Datum ging still verloren.
    `cleanVacationDays` baut jeden Tag aus seinen Feldern neu: ein **neues Feld** am
    `VacationDay` muss dort nachgetragen werden, sonst verwirft es jedes Speichern still.
  - **Kein Sammelbericht über alle Beschäftigungen.** Ein Nachweis, der die Stunden
    zweier Arbeitgeber addiert, ist für beide unbrauchbar; der Bericht gilt für die
    gewählte Beschäftigung, und der PDF-Kopf nimmt Arbeitgeber, Personalnummer und
    Abteilung von dort (Name weiter aus dem Profil).
  - **`Profile` behält `arbeitgeber`/`personalnummer`/`abteilung`**, obwohl sie in der
    Oberfläche nicht mehr vorkommen: ältere Backups tragen sie, `cleanProfile` liest
    sie, und aus ihnen entsteht beim Import die erste Beschäftigung.
  - **Zusammenführen beim Backup-Import (AUF-010):** Eine Beschäftigung des Backups mit
    gleicher `id` füllt nur **leere Feldgruppen** der lokalen (`fillEmptyEmployment` in
    `src/db/backup.ts`): den Vertrag, wenn lokal 0 Wochenstunden stehen und das Backup mehr
    bringt — dann als Ganzes, auch über lokal gesetzte Arbeitstage hinweg; Arbeitgeber,
    Personalnummer und Abteilung, wenn alle drei leer sind; den Namen nur mit ihnen und nur
    statt „Beschäftigung 1". Unbekannte IDs kommen hinzu. Ein v1/v2-Backup läuft als eine
    Beschäftigung `emp-1` (Profil + `employment`) durch dieselbe Regel; fehlt `emp-1` lokal,
    entsteht sie. Grund: Beim ersten Öffnen speichert die App eine leere
    Standard-Beschäftigung. Vorher gewann sie beim Zusammenführen (v3), oder die erste
    Beschäftigung wurde ganz überschrieben, samt Name und Arbeitgeber (v1/v2).
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
- **Arbeitstage als Wochentage (AUF-027):** `Employment.workWeekdays?: number[]` (0 = Sonntag …
  6 = Samstag, aufsteigend, 1–6 Tage); fehlt = nicht gewählt. `cleanWorkWeekdays` prüft,
  `cleanEmployment` setzt `workdaysPerWeek` dann auf die Länge — die Zahl bleibt gespeichert, weil
  Tagessoll, Urlaubsanspruch, ältere App-Versionen und Backups sie lesen. `workdaysInRange(von, bis,
  emp)` zählt nur `workWeekdaysOf(emp)`; ohne Auswahl gilt die alte Regel (Mo–Fr, ab sechs Tagen auch
  Sa) — die App rät keine Verteilung. Formular `WorkWeekdaysField` (sieben Knöpfe, höchstens sechs
  Tage, der letzte bleibt, `toggleWorkWeekday`); bei 1–4 Tagen ohne Auswahl keine Vorbelegung, sondern
  ein Hinweis (`displayedWorkWeekdays`). Feldgruppe Vertrag in `fillEmptyEmployment`; Backupformat
  bleibt 3. `vacationRequestRanges` bündelt über freie Wochentage hinweg.
- **Urlaub entlastet das Konto (seit 1.4):** `buildBalanceLedger(emp, entries, ref, vacationDates?)`
  weist je Monat `vacationDays` + `vacationCreditMs` aus; `saldoMs = istMs + vacationCreditMs − sollMs`.
  Ohne den 4. Parameter rechnet die Funktion unverändert. **Zwei Deckel nicht verwechseln:**
  taggenau in `vacationOfMonth` via `max(0, Tagessoll − Ist dieses Tages)` gegen Doppelzählung,
  wenn derselbe Tag zusätzlich als Zeiteintrag erfasst wurde; monatlich via `min(credit, sollMs)`,
  damit reiner Urlaub keine Überstunden erzeugt. Nicht gegen das Monats-`istMs` deckeln — das zöge
  das Ist zweimal ab und entwertete Arbeit an urlaubsfreien Tagen.
- **Mit dem Gehalt abgegoltene Überstunden (AUF-016):** `Employment.includedOvertimeHoursPerMonth`,
  `null` = keine Klausel. `buildBalanceLedger` weist je Monat
  `includedOvertimeMs = min(includedOvertimeCapMs, max(0, saldoMs))` aus; `saldoMs` bleibt roh,
  Übertrag und Gesamtsaldo ziehen die Abgeltung ab. **Jeder Monat für sich:** Minusstunden aus
  Vormonaten mindern die Abgeltung nicht — der zugrunde liegende Vertrag zählt Überstunden pro
  Monat und kennt kein Arbeitszeitkonto, und verrechnet werden darf nur, was die Vereinbarung
  vorsieht (BAG, Urteil vom 21.03.2012 – 5 AZR 676/11, Leitsatz). Im Teilmonat gilt die Grenze
  anteilig wie das Soll (`employedFractionOfMonth`, aus `monthSollMs` herausgezogen). Anzeige:
  Zeile „mit Gehalt abgegolten" in Auswertung und PDF; der Text des Kontoblocks entsteht in
  `buildKontoPanelText` (rein, getestet). Das Feld gehört zur Feldgruppe Vertrag von
  `fillEmptyEmployment`; Backupformat bleibt Version 3.
- **Kontohinweis je Beschäftigung (AUF-017):** `Employment.balanceNote` (leer = kein Satz)
  ersetzt den bis 1.7 festen Satz „Ausgleich n. § 2 (4) Arbeitsvertrag." in der Fußnote des
  PDF-Kontoblocks; gedruckt getrimmt direkt nach „Beschaeftigt seit …". **Fehlt der
  Schlüssel** (ältere Daten und Backups), setzt `cleanEmployment` den bisherigen Satz
  (`LEGACY_BALANCE_NOTE`), damit sich ohne Zutun kein Nachweis ändert; neue Beschäftigungen
  beginnen leer — die App erfindet keine Fundstelle. Feldgruppe Vertrag in
  `fillEmptyEmployment`: Eine frisch geöffnete App trägt eine Standard-Beschäftigung mit
  leerem Hinweis, den Satz eines v1/v2-Backups bringt beim Zusammenführen nur diese Gruppe.
- **Feiertage (AUF-028–030):** `src/domain/holidays.ts` (rein) berechnet die gesetzlichen Feiertage je
  Bundesland (`holidaysOf`): Listen aus den 16 Landesgesetzen, 3. Oktober nach Art. 2 Abs. 2
  Einigungsvertrag, Ostern nach der Rechenvorschrift der PTB (`easterSunday`, gegen deren Tabelle
  1980–2031 getestet), Himmelfahrt/Pfingsten/Fronleichnam als Ostern + 39/49/60, Buß- und Bettag als
  Mittwoch vor dem Sonntag vor dem 1. Advent; regional zuschaltbar Mariä Himmelfahrt und Friedensfest
  (BY), Fronleichnam (SN, TH); einmalig der 17. Juni 2028 in Berlin; gleiche Tage ein Eintrag. **Frühere
  Jahre nach damaligem Recht ab 2017 (AUF-042, Entscheidung des Users):** `SEIT` — später eingeführte
  Feiertage zählen erst ab ihrem Tag (Frauentag BE ab 7.2.2019, MV ab 13.7.2022; Reformationstag HB und NI
  ab 29.6.2018, HH ab 20.3.2018, SH ab 22.2.2018; Weltkindertag TH ab 28.2.2019) — und `EINMALIG`
  (31.10.2017 in BE, BY, HB, HE, NI, NW; Berlin 8.5.2020, 8.5.2025, 17.6.2028); davor gilt der Stand von
  2017. Für BW, HH, RP, SH und SL ist der 31.10.2017 **nicht amtlich belegt** und nicht abgebildet;
  `holidayHistoryNote` sagt es am **Ende** des Feiertagsabschnitts (nicht zwischen „Feiertage <Jahr>." und
  der Liste — die Probe von AUF-030 liest die Liste als nächstes Element). Belege (Gesetzblätter, für SH
  und TH Landtagsbeschlüsse): `docs/STATE.md`, Session 2026-11-18. Sonntage zählen nicht. Quellen und
  Prüfung: `docs/STATE.md`, Session 2026-11-17. Je Beschäftigung `Employment.publicHolidays?`
  (`land`, `regional`, `extra`, `skip`; fehlt = keine Feiertage, wie bis 1.12), geprüft in
  `cleanPublicHolidays`, Feldgruppe Vertrag in `fillEmptyEmployment`. Konto: ein Feiertag an einem
  eigenen Arbeitstag füllt bis zum Tagessoll auf, abzüglich am Tag erfasster Zeit (§ 2 Abs. 1 EntgFG);
  Urlaub und Feiertage zusammen höchstens das Monats-Soll; `MonthBalance.holidayDays/holidayCreditMs`.
  Ein Urlaubstag auf einem Feiertag zählt weder als genommen noch in der Gutschrift, ein Zeitraum
  überspringt Feiertage (§ 3 Abs. 2 BUrlG). Oberfläche: `HolidaySettingsField` (Land, regionale Tage,
  Vorschau des Jahres zum Streichen, eigene Tage), Hinweis am Urlaubstag (`VacationDayRow` bekommt die
  Beschäftigung), Zeile „Feiertage (n Tage)" in Auswertung und PDF-Kontoblock samt Fußnotensatz.
- **Vertrag gültig ab (AUF-031/032):** `Employment.contractHistory?: ContractPeriod[]` (`validUntil` =
  lokale Mitternacht des letzten Tages, `weeklyHours`, `workdaysPerWeek`, `workWeekdays?`), aufsteigend;
  fehlt = der Vertrag galt immer wie heute. `contractAt(emp, tag)` liefert die Bedingungen eines Tages,
  `cleanContractHistory` prüft. Monats-Soll je Kalendertag nach dem Vertrag des Tages (ohne Historie der
  bisherige Weg), ebenso das Tagessoll der Gutschriften und die Wochentage (`wochentageAm`).
  `annualEntitlement` und die abgegoltenen Überstunden rechnen weiter mit dem aktuellen Vertrag.
  Formular: Ändern sich Wochenstunden oder Arbeitstage, fragt `ContractChangeField` „Gilt ab"
  (vorbelegt: 1. des laufenden Monats) oder „Korrektur von Beginn an"; `historyAfterChange`
  (`src/domain/contract-change.ts`) hängt den bisherigen Vertrag bis zum Vortag an — `null` bei einem
  Datum nicht nach dem Beginn der Beschäftigung bzw. des laufenden Vertrags (Meldung, nichts
  gespeichert). Keine Änderung: erstes Eintragen (0 Wochenstunden) und **erstmaliges Wählen der
  Wochentage bei gleicher Zahl** (sonst zählte ein Urlaubszeitraum vor dem Stichtag wieder Mo–Fr).
  Frühere Stände lassen sich entfernen. Feldgruppe Vertrag in `fillEmptyEmployment`; Backupformat
  bleibt 3. Der Abschnitt „App-Update" steht in `UpdateSection.tsx` (MoreScreen hatte 797 Zeilen).
- **Krankheit (AUF-033/034):** `SickPeriod {employmentId, from, to, certificate}` (Kalendertage
  einschließlich Wochenende, lokale Mitternacht) in `src/domain/sickness.ts`, gespeichert in Preferences
  `sickPeriods` (`src/db/sickness.ts`, Hook `useSickPeriods`) und im Backup (Feld `sickPeriods`, fehlt in
  älteren). Überschneidende Zeiträume derselben Beschäftigung: `addSickPeriod` weist ab (`null`),
  Bereinigen und Zusammenführen behalten den früheren bzw. lokalen. `splitVacationAndSickness` trennt
  nach § 9 BUrlG: Urlaubstag in einem Zeitraum **mit** Bescheinigung → Krankheitstag, **ohne** → bleibt
  Urlaub. Konto: `buildBalanceLedger(…, vacationDates, sickDates)`; `sickOfMonth` schreibt an eigenen
  Arbeitstagen bis zum Tagessoll gut, abzüglich erfasster Zeit (§ 4 Abs. 1 EntgFG); Feiertag und Urlaub
  gehen vor, auch bei ungetrennten Listen zählt kein Tag doppelt; Urlaub, Feiertage und Krankheit
  zusammen höchstens das Monats-Soll; `MonthBalance.sickDays/sickCreditMs`. Die Gutschrift „bis zum
  Tagessoll, abzüglich erfasster Zeit" steht für alle drei in `fillUpCreditMs`. Die Gutschrift endet
  nicht nach sechs Wochen; `longSickRuns` meldet zusammenhängende Krankheit über 42 Kalendertage (§ 3
  Abs. 1 EntgFG, aneinandergrenzende Zeiträume zählen zusammen). Wartezeit (§ 3 Abs. 3 EntgFG, AUF-041):
  fällt eine Krankheitszeit in die ersten vier Wochen ab „Beschäftigt seit" (28 Kalendertage, letzter Tag
  Beginn + 27), zeigt `SickPeriodsSection` einen Hinweis (`waitingPeriodSick`, `waitingPeriodHint`) — nur
  ein Hinweis, das Konto rechnet weiter wie bei jeder Krankheit (wie beim Sechs-Wochen-Hinweis).
  `removeEmployment` sperrt bei Krankheitszeiten. Oberfläche: `SickPeriodsSection`
  unter den Urlaubstagen (Beschäftigung = Urlaubsauswahl, Bescheinigung nicht vorbelegt, entfernen mit
  Rückfrage, Sechs-Wochen-Hinweis), § 9-Hinweis an `VacationDayRow`, Zeile „Krankheit (n Tage)" in
  Auswertung und PDF-Kontoblock samt Fußnotensatz; ReportsScreen trennt vor Konto und Urlaubsstand. Ein
  in Clockodo beantragter Urlaubstag bleibt dort bestehen, auch wenn er hier als Krankheit zählt;
  Klarzeit ändert den Antrag nicht, die Zeile sagt es („dort weiter als Urlaub, Klarzeit aendert den
  Antrag nicht", `isSickInClockodoVacation`, nur Status 0/1; AUF-038). Der Abgleich beantragt keinen
  Urlaubstag, der hier als Krankheit mit Bescheinigung zählt, und zählt ihn nicht als offen
  (`vacationRequestRanges`/`openVacationDayCount` mit `sickPeriods`, AUF-038); bis 1.13.0 tat er es.
- **Geänderte Stoppuhr-Einträge (AUF-035):** `TimeEntry.trackedTimes?: {start, end}` — die
  Stoppuhr-Zeiten, gemerkt beim **ersten** Ändern von Beginn oder Ende (`withTrackedTimes` in
  `updateEntryWithClockodo`, `src/domain/tracked-times.ts`); spätere Änderungen lassen sie stehen,
  Tätigkeit/Notiz/Pausen allein merken nichts, nachgetragene Einträge bekommen keine.
  `changedTrackedTimes` liefert sie nur, wenn die heutigen Zeiten abweichen: Hinweis „geaendert,
  Stoppuhr 08:00–16:00" in „Eintraege", „°" vor der Tätigkeit im PDF samt Legende (`entryMark`,
  `entryLegend`), Quelle „erfasst, geaendert (Stoppuhr …)" in der CSV. `cleanEntry` trägt das Feld
  (`cleanTrackedTimes`).
- **Veranlassung von Überstunden (AUF-036):** `TimeEntry.overtimeAuthorization?: string` (getrimmt,
  höchstens 300 Zeichen, `cleanOvertimeAuthorization`; leer = keine Angabe). Feld im Eintragsformular mit
  Hinweis auf BAG, Urteil vom 04.05.2022 – 5 AZR 359/21 (Leitsatz: „…hat er im Prozess die Leistung
  solcher und deren Veranlassung durch den Arbeitgeber darzulegen."). Zeile „Veranlassung: …" in
  „Eintraege" und als Zeile unter dem Eintrag in der PDF-Tabelle (keine Fußnotenliste: die Tabelle setzt
  Seitenumbrüche selbst), letzte CSV-Spalte „Veranlassung"; `cleanEntry` trägt das Feld; nicht an
  Clockodo. `EntryDraft.overtimeAuthorization` ist Pflicht (Dexie-`update`, wie `breaks`).
- **Hinweise nach dem Arbeitszeitgesetz (AUF-037):** `arbzgHints(entries, day)` (`src/domain/arbzg.ts`,
  rein) je Kalendertag über **alle** Beschäftigungen (§ 2 Abs. 1 Satz 1 ArbZG): mehr als 10 Stunden
  (§ 3), Pausen 30/45 Minuten (§ 4 Satz 1; mit Uhrzeit nur Abschnitte ab 15 Minuten, Lücken zwischen
  Einträgen ab 15 Minuten zählen), mehr als 6 Stunden am Stück (§ 4 Satz 3, nur wo die Pausen mit Uhrzeit
  bekannt sind), Ruhezeit unter 11 Stunden seit der Arbeit an einem früheren Tag (§ 5 Abs. 1).
  „Erfassung" (heute) und „Eintraege" (je Tag) zeigen sie als `error-text`; nichts wird gesperrt, nicht
  im PDF. Die Voraussetzungen der Verlängerung nach § 3 und die Ausnahmen des Gesetzes sind nicht
  abgebildet.
- **Nicht abgebildet:** sonstige bezahlte Freistellung (außer Feiertagen und Krankheit) erzeugt
  weiterhin Minusstunden; halbe Urlaubstage sind konstruktiv unmöglich (`taken` ist `.length`); kein
  Resturlaub-Übertrag (§ 7 III BUrlG); `VacationDay.note` existiert, ist in der UI aber tot.
  Ausgezahlte Überstunden lassen sich nicht buchen (das Konto behält sie als Guthaben), eine
  Genehmigung von Überstunden kennt die App nicht — ihre Veranlassung lässt sich je Eintrag vermerken
  (AUF-036).
- **Pausen mit Uhrzeit (AUF-011):** `TimeEntry.breaks?: BreakInterval[]` (Beginn/Ende, epoch ms).
  Fehlt das Feld, sind keine Pausenzeiten bekannt (Einträge vor 1.7) und allein `breakMinutes`
  gilt. `breakMinutes` bleibt gespeichert und ist weiter die Rechengrundlage für `netMs`, PDF,
  CSV und Konto; das Formular setzt es über `resolveBreakMinutes` aus den Pausen. Die Regeln
  stehen je an einer Stelle in `validateBreaks` (`src/domain/breaks.ts`). Jeder `EntryDraft`
  trägt `breaks` ausdrücklich, auch leer — `updateEntry` nutzt Dexies `update`, das ein
  fehlendes Feld stehen ließe. **Keine vorbelegten Pausenzeiten** (Anlass: Übertragung an
  Clockodo, das Pausen nur als Lücke zwischen Einträgen kennt).
- **Datum im Formular (AUF-026):** Wechselt „Beginn" den Kalendertag, rückt „Ende" um dieselbe
  Zahl Tage mit und behält seine Uhrzeit (`followStartDate` in `src/domain/entry-dates.ts`, über
  `date-fns`, sommerzeitfest); ändert sich nur die Uhrzeit, bleibt das Ende — eine Nachtschicht
  behält so ihren Folgetag. Bezugspunkt ist der letzte **gültige** Beginn (`lastStart` im
  Formular), ein zwischendurch geleertes Feld verliert ihn nicht. „Ende" zieht nichts mit.
  **Pausen nur als Uhrzeit** (`type="time"`, Formularzustand `breakRows` mit „HH:mm"):
  `breakTimeOnEntry` legt sie auf den Tag des Beginns, liegt die Uhrzeit dort vor dem Beginn, auf
  den Folgetag — aber nur, wenn sie dann nicht nach dem Ende liegt; sonst bleibt sie am Tag des
  Beginns, und `validateBreaks` meldet „ausserhalb". Gespeichert wird weiter Epoch-ms. **Grenze:**
  bei Einträgen über 24 Stunden landet eine Pause am zweiten Tag, deren Uhrzeit nach der des
  Beginns liegt, am ersten Tag. Ein geleertes „Beginn"/„Ende" zeigt ein leeres Feld
  (`dateTimeInputValue`); bis 1.11 warf `toDatetimeLocal(NaN)` beim Zeichnen, und die App wurde weiß.
- **Clockodo-Zugang je Beschäftigung (AUF-012):** `Employment.clockodo: ClockodoConfig | null`
  (`src/domain/clockodo.ts`; `null` = aus, `apiUser` darf leer sein). Client
  `src/clockodo/client.ts` mit einsetzbarem HTTP (Standard `CapacitorHttp`, nur nativ),
  Primärquelle `https://docs.clockodo.com/openapi.yaml`. **Der API-Schlüssel liegt nur im
  Android KeyStore** (`src/clockodo/key-store.ts`, `capacitor-secure-storage-plugin`) — nie in
  Preferences, `Employment`, Backup oder einer Meldung; seine Datei `cap_sec.xml` ist über
  `res/xml/backup_rules.xml` + `data_extraction_rules.xml` aus Cloud-Backup und Geräteumzug
  ausgenommen (nur `<exclude>` — ein `<include>` schaltete die übrige Sicherung ab).
  Listen (Kunden/Projekte/Leistungen, nur aktive) im Zwischenspeicher
  `src/db/clockodo-lists.ts`, nicht im Backup. Ausschalten löscht Schlüssel und Listen erst
  beim **Speichern**; `removeEmployment` löscht sie mit. Firmendaten (Namen, IDs) gehören nie
  in Code oder Tests — Testwerte ohne `@`, der Privacy-Scan meldet jede E-Mail-Form.
- **Clockodo-Auswahl je Eintrag (AUF-013):** `TimeEntry.clockodo?: ClockodoEntryRef | null`
  (Kunde + Leistung Pflicht, Projekt optional; `cleanClockodoEntryRef` verwirft den ganzen Ref
  bei einer kaputten Projekt-ID). Das Formular zeigt die Auswahl nur bei Beschäftigungen mit
  Zugang, Startwert `entrySelectionStart` (die Vorgaben der Beschäftigung, seit AUF-039 auch nur
  Kunde oder nur Leistung; 0 heißt „nicht gewählt", ohne Scheinoption „ID 0", `withStaleOption`);
  `EntryDraft.clockodo` ist Pflicht (Dexie-`update`, wie `breaks`). Gespeichert wird nur eine
  vollständige Auswahl, sonst `null`. Einträge ohne Auswahl bekommen die Vorgabe **nicht** still beim
  Übertragen (Entscheidung AUF-039: sonst landete ein Eintrag ungefragt beim falschen Kunden).
- **Übertragung an Clockodo (AUF-014/015), nur Klarzeit → Clockodo, auf Knopfdruck oder — wenn
  eingeschaltet — automatisch (AUF-025):**
  `src/domain/clockodo-transfer.ts` (rein): je Arbeitsabschnitt zwischen den Pausen ein
  Clockodo-Eintrag (`workSegments`, `buildEntryPayloads`), UTC ohne Millisekunden, Prüfsumme
  `entrySyncHash` (FNV-1a über das Gesendete), `transferStatus` in fester Reihenfolge
  (none, done, before-start, untimed-break, incomplete, pending, changed, synced). Der Clockodo-Kasten in
  „Eintraege" zählt auch die Einträge vor „Uebertragen ab", jeder trägt den Stand „vor „Uebertragen
  ab" – wird nicht uebertragen" (`countTransferBuckets` in der Domäne; AUF-039, vorher fielen sie
  still heraus).
  `TimeEntry.clockodoSync` = IDs der angelegten Einträge + Prüfsumme; nicht im `EntryDraft`
  (so bleibt ein bearbeiteter Eintrag als `changed` erkennbar), im Backup. Ablauf
  `src/clockodo/transfer.ts`: Löschvermerke (`clockodoDeletes:<id>`) zuerst, geänderte
  Einträge erst einzeln löschen, dann neu senden; scheitert ein Abschnitt, werden die schon
  angelegten wieder gelöscht, und **scheitert auch das, wird der Abschnitt vermerkt** (sonst
  Doppelbuchung). `auth`/`network`/`rate` brechen den ganzen Lauf ab. Client: erst Status,
  dann JSON (ein 401 mit Nicht-JSON-Antwort muss als `auth` ankommen). „Alle Einträge
  löschen" und Backup-Ersetzen vermerken nichts — nur das Löschen eines übertragenen
  Eintrags in der Liste (`deleteEntryWithClockodo`) und ein Bearbeiten, mit dem er die
  Übertragung verlässt (AUF-022).
- **Korrekturen an übertragenen Einträgen (AUF-022):** Bearbeiten in der Liste speichert über
  `updateEntryWithClockodo` (`src/db/entries.ts`). Wechselt ein übertragener Eintrag die
  Beschäftigung oder verliert er bei **eingeschaltetem** Clockodo die Auswahl, werden seine IDs
  Löschvermerke der **bisherigen** Beschäftigung (deren Zugang sie angelegt hat), und
  `clockodoSync` fällt weg; der nächste Lauf dort löscht sie, die neue Beschäftigung sendet frisch.
  Bei ausgeschaltetem Clockodo liefert das Formular immer `clockodo: null` — keine Entscheidung
  des Nutzers, es wird nichts vermerkt. Der Clockodo-Kasten in „Eintraege" zählt offene
  Löschvermerke („n zu loeschen"); die Rückfrage „Alle Daten loeschen" sagt, dass Übertragenes in
  Clockodo stehen bleibt. Rückt ein übertragener Eintrag vor „Uebertragen ab" (bisheriger Beginn am
  oder nach dem Tag, neuer davor), werden seine IDs ebenso vorgemerkt (AUF-039); lag er schon davor
  (etwa weil „Uebertragen ab" später gesetzt wurde), ändert ein Bearbeiten nichts an Clockodo.
- **Von Hand erledigt (AUF-040), Entscheidung des Users „endgültig":** Ein offener, nie übertragener
  Eintrag (ohne `clockodoSync`, Stand `pending`, `incomplete` oder `untimed-break`; `canMarkClockodoDone`)
  lässt sich in „Eintraege" als in Clockodo erledigt markieren — für einen gesperrten Eintrag, den der
  Vorgesetzte dort von Hand nachträgt. `TimeEntry.clockodoDone` = Zeitpunkt (`cleanClockodoDone`, im
  Backup über `cleanEntry`); `transferStatus` liefert dann `done`, gleich nach `none` und **auch nach einer
  Änderung**; der Lauf überspringt ihn (ohne Zählung, `TransferResult` unverändert), er zählt nicht als
  offen, Stand „von Hand erledigt – wird nicht uebertragen". „wieder offen" entfernt das Feld
  (`setEntryClockodoDone(id, null)`). Rückfragen mit Tag und Folge (`clockodoDoneQuestion`). Löschen
  vermerkt nichts (keine IDs von Klarzeit in Clockodo).
- **Urlaubsanträge an Clockodo — Bausteine (AUF-019):** `VacationDay.clockodoAbsence?` =
  `{ id, status, at }` des Clockodo-Antrags (Status 0 beantragt … 4 storniert, openapi
  `AbsenceStatus`); fehlt = nie beantragt, `cleanVacationDays` trägt einen gültigen Verweis,
  sonst fehlt der Schlüssel ganz. `vacationRequestRanges` (`src/domain/clockodo-absence.ts`,
  rein): offene Tage (ohne Verweis, ab `syncFrom`, seit AUF-038 ohne Krankheitstage mit
  Bescheinigung — ein solcher Tag trennt den Antrag) werden zu Zeiträumen gebündelt, solange kein
  Arbeitstag dazwischen liegt (Regel von `workdaysInRange`); der Jahreswechsel trennt (Clockodo
  verlangt `date_until` im Jahr von `date_since`). Client `createAbsence` (`POST /v4/absences`,
  ausdrücklich `users_id`, Typ 1, **Status 0**) und `fetchAbsences` (Filter Person, Jahr, Typ 1;
  ein kaputter Eintrag ist `format`, kein stilles Überspringen). Fehlertypen aus beiden
  Fehlerformen, auch aus JSON-Text: 409/`AbsenceCollision` → `collision`,
  `StatusIsForbidden`/`CannotManageAbsencesOfUser` → `forbidden`.
- **Urlaubsanträge — Ablauf (AUF-020), nur auf Knopfdruck:** `transferVacations`
  (`src/clockodo/vacation-transfer.ts`). Zugang wie `transferEmployment`; ohne betroffene Jahre
  keine einzige Anfrage. **Erst lesen, dann senden:** `fetchMe` + `fetchAbsences` je Jahr —
  scheitert das, wird nichts gesendet. Dann Status nachziehen (`syncAbsenceStatus`; ein in
  Clockodo verschwundener Antrag behält seinen Verweis und zählt als `missing`, er wird **nicht**
  neu gestellt). Je offenem Zeitraum: gleicher Zeitraum in Clockodo → übernehmen (verlorene
  Antwort, zurückgespieltes Backup), sonst beantragen; jeder Erfolg wird **sofort** vermerkt
  (`setVacationAbsenceRef`). `auth`/`network`/`rate` brechen ab, alles andere trifft nur den
  eigenen Zeitraum. Weicht Clockodos `countDays` von Klarzeits Tageszahl ab → `mismatches`.
- **Urlaubsanträge — Oberfläche (AUF-021):** im Urlaubsbereich von „Mehr" (`VacationSection`) der Knopf
  „Urlaub mit Clockodo abgleichen" (`src/ui/components/VacationClockodo.tsx`, nur für die im Feld
  „Urlaub fuer Beschaeftigung" gewählte Beschäftigung mit Zugang, im Browser gesperrt) und je Tag
  der Stand (`VacationDayRow`, `absenceStatusLabel`). **Beantragte und genehmigte Tage lassen
  sich nicht entfernen** (`isVacationDayRemovable`: erst ab Status 2) — die Sperre sitzt in der
  Oberfläche, `removeVacationDay` selbst prüft nicht. Die Auswahl „Urlaub fuer Beschaeftigung"
  (`vacEmpId`) bleibt in `MoreScreen`; an ihr hängen `VacationSection` und `SickPeriodsSection`.
- **Urlaubsantrag zurückziehen (AUF-023), nur auf Knopfdruck:** Ein beantragter oder genehmigter
  Tag einer Beschäftigung mit Clockodo zeigt statt des Hinweises „zurueckziehen" (`VacationDayRow`,
  im Browser gesperrt). Der Knopf gilt für den **ganzen** Antrag; die Rückfrage nennt Zeitraum und
  Zahl der Tage (`vacationWithdrawQuestion`). `withdrawVacationRequest`
  (`src/clockodo/vacation-transfer.ts`): erst `deleteAbsence` (`DELETE /v4/absences/{id}`), darf
  Klarzeit das nicht, `cancelAbsence` (`PUT`, Status 4); `404` heißt schon weg; `auth`/`network`/
  `rate` brechen **ohne** Stornieren ab. **Erst nach Erfolg** entfernt
  `removeVacationDaysOfAbsence` die Tage (`daysOfAbsence`: Beschäftigung **und** Antrags-ID).
  Erst löschen, weil ein stornierter Antrag einen neuen Antrag für dieselben Tage als
  „übernommen" schlucken würde (`transferVacations` übernimmt gleiche Zeiträume jeden Status).
  Welcher Weg einem Mitarbeiter erlaubt ist, belegt die Spec nicht (`info.version` 2026-10-09) —
  das zeigt der Gerätetest. Ein in Clockodo verschwundener Antrag ist damit keine Sackgasse mehr
  (Knopf → `404` → Tage weg). `AbsenceHasToBeDeclined` → `forbidden`. Die Zugangsprüfung teilen
  sich `transferVacations` und `withdrawVacationRequest` (`clockodoZugang`).
- **Clockodo-Sperrfrist (AUF-024):** `fetchMe` liest `edit_lock_dyn` (openapi „Relative editing
  lock in days", Enum 1–91; Klarzeit nimmt jede positive ganze Zahl, sonst `null` = keine
  Sperrfrist). `refreshClockodoLock` (`src/clockodo/lock.ts`) merkt sie je Beschäftigung in
  Preferences `clockodoLock:<employmentId>` = `{ days, at }` (`src/db/clockodo-lock.ts`, nicht im
  Backup; kaputt heißt unbekannt); ohne Zugang oder bei einem Fehler bleibt die gemerkte.
  Aufgefrischt wird bei „Verbindung testen" und von der Oberfläche **vor** jedem Übertragen —
  nicht in `transferEmployment`: ein GET mehr dort machte fünf Übertragungstests rot, die die
  Anfragefolge prüfen. Letzter Sendetag = Eintragstag + Frist − 1 in **Kalendertagen**
  (`lastSendDay`/`lockState` in `src/domain/clockodo-lock.ts`, über `date-fns`, sommerzeitfest).
  Offen sind `pending`, `changed`, `incomplete`, `untimed-break`. „Erfassung" warnt bei
  heute/morgen letztem Tag und unbekannter Frist (`lockHint` mit `locked: 0` — ein gesperrter
  Eintrag ließe sich dort nie wegklicken), „Eintraege" zusätzlich bei gesperrten; der Stand je
  Eintrag trägt die Frist (`clockodoEntryLabel`). Ein 403 an einem Eintrag jenseits der Frist
  meldet `transferEmployment` als „In Clockodo gesperrt (Sperrfrist n Tage) – Vorgesetzten
  fragen." (`lockedEntryMessage`). Ausschalten beim Speichern und `removeEmployment` entfernen die
  gemerkte Frist. Beobachtet (Frist 3, an einem Freitag): Einträge von Montag und Dienstag mit 403
  abgelehnt, die übrigen der Woche angenommen; ob Clockodo Kalender- oder Arbeitstage zählt, ist
  offen. `edit_lock` (festes Datum) bleibt außen vor — ob der Tag selbst gesperrt ist, sagt die
  Spec nicht.
- **Automatisch übertragen (AUF-025):** `ClockodoConfig.autoTransfer?: boolean` (fehlt = aus;
  `cleanClockodoConfig` trägt es nur bei `true` — als Pflichtfeld wären drei bestehende Tests rot
  geworden und sechs Testdateien mit getypten Konstanten nicht mehr durch `tsc` gekommen).
  **Lauf-Schloss** in `transferEmployment`: je Beschäftigung eine Promise-Kette (`laeufe`), ein
  zweiter Aufruf wartet auf den ersten, ein gescheiterter Lauf hält den nächsten nicht auf —
  gemessen: ohne Schloss buchen zwei gleichzeitige Läufe doppelt (4 statt 2 POST). `skipLocked`
  (nur der automatische Lauf) lässt Einträge jenseits der gemerkten Sperrfrist aus, ungezählt;
  der Knopf versucht sie weiter. `runAutoTransfer` (`src/clockodo/auto-transfer.ts`): je
  Beschäftigung mit Schalter erst `refreshClockodoLock`, dann `transferEmployment(…, { skipLocked:
  true })`; der Fehler einer Beschäftigung wird ihr Abbruchgrund, die nächste läuft trotzdem.
  Ergebnis nur für diese Sitzung (`lastAutoTransferResults`, Hörer, `useAutoTransferResults`).
  Auslöser über `startAutoTransfer` (nur nativ): App-Start, Rückkehr in die App
  (`appStateChange`), Speichern oder Löschen eines Eintrags in „Erfassung" und „Eintraege". Ein
  Hinweis erscheint nur bei Abbruch oder Fehlern (`autoTransferHint`), in „Erfassung" und im
  Clockodo-Kasten. Urlaubsanträge bleiben auf Knopfdruck.
- **„Mehr" aufgeteilt (AUF-043):** `MoreScreen.tsx` (229 Zeilen, vorher 770) setzt die Abschnitte
  zusammen — `ProfileSection`, `EmploymentEditForm`, `VacationSection`, `BackupSection` (alle
  `src/ui/components/`), dazu wie bisher `SickPeriodsSection` und `UpdateSection`; bewegter Code
  wörtlich. **In `MoreScreen` bleibt, was das Formular „Beschaeftigung bearbeiten" überdauert:** der
  Entwurf (`editingId`, `editDraft`), „Gilt ab" (`aenderungAb`, jedes Öffnen setzt es zurück),
  „Gespeichert" (`empFlash`, steht noch da, wenn das Formular kurz nach dem Speichern wieder geöffnet
  wird), die Urlaubsauswahl `vacEmpId` und alle Hooks (die Ladesperre „Lade…" wartet auf sie). Eigenen
  Zustand dürfen die Abschnitte nur halten, weil `loading` der Hooks einmal von `true` auf `false`
  springt und nie zurück — sonst hängte die Ladesperre sie bei jedem Neuladen aus, und Eingaben gingen
  verloren. Probe `tools/oberflaeche/auf043_ui.mjs`: U1–U3 prüfen genau diese Lebensdauern; mit
  `AUF043_DATEI=<datei>` nimmt sie in 15 Zuständen das DOM von „Mehr" ab (Vergleich alter gegen neuer
  Stand).
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
- `src/domain/employment.ts` → Feldname `includedOvertimeHoursPerMonth` (Preferences
  `employments` und Backup; umbenannt verwirft `cleanEmployment` den Wert, und das Konto
  schreibt wieder jedes Monatsplus voll gut)
- `src/domain/employment.ts` → Feldname `balanceNote` (Preferences `employments` und Backup;
  umbenannt gilt das Feld als fehlend — `cleanEmployment` setzt wieder den alten festen Satz,
  jeder eingetragene Hinweis ist weg)
- `src/domain/types.ts` → Feld `breaks` mit `start`/`end` am `TimeEntry` (steht in der
  Dexie-Datenbank und in jedem Backup; umbenannt verwirft `cleanBreaks` beim Import jede
  Pausenzeit)
- `src/domain/clockodo.ts` → Feld `clockodo` am `Employment` samt `apiUser`, `syncFrom`,
  `defaultCustomersId`, `defaultProjectsId`, `defaultServicesId`, `billable`, `autoTransfer`
  (Preferences `employments` und Backup; `autoTransfer` umbenannt schaltet das automatische
  Übertragen still ab); Preferences-Schlüssel `clockodoLists:<employmentId>`;
  KeyStore-Schlüssel `clockodo-key-<employmentId>` (umbenannt findet die App den
  gespeicherten API-Schlüssel nicht mehr)
- `src/domain/types.ts` → Feld `clockodo` mit `customersId`/`projectsId`/`servicesId` am
  `TimeEntry` (Dexie und Backup; umbenannt verliert jeder Eintrag seine Clockodo-Auswahl)
- `src/domain/types.ts` → Feld `clockodoSync` mit `ids`/`hash`/`at` am `TimeEntry` (Dexie
  und Backup; umbenannt gelten alle Einträge als nie übertragen — der nächste Lauf bucht
  **alles doppelt**); Preferences-Schlüssel `clockodoDeletes:<employmentId>`
- `src/domain/employment.ts` → Feld `clockodoAbsence` mit `id`/`status`/`at` am `VacationDay`
  (Preferences `vacations` und Backup; umbenannt gelten alle Urlaubstage als nie beantragt — der
  nächste Abgleich findet die Zeiträume nur über „erst lesen, dann senden" wieder, Teilstücke
  stoßen als Überschneidung an)
- `src/db/clockodo-lock.ts` → Preferences-Schlüssel `clockodoLock:<employmentId>` mit `days`/`at`
  (umbenannt gilt die Sperrfrist als unbekannt, bis zum nächsten Übertragen oder „Verbindung
  testen" — kein Datenverlust, aber bis dahin fehlen die Fristwarnungen)
- `src/domain/employment.ts` → Feld `workWeekdays` am `Employment` (Preferences `employments` und
  Backup; umbenannt verwirft `cleanEmployment` die Auswahl, und jeder Urlaubszeitraum zählt wieder
  Montag bis Freitag)
- `src/domain/employment.ts` → Feld `publicHolidays` am `Employment` samt `land`, `regional`, `extra`,
  `skip`; die Schlüssel der regionalen Tage (`mariaehimmelfahrt`, `friedensfest`, `fronleichnam`) und die
  Länderkürzel in `src/domain/holidays.ts` (Preferences `employments` und Backup; umbenannt gelten die
  Feiertage als ausgeschaltet — das Konto zeigt wieder Minusstunden an jedem Feiertag)
- `src/domain/employment.ts` → Feld `contractHistory` am `Employment` samt `validUntil`, `weeklyHours`,
  `workdaysPerWeek`, `workWeekdays` (Preferences `employments` und Backup; umbenannt verwirft
  `cleanEmployment` die früheren Stände, und das Konto rechnet alle Vormonate wieder mit dem heutigen
  Vertrag)
- `src/db/sickness.ts` → Preferences-Schlüssel `sickPeriods` und Backup-Feld `sickPeriods` samt
  `employmentId`, `from`, `to`, `certificate` (umbenannt gehen alle Krankheitszeiten verloren — die
  Minusstunden kehren zurück, Urlaubstage mit Bescheinigung zählen wieder als Urlaub)
- `src/domain/types.ts` → Feld `trackedTimes` mit `start`/`end` am `TimeEntry` (Dexie und Backup;
  umbenannt sieht jeder geänderte Stoppuhr-Eintrag wieder unverändert aus)
- `src/domain/types.ts` → Feld `overtimeAuthorization` am `TimeEntry` (Dexie und Backup; umbenannt gehen
  alle Vermerke zur Veranlassung verloren)
- `src/domain/types.ts` → Feld `clockodoDone` am `TimeEntry` (Dexie und Backup; umbenannt gilt jeder von
  Hand erledigte Eintrag wieder als offen — der nächste Lauf bucht ihn in Clockodo **doppelt**)

Es sind interne Bezeichner, keine Produktnamen. Eine Umbenennung würde bestehende
Datenbanken unerreichbar und ältere Backups nicht mehr importierbar machen.

## Veröffentlichung
- Repo `BosslandX/klarzeit` (MIT). **Derzeit noch PRIVAT** — public nur auf das Wort des Users. Die
  Icons tragen seit dem Pixelart-Logo (2026-11-18) keinen Schriftzug der Vorgänger-App mehr; da
  `privacy-scan.mjs` **keine Bilddateien prüft**, vor dem Public-Schalten zusätzlich zum Scan die Icons
  unter `assets/` und `android/app/src/main/res/mipmap-*`/`drawable-*` visuell kontrollieren.
- **Releases (APK + `version.json`) liegen seit 1.5.1 im ÖFFENTLICHEN `BosslandX/klarzeit-releases`**
  — einem reinen Release-Repo ohne Quellcode (Muster `zeiterfassung-releases`).
  `src/update/updater.ts` zieht `releases/latest/download/version.json` von dort. Grund: Das private
  Code-Repo liefert unauthentifiziert **HTTP 404** (`CapacitorHttp` schickt kein Token), der Updater
  war damit tot. Die öffentliche APK trägt bis 1.14.0 noch die Icons der Vorgänger-App — vom User bewusst in
  Kauf genommen (2026-09-23); die nächste APK bringt das Pixelart-Logo. Releases bis v1.4 liegen weiter im privaten Code-Repo und sind für den Updater
  unerreichbar: Wer eine ältere Version installiert hat, installiert 1.5.1 einmal von Hand.
- Commits im Releases-Repo nur als `BosslandX <20750642+BosslandX@users.noreply.github.com>` —
  kein Klarname in öffentlicher Historie.
- Im `version.json` muss die `url` exakt den Asset-Dateinamen tragen. Der enthält die Version
  (`klarzeit-<version>-release.apk`), also die **Tag-URL**
  `https://github.com/BosslandX/klarzeit-releases/releases/download/vX.Y/…` verwenden,
  nicht `releases/latest/download/…`.
- **Vor jedem Push:** `node tools/privacy-scan.mjs` — in den versionierten Dateien **0 Treffer**,
  in der Historie **keine neue Kategorie** (Stand 1.13.0: 320 Treffer in den 4 bekannten
  Kategorien Vorname, Nachname, Keystore-Passwort, Key-Passwort). Eine neue Kategorie stoppt den
  Push. Entscheidung des Users 2026-11-17; so wurden 1.11.0 bis 1.13.0 gepusht. Der Scan liest nur
  **versionierte** Dateien — neue Dateien vor dem ersten Commit gesondert prüfen (Kopie in einen
  Ordner ohne Git: `node tools/privacy-scan.mjs <ordner>` liest dann alles).
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
