import { addDays, getDay } from 'date-fns';

/**
 * Gesetzliche Feiertage je Bundesland, offline berechnet (AUF-028).
 *
 * Quellen, am 17.11.2026 an den amtlichen Fassungen geprueft: die Feiertagsgesetze der 16
 * Laender; der 3. Oktober nach Art. 2 Abs. 2 Einigungsvertrag. Ostern nach der Rechenvorschrift
 * der PTB ("Wann ist Ostern?", Gauss in der Form von H. Lichtenberg); Christi Himmelfahrt,
 * Pfingstsonntag und Fronleichnam als Ostersonntag + 39, + 49, + 60 (ebenda). Buss- und Bettag:
 * Mittwoch vor dem letzten Sonntag des Kirchenjahres (§ 2 FTG BW), das ist der Sonntag vor dem
 * 1. Advent (§ 2 Abs. 2 FTG M-V); der 1. Advent ist der vierte Sonntag vor dem 25. Dezember.
 *
 * Jedes Jahr gilt die heutige Liste; aeltere Rechtsstaende bildet die App nicht ab. Sonntage
 * zaehlen nicht als Feiertage, auch wo ein Gesetz sie nennt (Hessen).
 */

export type Bundesland =
  | 'BW'
  | 'BY'
  | 'BE'
  | 'BB'
  | 'HB'
  | 'HH'
  | 'HE'
  | 'MV'
  | 'NI'
  | 'NW'
  | 'RP'
  | 'SL'
  | 'SN'
  | 'ST'
  | 'SH'
  | 'TH';

/** Die Laender in der Reihenfolge der Auswahl. */
export const BUNDESLAENDER: readonly { code: Bundesland; name: string }[] = [
  { code: 'BW', name: 'Baden-Wuerttemberg' },
  { code: 'BY', name: 'Bayern' },
  { code: 'BE', name: 'Berlin' },
  { code: 'BB', name: 'Brandenburg' },
  { code: 'HB', name: 'Bremen' },
  { code: 'HH', name: 'Hamburg' },
  { code: 'HE', name: 'Hessen' },
  { code: 'MV', name: 'Mecklenburg-Vorpommern' },
  { code: 'NI', name: 'Niedersachsen' },
  { code: 'NW', name: 'Nordrhein-Westfalen' },
  { code: 'RP', name: 'Rheinland-Pfalz' },
  { code: 'SL', name: 'Saarland' },
  { code: 'SN', name: 'Sachsen' },
  { code: 'ST', name: 'Sachsen-Anhalt' },
  { code: 'SH', name: 'Schleswig-Holstein' },
  { code: 'TH', name: 'Thueringen' },
];

/** Feiertage, die nur in Teilen eines Landes gelten; der Nutzer schaltet sie zu. */
export type RegionalerFeiertag = 'mariaehimmelfahrt' | 'friedensfest' | 'fronleichnam';

export const REGIONALE_FEIERTAGE: Readonly<
  Record<Bundesland, readonly { key: RegionalerFeiertag; name: string }[]>
> = {
  BW: [],
  BY: [
    {
      key: 'mariaehimmelfahrt',
      name: 'Mariae Himmelfahrt (Gemeinden mit ueberwiegend katholischer Bevoelkerung)',
    },
    { key: 'friedensfest', name: 'Friedensfest am 8. August (nur Stadt Augsburg)' },
  ],
  BE: [],
  BB: [],
  HB: [],
  HH: [],
  HE: [],
  MV: [],
  NI: [],
  NW: [],
  RP: [],
  SL: [],
  SN: [{ key: 'fronleichnam', name: 'Fronleichnam (Gemeinden laut Rechtsverordnung)' }],
  ST: [],
  SH: [],
  TH: [{ key: 'fronleichnam', name: 'Fronleichnam (Gemeinden laut Rechtsverordnung)' }],
};

/** Ein Feiertag: lokale Mitternacht und Name. */
export interface Feiertag {
  date: number;
  name: string;
}

type Tag =
  | 'neujahr'
  | 'dreikoenige'
  | 'frauentag'
  | 'karfreitag'
  | 'ostersonntag'
  | 'ostermontag'
  | 'maifeiertag'
  | 'himmelfahrt'
  | 'pfingstsonntag'
  | 'pfingstmontag'
  | 'fronleichnam'
  | 'friedensfest'
  | 'mariaehimmelfahrt'
  | 'weltkindertag'
  | 'einheit'
  | 'reformationstag'
  | 'allerheiligen'
  | 'bussundbettag'
  | 'weihnachten1'
  | 'weihnachten2';

/** Namen in fester Reihenfolge; fallen zwei Tage zusammen, stehen sie so hintereinander. */
const NAMEN: readonly [Tag, string][] = [
  ['neujahr', 'Neujahr'],
  ['dreikoenige', 'Heilige Drei Koenige'],
  ['frauentag', 'Frauentag'],
  ['karfreitag', 'Karfreitag'],
  ['ostersonntag', 'Ostersonntag'],
  ['ostermontag', 'Ostermontag'],
  ['maifeiertag', 'Tag der Arbeit'],
  ['himmelfahrt', 'Christi Himmelfahrt'],
  ['pfingstsonntag', 'Pfingstsonntag'],
  ['pfingstmontag', 'Pfingstmontag'],
  ['fronleichnam', 'Fronleichnam'],
  ['friedensfest', 'Friedensfest'],
  ['mariaehimmelfahrt', 'Mariae Himmelfahrt'],
  ['weltkindertag', 'Weltkindertag'],
  ['einheit', 'Tag der Deutschen Einheit'],
  ['reformationstag', 'Reformationstag'],
  ['allerheiligen', 'Allerheiligen'],
  ['bussundbettag', 'Buss- und Bettag'],
  ['weihnachten1', '1. Weihnachtstag'],
  ['weihnachten2', '2. Weihnachtstag'],
];

/** In allen Laendern: die Landesgesetze, fuer den 3. Oktober Art. 2 Abs. 2 Einigungsvertrag. */
const UEBERALL: readonly Tag[] = [
  'neujahr',
  'karfreitag',
  'ostermontag',
  'maifeiertag',
  'himmelfahrt',
  'pfingstmontag',
  'einheit',
  'weihnachten1',
  'weihnachten2',
];

/** Dazu je Land, nach seinem Feiertagsgesetz. */
const LAND: Readonly<Record<Bundesland, readonly Tag[]>> = {
  BW: ['dreikoenige', 'fronleichnam', 'allerheiligen'],
  BY: ['dreikoenige', 'fronleichnam', 'allerheiligen'],
  BE: ['frauentag'],
  BB: ['ostersonntag', 'pfingstsonntag', 'reformationstag'],
  HB: ['reformationstag'],
  HH: ['reformationstag'],
  HE: ['fronleichnam'],
  MV: ['frauentag', 'reformationstag'],
  NI: ['reformationstag'],
  NW: ['fronleichnam', 'allerheiligen'],
  RP: ['fronleichnam', 'allerheiligen'],
  SL: ['fronleichnam', 'mariaehimmelfahrt', 'allerheiligen'],
  SN: ['reformationstag', 'bussundbettag'],
  ST: ['dreikoenige', 'reformationstag'],
  SH: ['reformationstag'],
  TH: ['weltkindertag', 'reformationstag'],
};

/** Einmalige Feiertage (Monat 1 bis 12). */
const EINMALIG: readonly {
  land: Bundesland;
  jahr: number;
  monat: number;
  tag: number;
  name: string;
}[] = [
  {
    land: 'BE',
    jahr: 2028,
    monat: 6,
    tag: 17,
    name: '75. Jahrestag des Aufstandes vom 17. Juni 1953',
  },
];

function datum(tag: Tag, jahr: number, ostern: number): number {
  switch (tag) {
    case 'neujahr':
      return new Date(jahr, 0, 1).getTime();
    case 'dreikoenige':
      return new Date(jahr, 0, 6).getTime();
    case 'frauentag':
      return new Date(jahr, 2, 8).getTime();
    case 'karfreitag':
      return addDays(ostern, -2).getTime();
    case 'ostersonntag':
      return ostern;
    case 'ostermontag':
      return addDays(ostern, 1).getTime();
    case 'maifeiertag':
      return new Date(jahr, 4, 1).getTime();
    case 'himmelfahrt':
      return addDays(ostern, 39).getTime();
    case 'pfingstsonntag':
      return addDays(ostern, 49).getTime();
    case 'pfingstmontag':
      return addDays(ostern, 50).getTime();
    case 'fronleichnam':
      return addDays(ostern, 60).getTime();
    case 'friedensfest':
      return new Date(jahr, 7, 8).getTime();
    case 'mariaehimmelfahrt':
      return new Date(jahr, 7, 15).getTime();
    case 'weltkindertag':
      return new Date(jahr, 8, 20).getTime();
    case 'einheit':
      return new Date(jahr, 9, 3).getTime();
    case 'reformationstag':
      return new Date(jahr, 9, 31).getTime();
    case 'allerheiligen':
      return new Date(jahr, 10, 1).getTime();
    case 'bussundbettag':
      return bussUndBettag(jahr);
    case 'weihnachten1':
      return new Date(jahr, 11, 25).getTime();
    case 'weihnachten2':
      return new Date(jahr, 11, 26).getTime();
  }
}

/** Ostersonntag (lokale Mitternacht) nach der Rechenvorschrift der PTB. */
export function easterSunday(year: number): number {
  const k = Math.floor(year / 100);
  const m = 15 + Math.floor((3 * k + 3) / 4) - Math.floor((8 * k + 13) / 25);
  const s = 2 - Math.floor((3 * k + 3) / 4);
  const a = year % 19;
  const d = (19 * a + m) % 30;
  const r = Math.floor(d / 29) + (Math.floor(d / 28) - Math.floor(d / 29)) * Math.floor(a / 11);
  const og = 21 + d - r;
  const sz = 7 - ((year + Math.floor(year / 4) + s) % 7);
  const oe = 7 - ((og - sz) % 7);
  // Maerzdatum: der 32. Maerz ist der 1. April.
  return new Date(year, 2, og + oe).getTime();
}

/** Buss- und Bettag (lokale Mitternacht): Mittwoch vor dem Sonntag vor dem 1. Advent. */
export function bussUndBettag(year: number): number {
  const weihnachten = new Date(year, 11, 25);
  // Vierter Advent: der Sonntag vor dem 25. Dezember (faellt dieser auf einen Sonntag, 7 Tage).
  const vierterAdvent = addDays(weihnachten, -(getDay(weihnachten) || 7));
  // 1. Advent = 4. Advent - 21, Totensonntag 7 Tage davor, der Mittwoch davor 4 Tage frueher.
  return addDays(vierterAdvent, -21 - 7 - 4).getTime();
}

/**
 * Gesetzliche Feiertage eines Jahres im Land, aufsteigend. Regionale Tage nur, wenn das Land
 * sie kennt. Fallen zwei Feiertage auf denselben Tag, ein Eintrag mit beiden Namen.
 */
export function holidaysOf(
  year: number,
  land: Bundesland,
  regional: readonly RegionalerFeiertag[] = [],
): Feiertag[] {
  const ostern = easterSunday(year);
  const angebot = REGIONALE_FEIERTAGE[land].map((r) => r.key);
  const gilt = new Set<Tag>([
    ...UEBERALL,
    ...LAND[land],
    ...regional.filter((r) => angebot.includes(r)),
  ]);
  const jeDatum = new Map<number, string[]>();
  for (const [t, name] of NAMEN) {
    if (!gilt.has(t)) continue;
    const d = datum(t, year, ostern);
    jeDatum.set(d, [...(jeDatum.get(d) ?? []), name]);
  }
  for (const e of EINMALIG) {
    if (e.land !== land || e.jahr !== year) continue;
    const d = new Date(e.jahr, e.monat - 1, e.tag).getTime();
    jeDatum.set(d, [...(jeDatum.get(d) ?? []), e.name]);
  }
  return [...jeDatum.entries()]
    .sort(([a], [b]) => a - b)
    .map(([date, alle]) => ({ date, name: alle.join(' / ') }));
}
