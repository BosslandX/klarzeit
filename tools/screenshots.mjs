// Erzeugt die README-Screenshots aus der laufenden Dev-Version — mit
// ausgedachten Demo-Daten, damit keine echten Arbeitszeiten abgebildet werden.
//
//   1. Terminal A:  npm run dev -- --port 5199 --strictPort
//   2. Terminal B:  node tools/screenshots.mjs
//
// Ergebnis: assets/screenshots/*.png (je Ansicht in Light und Dark).
// Nutzt das lokal installierte Chrome via puppeteer-core (kein Browser-Download).

import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const URL = process.env.KLARZEIT_URL ?? 'http://localhost:5199/';
const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'assets/screenshots';

// Handy-Format (Pixel-Klasse) mit doppelter Pixeldichte fuer scharfe Bilder.
const VIEWPORT = { width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

// Alle Demo-Daten liegen RELATIV zum Ausfuehrungstag, damit die Bilder auch in
// einem Jahr noch plausibel sind (laufender Monat teilweise, Vormonat komplett).
const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);
const Y = TODAY.getFullYear();
const M = TODAY.getMonth();

const DEMO_PROFILE = {
  vorname: 'Max',
  nachname: 'Mustermann',
  personalnummer: '12345',
  arbeitgeber: 'Muster GmbH',
  abteilung: 'Verwaltung',
};

const DEMO_EMPLOYMENT = {
  startDate: new Date(Y, M - 5, 1).getTime(), // fuenf Monate vor dem laufenden Monat
  endDate: null,
  weeklyHours: 20,
  workdaysPerWeek: 4,
  vacationYearMode: 'both',
  openingBalanceMs: 0,
};

/** Ausgedachte Eintraege: Mo/Di/Do/Fr, 5 h netto pro Tag, bis einschliesslich heute. */
function demoEntries() {
  const out = [];
  const activities = [
    'Sachbearbeitung',
    'Aktenpflege',
    'Telefondienst',
    'Posteingang',
    'Besprechung',
    'Archivierung',
  ];
  let i = 0;
  const cursor = new Date(DEMO_EMPLOYMENT.startDate);
  while (cursor.getTime() < TODAY.getTime()) {
    const wd = cursor.getDay();
    if ([1, 2, 4, 5].includes(wd)) {
      const startH = wd === 1 ? 8 : 9;
      const start = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), startH, 0).getTime();
      const end = start + 5.5 * 3600_000;
      out.push({
        start,
        end,
        breakMinutes: 30,
        activity: activities[i % activities.length],
        note: '',
        source: i % 5 === 0 ? 'manual' : 'tracked',
        createdAt: start,
        updatedAt: start,
      });
      i++;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  // Heute: ein abgeschlossener Vormittag, damit "Heute bereits erfasst" gefuellt ist.
  const heuteStart = new Date(Y, M, TODAY.getDate(), 8, 0).getTime();
  out.push({
    start: heuteStart,
    end: heuteStart + 3.25 * 3600_000,
    breakMinutes: 0,
    activity: 'Posteingang',
    note: '',
    source: 'tracked',
    createdAt: heuteStart,
    updatedAt: heuteStart,
  });
  return out;
}

/** Genommene Urlaubstage (vier zusammenhaengende Tage im Vormonat). */
const DEMO_VACATIONS = [15, 16, 17, 18].map((d) => ({
  date: new Date(Y, M - 1, d).getTime(),
  note: 'Sommerurlaub',
}));

/** Laufende Erfassung, die seit 1 h 47 min laeuft (fuer den Stoppuhr-Screenshot). */
const RUNNING = { offsetMs: (1 * 60 + 47) * 60 * 1000, activity: 'Sachbearbeitung' };

async function seed(page, { withRunning }) {
  await page.evaluate(
    async (profile, employment, vacations, entries, running) => {
      // @capacitor/preferences legt Werte im Web unter diesem Praefix ab.
      const P = 'CapacitorStorage.';
      localStorage.setItem(P + 'profile', JSON.stringify(profile));
      localStorage.setItem(P + 'employment', JSON.stringify(employment));
      localStorage.setItem(P + 'vacations', JSON.stringify(vacations));
      if (running) {
        localStorage.setItem(
          P + 'running',
          JSON.stringify({ start: Date.now() - running.offsetMs, activity: running.activity }),
        );
      } else {
        localStorage.removeItem(P + 'running');
      }

      // Eintraege direkt in den von Dexie angelegten Store schreiben.
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('zeiterfassung');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction('entries', 'readwrite');
        const store = tx.objectStore('entries');
        store.clear();
        for (const e of entries) store.add(e);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    DEMO_PROFILE,
    DEMO_EMPLOYMENT,
    DEMO_VACATIONS,
    demoEntries(),
    withRunning ? RUNNING : null,
  );
}

/** Klickt einen Tab der unteren Navigationsleiste anhand seiner Beschriftung. */
async function goTab(page, label) {
  await page.evaluate((l) => {
    const btn = [...document.querySelectorAll('.bottom-nav .nav-item')].find((b) =>
      b.textContent.trim().startsWith(l),
    );
    if (!btn) throw new Error(`Tab "${l}" nicht gefunden`);
    btn.click();
  }, label);
  await new Promise((r) => setTimeout(r, 400));
}

/** Waehlt eine Zeitraum-Art in den Reports ("Tag" | "Woche" | "Monat" | "Zeitraum"). */
async function goSegment(page, label) {
  await page.evaluate((l) => {
    const btn = [...document.querySelectorAll('.segmented .seg')].find(
      (b) => b.textContent.trim() === l,
    );
    if (!btn) throw new Error(`Segment "${l}" nicht gefunden`);
    btn.click();
  }, label);
  await new Promise((r) => setTimeout(r, 400));
}

/** Blaettert die Periode (-1 = zurueck, +1 = weiter). */
async function shiftPeriod(page, dir) {
  await page.evaluate((d) => {
    const title = d < 0 ? 'Zurueck' : 'Weiter';
    const btn = document.querySelector(`.period-nav .icon-btn[title="${title}"]`);
    if (!btn) throw new Error(`Perioden-Button "${title}" nicht gefunden`);
    btn.click();
  }, dir);
  await new Promise((r) => setTimeout(r, 500));
}

/** Scrollt ein Element mittig ins Bild; wirft, wenn es die Seite nicht gibt. */
async function scrollToSelector(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Element "${sel}" nicht gefunden`);
    el.scrollIntoView({ block: 'center' });
  }, selector);
  await new Promise((r) => setTimeout(r, 300));
}

async function shot(page, name, theme) {
  await page.screenshot({ path: `${OUT}/${name}-${theme}.png` });
  console.log(`  ${name}-${theme}.png`);
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    defaultViewport: VIEWPORT,
    args: ['--force-device-scale-factor=2', '--hide-scrollbars'],
  });

  try {
    for (const theme of ['light', 'dark']) {
      console.log(`\n${theme}:`);
      const page = await browser.newPage();
      await page.setViewport(VIEWPORT);
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);

      // Erster Aufruf legt die Dexie-Datenbank an, danach befuellen und neu laden.
      await page.goto(URL, { waitUntil: 'networkidle0' });
      await new Promise((r) => setTimeout(r, 1200));
      await seed(page, { withRunning: false });
      await page.reload({ waitUntil: 'networkidle0' });
      await new Promise((r) => setTimeout(r, 900));

      await shot(page, 'home', theme);

      await goTab(page, 'Eintraege');
      await shot(page, 'entries', theme);

      await goTab(page, 'Reports');
      await shot(page, 'reports', theme); // Wochenansicht

      // Monatsansicht des VORmonats: dort ist der Monat vollstaendig, das
      // Arbeitszeitkonto zeigt einen echten Saldo statt eines halben Monats.
      await goSegment(page, 'Monat');
      await shiftPeriod(page, -1);
      await shot(page, 'monat', theme);
      await scrollToSelector(page, '.konto-grid');
      await shot(page, 'konto', theme);

      await goTab(page, 'Mehr');
      await shot(page, 'more', theme);

      // Laufende Erfassung separat: Stoppuhr soll eine plausible Dauer zeigen.
      await seed(page, { withRunning: true });
      await page.reload({ waitUntil: 'networkidle0' });
      await new Promise((r) => setTimeout(r, 900));
      await shot(page, 'running', theme);

      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`\nFertig -> ${OUT}/`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
