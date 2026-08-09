// Erzeugt die Icon-/Splash-Quellbilder fuer @capacitor/assets aus dem Marken-Logo.
// Quelle: assets/source-logo.png (Klarzeit-Logo). Rendering via sharp.
// Aufruf: node tools/gen-icons.mjs  (bzw. npm run icons inkl. capacitor-assets)
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const SRC = 'assets/source-logo.png';
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const TRANSPARENT = { r: 255, g: 255, b: 255, alpha: 0 };

/** Reines Logo-Motiv (Uhr + Schriftzug) auf weissem Grund, ohne abgerundete Eckraender. */
async function motif() {
  // Hoher Threshold entfernt weissen/cremefarbenen Rand inkl. der abgerundeten Ecken,
  // sodass nur das eigentliche Motiv uebrig bleibt (sauber zentrierbar).
  return sharp(SRC).trim({ threshold: 60 }).toBuffer();
}

/** Motiv zentriert auf quadratischem Canvas der Kantenlaenge `size`, skaliert auf `frac`. */
async function place(size, frac, background) {
  const logo = await motif();
  const target = Math.round(size * frac);
  const resized = await sharp(logo)
    .resize(target, target, { fit: 'contain', background: TRANSPARENT })
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: resized, gravity: 'centre' }])
    .png()
    .toBuffer();
}

/** Einfarbiger quadratischer Hintergrund. */
async function solid(size, background) {
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .png()
    .toBuffer();
}

// Adaptive-Icon-Foreground hat ~72% Safe-Zone, damit der Schriftzug nicht beschnitten wird.
// Hintergrund (Adaptive + Splash) ist weiss, passend zum weissen Logo-Grund.
const sources = [
  ['assets/icon-background.png', () => solid(1024, WHITE)],
  ['assets/icon-foreground.png', () => place(1024, 0.52, TRANSPARENT)],
  ['assets/icon-only.png', () => place(1024, 0.62, WHITE)],
  ['assets/splash.png', () => place(2732, 0.24, WHITE)],
  ['assets/splash-dark.png', () => place(2732, 0.24, WHITE)],
];

mkdirSync('assets', { recursive: true });
for (const [out, make] of sources) {
  // Palette-Quantisierung + max. Kompression: deutlich kleinere PNGs bei gleicher Optik.
  await sharp(await make())
    .png({ palette: true, quality: 90, compressionLevel: 9, effort: 10 })
    .toFile(out);
  console.log('wrote', out);
}
