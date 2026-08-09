// Komprimiert die generierten Android-Ressourcen-PNGs (Icons/Splash) nach.
// capacitor-assets schreibt unoptimierte PNGs; Palette-Quantisierung verkleinert
// sie deutlich, ohne sichtbaren Qualitaetsverlust. Aufruf via npm run icons.
import sharp from 'sharp';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RES = 'android/app/src/main/res';

function walkPngs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkPngs(p));
    else if (name.endsWith('.png')) out.push(p);
  }
  return out;
}

let before = 0;
let after = 0;
for (const file of walkPngs(RES)) {
  const orig = statSync(file).size;
  const buf = await sharp(file)
    .png({ palette: true, quality: 90, compressionLevel: 9, effort: 10 })
    .toBuffer();
  // Nur ersetzen, wenn die Optimierung tatsaechlich kleiner ist.
  if (buf.length < orig) writeFileSync(file, buf);
  before += orig;
  after += Math.min(buf.length, orig);
}
console.log(
  `res PNGs: ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB`,
);
