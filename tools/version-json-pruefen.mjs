// Prueft version.json fuer den Update-Kanal und faehrt vier Negativkontrollen.
// Aufruf: node version-json-pruefen.mjs <version.json> <build.gradle> <apk-dateiname> <vorheriger versionCode>
import { readFileSync } from 'node:fs';

const [file, gradle, apkName, prevCodeArg] = process.argv.slice(2);
const prevCode = Number(prevCodeArg);
const gradleText = readFileSync(gradle, 'utf8');
const gradleCode = Number(/versionCode\s+(\d+)/.exec(gradleText)[1]);
const gradleName = /versionName\s+"([^"]+)"/.exec(gradleText)[1];

// Nachbau von isRemoteVersion (src/update/updater.ts:43-53), dazu die Release-Regeln.
function fehler(bytes) {
  const f = [];
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) f.push('BOM');
  let v;
  try {
    v = JSON.parse(bytes.toString('utf8').replace(/^﻿/, ''));
  } catch (e) {
    return [...f, 'kein JSON'];
  }
  const ok =
    typeof v === 'object' && v !== null &&
    typeof v.versionCode === 'number' && Number.isFinite(v.versionCode) &&
    typeof v.versionName === 'string' &&
    typeof v.url === 'string' && v.url.startsWith('https://');
  if (!ok) f.push('isRemoteVersion');
  if (v.versionCode !== gradleCode) f.push(`versionCode ${v.versionCode} != build.gradle ${gradleCode}`);
  if (!(v.versionCode > prevCode)) f.push(`versionCode ${v.versionCode} nicht > ${prevCode}`);
  if (v.versionName !== gradleName) f.push(`versionName ${v.versionName} != build.gradle ${gradleName}`);
  const soll = `https://github.com/BosslandX/klarzeit-releases/releases/download/v${gradleName}/${apkName}`;
  if (v.url !== soll) f.push('url ist nicht die Tag-URL mit Asset-Namen');
  if (typeof v.notes === 'string' && !/^[\x20-\x7e]*$/.test(v.notes)) f.push('notes nicht ASCII');
  return f;
}

const echt = readFileSync(file);
const befundEcht = fehler(echt);
console.log(`ECHT ${befundEcht.length === 0 ? 'OK' : 'FEHLER: ' + befundEcht.join('; ')}  (${echt.length} Byte)`);

const text = echt.toString('utf8');
const nk = {
  'versionCode alt': text.replace(`"versionCode": ${gradleCode}`, `"versionCode": ${prevCode}`),
  Umlaut: text.replace('"notes": "', '"notes": "ü'),
  'latest-URL': text.replace(`releases/download/v${gradleName}/`, 'releases/latest/download/'),
  BOM: '﻿' + text,
};
let alleRot = true;
for (const [name, t] of Object.entries(nk)) {
  if (t === text) {
    console.log(`NK ${name}: MUTATION GRIFF NICHT`);
    alleRot = false;
    continue;
  }
  const b = fehler(Buffer.from(t, 'utf8'));
  console.log(`NK ${name}: ${b.length > 0 ? 'rot (' + b.join('; ') + ')' : 'GRUEN - Pruefung misst nichts'}`);
  if (b.length === 0) alleRot = false;
}
process.exit(befundEcht.length === 0 && alleRot ? 0 : 1);
