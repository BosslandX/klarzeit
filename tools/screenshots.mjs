// Erzeugt die README-Screenshots aus der laufenden Dev-Version — mit
// ausgedachten Demo-Daten, damit keine echten Arbeitszeiten abgebildet werden.
//
//   1. Terminal A:  npm run dev -- --port 5199 --strictPort
//   2. Terminal B:  node tools/screenshots.mjs
//
// Ergebnis: assets/screenshots/*.png (je Ansicht in Light und Dark), dazu
// hero-light.png / hero-dark.png: drei Ansichten im Geraeterahmen fuer den
// Kopf der README, mit transparentem Grund.
// Nutzt das lokal installierte Chrome via puppeteer-core (kein Browser-Download).

import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync } from 'node:fs';

const URL = process.env.KLARZEIT_URL ?? 'http://localhost:5199/';
const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'assets/screenshots';

// Handy-Format (Pixel-Klasse) mit doppelter Pixeldichte fuer scharfe Bilder.
const VIEWPORT = { width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

// Ansichten im Titelbild, von links nach rechts (die mittlere wird groesser).
const HERO = ['entries', 'running', 'monat'];

const MIN = 60_000;
const HOUR = 60 * MIN;

// Alle Demo-Daten liegen RELATIV zum Ausfuehrungstag, damit die Bilder auch in
// einem Jahr noch plausibel sind (laufender Monat teilweise, Vormonat komplett).
const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);
const Y = TODAY.getFullYear();
const M = TODAY.getMonth();

// Seit 1.5 haengt alles an einer Beschaeftigung; 'emp-1' ist die erste.
const EMPLOYMENT_ID = 'emp-1';
const WORKDAYS = [1, 2, 4, 5]; // Mo, Di, Do, Fr

const DEMO_PROFILE = {
  vorname: 'Max',
  nachname: 'Mustermann',
  personalnummer: '',
  arbeitgeber: '',
  abteilung: '',
};

// Arbeitgeber, Personalnummer und Abteilung stehen seit 1.5 an der Beschaeftigung.
const DEMO_EMPLOYMENT = {
  id: EMPLOYMENT_ID,
  name: 'Teilzeit',
  arbeitgeber: 'Muster GmbH',
  personalnummer: '12345',
  abteilung: 'Verwaltung',
  startDate: new Date(Y, M - 5, 1).getTime(), // fuenf Monate vor dem laufenden Monat
  endDate: null,
  weeklyHours: 20,
  workdaysPerWeek: 4,
  vacationYearMode: 'both',
  openingBalanceMs: 0,
  contractVacationDays: null,
  includedOvertimeHoursPerMonth: null,
  balanceNote: '',
  clockodo: null,
};

/** Vier Arbeitstage am Stueck ab dem 12. des Vormonats (Wochenende und Mittwoch frei). */
function demoVacationDates() {
  const out = [];
  const cursor = new Date(Y, M - 1, 12);
  while (out.length < 4) {
    if (WORKDAYS.includes(cursor.getDay())) out.push(cursor.getTime());
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

const VACATION_DATES = demoVacationDates();

const DEMO_VACATIONS = VACATION_DATES.map((date) => ({
  employmentId: EMPLOYMENT_ID,
  date,
  note: '',
}));

/**
 * Ausgedachte Eintraege: Mo/Di/Do/Fr ausser an Urlaubstagen, 5,5 h mit einer
 * Pause von 30 min nach 2,5 h (also 5 h netto), bis einschliesslich heute.
 */
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
    if (WORKDAYS.includes(wd) && !VACATION_DATES.includes(cursor.getTime())) {
      const startH = wd === 1 ? 8 : 9;
      const start = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), startH, 0).getTime();
      const pause = start + 2.5 * HOUR;
      out.push({
        employmentId: EMPLOYMENT_ID,
        start,
        end: start + 5.5 * HOUR,
        breaks: [{ start: pause, end: pause + 30 * MIN }],
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
    employmentId: EMPLOYMENT_ID,
    start: heuteStart,
    end: heuteStart + 3.25 * HOUR,
    breaks: [],
    breakMinutes: 0,
    activity: 'Posteingang',
    note: '',
    source: 'tracked',
    createdAt: heuteStart,
    updatedAt: heuteStart,
  });
  return out;
}

/** Laufende Erfassung, die seit 1 h 47 min laeuft (fuer den Stoppuhr-Screenshot). */
const RUNNING = { offsetMs: (1 * 60 + 47) * MIN, activity: 'Sachbearbeitung' };

async function seed(page, { withRunning }) {
  await page.evaluate(
    async (profile, employment, vacations, entries, running) => {
      // @capacitor/preferences legt Werte im Web unter diesem Praefix ab.
      const P = 'CapacitorStorage.';
      localStorage.setItem(P + 'profile', JSON.stringify(profile));
      localStorage.setItem(P + 'employments', JSON.stringify([employment]));
      localStorage.setItem(P + 'activeEmployment', employment.id);
      localStorage.removeItem(P + 'employment'); // Einzelschluessel von vor 1.5
      localStorage.setItem(P + 'vacations', JSON.stringify(vacations));
      if (running) {
        localStorage.setItem(
          P + 'running',
          JSON.stringify({
            employmentId: employment.id,
            start: Date.now() - running.offsetMs,
            activity: running.activity,
          }),
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

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Klickt einen Tab der unteren Navigationsleiste anhand seiner Beschriftung. */
async function goTab(page, label) {
  await page.evaluate((l) => {
    const btn = [...document.querySelectorAll('.bottom-nav .nav-item')].find((b) =>
      b.textContent.trim().startsWith(l),
    );
    if (!btn) throw new Error(`Tab "${l}" nicht gefunden`);
    btn.click();
  }, label);
  await pause(400);
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
  await pause(400);
}

/** Blaettert die Periode (-1 = zurueck, +1 = weiter). */
async function shiftPeriod(page, dir) {
  await page.evaluate((d) => {
    const title = d < 0 ? 'Zurueck' : 'Weiter';
    const btn = document.querySelector(`.period-nav .icon-btn[title="${title}"]`);
    if (!btn) throw new Error(`Perioden-Button "${title}" nicht gefunden`);
    btn.click();
  }, dir);
  await pause(500);
}

/** Oeffnet das Formular des ersten Eintrags mit Pause (zeigt die Pausen mit Uhrzeit). */
async function openEntryWithBreak(page) {
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('.entry-card')].find((c) =>
      c.querySelector('.entry-break'),
    );
    const btn = card?.querySelector('[title="Bearbeiten"]');
    if (!btn) throw new Error('Eintrag mit Pause samt "Bearbeiten" nicht gefunden');
    btn.click();
  });
  await pause(500);
}

/** Schliesst ein offenes Formular ueber den Hintergrund (wie ein Tipp daneben). */
async function closeModal(page) {
  await page.evaluate(() => {
    const overlay = document.querySelector('.modal-overlay');
    if (!overlay) throw new Error('Kein offenes Formular');
    overlay.click();
  });
  await pause(300);
}

async function shot(page, name, theme) {
  await page.screenshot({ path: `${OUT}/${name}-${theme}.png` });
  console.log(`  ${name}-${theme}.png`);
}

/** Drei Ansichten im Geraeterahmen nebeneinander, transparenter Grund. */
async function composeHero(browser, theme) {
  const src = (name) =>
    `data:image/png;base64,${readFileSync(`${OUT}/${name}-${theme}.png`).toString('base64')}`;
  // Rahmen hell: dunkles Geraet. Rahmen dunkel: etwas heller als der
  // GitHub-Hintergrund, mit feiner Kante, damit er sich abhebt.
  const bezel = theme === 'dark' ? '#1f2733' : '#111827';
  const edge = theme === 'dark' ? 'rgba(255,255,255,0.16)' : 'rgba(17,24,39,0.10)';
  const shadow = theme === 'dark' ? 'rgba(0,0,0,0.55)' : 'rgba(17,24,39,0.30)';
  const [left, mid, right] = HERO;

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 2 });
  await page.setContent(`<!doctype html><html><head><style>
    html, body { margin: 0; background: transparent; }
    .stage { display: inline-flex; align-items: center; gap: 36px; padding: 40px 56px 64px; }
    .phone { background: ${bezel}; border-radius: 46px; padding: 11px;
             box-shadow: 0 0 0 1px ${edge}, 0 30px 60px -20px ${shadow}; }
    .phone img { display: block; width: 290px; border-radius: 35px; }
    .phone.mid img { width: 336px; }
  </style></head><body><div class="stage">
    <div class="phone"><img src="${src(left)}"></div>
    <div class="phone mid"><img src="${src(mid)}"></div>
    <div class="phone"><img src="${src(right)}"></div>
  </div></body></html>`);
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  const stage = await page.$('.stage');
  await stage.screenshot({ path: `${OUT}/hero-${theme}.png`, omitBackground: true });
  await page.close();
  console.log(`  hero-${theme}.png`);
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
      await pause(1200);
      await seed(page, { withRunning: false });
      await page.reload({ waitUntil: 'networkidle0' });
      await pause(900);

      await shot(page, 'home', theme);

      await goTab(page, 'Eintraege');
      await shot(page, 'entries', theme);

      await openEntryWithBreak(page);
      await shot(page, 'form', theme);
      await closeModal(page);

      // Wochenansicht der VORwoche: die laufende Woche ist am Montag fast leer.
      await goTab(page, 'Reports');
      await shiftPeriod(page, -1);
      await shot(page, 'reports', theme);

      // Monatsansicht des VORmonats: dort ist der Monat vollstaendig, das
      // Arbeitszeitkonto zeigt einen echten Saldo statt eines halben Monats.
      // Die Reports merken sich den Stichtag ueber den Wechsel der Zeitraum-Art
      // hinweg; liegt die Vorwoche schon im Vormonat, ist kein Blaettern noetig.
      await goSegment(page, 'Monat');
      if (new Date(Date.now() - 7 * 24 * HOUR).getMonth() === M) await shiftPeriod(page, -1);
      await shot(page, 'monat', theme);

      await goTab(page, 'Mehr');
      await shot(page, 'more', theme);

      // Laufende Erfassung separat: Stoppuhr soll eine plausible Dauer zeigen.
      await seed(page, { withRunning: true });
      await page.reload({ waitUntil: 'networkidle0' });
      await pause(900);
      await shot(page, 'running', theme);

      await page.close();
      await composeHero(browser, theme);
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
