# Klarzeit (klarzeit)

> Offline-Arbeitszeiterfassung als Android-App. Single-User, kein Server, keine Cloud.

## Quick Reference
- **Typ:** Capacitor-Android-App (lokale Zeiterfassung)
- **Stack:** Vite + React 19 + TypeScript, Capacitor 8, Dexie (IndexedDB), jsPDF, date-fns
- **App-ID:** `io.github.bosslandx.klarzeit` · webDir: `dist`
- **Version:** 1.3 (`versionCode 4`)

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
- Öffentliches Repo: `BosslandX/klarzeit` (MIT). Releases (APK + `version.json`) liegen
  im selben Repo; `src/update/updater.ts` zieht sie über `releases/latest/download`.
- **Vor jedem Push:** `node tools/privacy-scan.mjs` muss null Treffer melden.
- `docs/` ist gitignored (persönliches Arbeitsjournal, nicht Teil der Veröffentlichung).
