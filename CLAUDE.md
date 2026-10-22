# Klarzeit (klarzeit)

> Offline-Arbeitszeiterfassung als Android-App. Single-User, kein Server, keine Cloud.

## Quick Reference
- **Typ:** Capacitor-Android-App (lokale Zeiterfassung)
- **Stack:** Vite + React 19 + TypeScript, Capacitor 8, Dexie (IndexedDB), jsPDF, date-fns
- **App-ID:** `io.github.bosslandx.klarzeit` · webDir: `dist`
- **Version:** 1.12.0 (`versionCode 16`)

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
- **Nicht abgebildet:** Feiertage, Krankheit und sonstige bezahlte Freistellung erzeugen weiterhin
  Minusstunden; halbe Urlaubstage sind konstruktiv unmöglich (`taken` ist `.length`); kein
  Resturlaub-Übertrag (§ 7 III BUrlG); `VacationDay.note` existiert, ist in der UI aber tot.
  Ausgezahlte Überstunden lassen sich nicht buchen (das Konto behält sie als Guthaben), eine
  Genehmigung von Überstunden kennt die App nicht.
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
  Zugang, Startwert `defaultEntryRef` der Beschäftigung; `EntryDraft.clockodo` ist Pflicht
  (Dexie-`update`, wie `breaks`). Gespeichert wird nur eine vollständige Auswahl, sonst `null`.
- **Übertragung an Clockodo (AUF-014/015), nur Klarzeit → Clockodo, auf Knopfdruck oder — wenn
  eingeschaltet — automatisch (AUF-025):**
  `src/domain/clockodo-transfer.ts` (rein): je Arbeitsabschnitt zwischen den Pausen ein
  Clockodo-Eintrag (`workSegments`, `buildEntryPayloads`), UTC ohne Millisekunden, Prüfsumme
  `entrySyncHash` (FNV-1a über das Gesendete), `transferStatus` in fester Reihenfolge
  (none, before-start, untimed-break, incomplete, pending, changed, synced).
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
  Clockodo stehen bleibt. Nicht abgedeckt: ein übertragener Eintrag, der vor „Uebertragen ab"
  rückt (`before-start`), bleibt in Clockodo, wie er war.
- **Urlaubsanträge an Clockodo — Bausteine (AUF-019):** `VacationDay.clockodoAbsence?` =
  `{ id, status, at }` des Clockodo-Antrags (Status 0 beantragt … 4 storniert, openapi
  `AbsenceStatus`); fehlt = nie beantragt, `cleanVacationDays` trägt einen gültigen Verweis,
  sonst fehlt der Schlüssel ganz. `vacationRequestRanges` (`src/domain/clockodo-absence.ts`,
  rein): offene Tage (ohne Verweis, ab `syncFrom`) werden zu Zeiträumen gebündelt, solange kein
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
- **Urlaubsanträge — Oberfläche (AUF-021):** im Urlaubsbereich von `MoreScreen` der Knopf
  „Urlaub mit Clockodo abgleichen" (`src/ui/components/VacationClockodo.tsx`, nur für die im Feld
  „Urlaub fuer Beschaeftigung" gewählte Beschäftigung mit Zugang, im Browser gesperrt) und je Tag
  der Stand (`VacationDayRow`, `absenceStatusLabel`). **Beantragte und genehmigte Tage lassen
  sich nicht entfernen** (`isVacationDayRemovable`: erst ab Status 2) — die Sperre sitzt in der
  Oberfläche, `removeVacationDay` selbst prüft nicht. Der Zustand des Urlaubsbereichs bleibt in
  `MoreScreen`: `vacEmp` ist zugleich der Ausgangswert des Beschäftigungs-Formulars.
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
