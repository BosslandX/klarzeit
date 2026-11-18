import { describe, expect, it } from 'vitest';
import { getDay } from 'date-fns';
import {
  BUNDESLAENDER,
  REGIONALE_FEIERTAGE,
  bussUndBettag,
  easterSunday,
  cleanPublicHolidays,
  holidaysOf,
  publicHolidayMap,
  addExtraHoliday,
  holidayHistoryNote,
  holidayNameOn,
  holidayPreview,
  removeExtraHoliday,
  toggleRegionalHoliday,
  toggleSkippedHoliday,
  withHolidayLand,
  type Bundesland,
  type Feiertag,
} from './holidays';

const tag = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();
const namen = (y: number, land: Bundesland) => holidaysOf(y, land).map((h) => h.name);
const am = (liste: Feiertag[], name: string) => liste.find((h) => h.name === name)?.date;

/** PTB, "Wann ist Ostern?", Tabelle der Ostertermine 1980 bis 2031, woertlich. */
const PTB_TABELLE =
  '1980 06.04. 1981 19.04. 1982 11.04. 1983 03.04. 1984 22.04. 1985 07.04. 1986 30.03. ' +
  '1987 19.04. 1988 03.04. 1989 26.03. 1990 15.04. 1991 31.03. 1992 19.04. 1993 11.04. ' +
  '1994 03.04. 1995 16.04. 1996 07.04. 1997 30.03. 1998 12.04. 1999 04.04. 2000 23.04. ' +
  '2001 15.04. 2002 31.03. 2003 20.04. 2004 11.04. 2005 27.03. 2006 16.04. 2007 08.04. ' +
  '2008 23.03. 2009 12.04. 2010 04.04. 2011 24.04. 2012 08.04. 2013 31.03. 2014 20.04. ' +
  '2015 05.04. 2016 27.03. 2017 16.04. 2018 01.04. 2019 21.04. 2020 12.04. 2021 04.04. ' +
  '2022 17.04. 2023 09.04. 2024 31.03. 2025 20.04. 2026 05.04. 2027 28.03. 2028 16.04. ' +
  '2029 01.04. 2030 21.04. 2031 13.04.';

describe('Feiertage: Ostern und bewegliche Tage (AUF-028)', () => {
  it('easterSunday: alle Jahre der PTB-Tabelle 1980 bis 2031', () => {
    const paare = [...PTB_TABELLE.matchAll(/(\d{4}) (\d{2})\.(\d{2})\./g)];
    expect(paare).toHaveLength(52);
    for (const [, j, d, m] of paare) {
      expect([j, easterSunday(Number(j))]).toEqual([j, tag(Number(j), Number(m), Number(d))]);
    }
  });

  it('bewegliche Feiertage 2026: Karfreitag bis Fronleichnam', () => {
    const by = holidaysOf(2026, 'BY');
    const bb = holidaysOf(2026, 'BB');
    expect(am(by, 'Karfreitag')).toBe(tag(2026, 4, 3));
    expect(am(by, 'Ostermontag')).toBe(tag(2026, 4, 6));
    expect(am(by, 'Christi Himmelfahrt')).toBe(tag(2026, 5, 14));
    expect(am(by, 'Pfingstmontag')).toBe(tag(2026, 5, 25));
    expect(am(by, 'Fronleichnam')).toBe(tag(2026, 6, 4));
    expect(am(bb, 'Ostersonntag')).toBe(tag(2026, 4, 5));
    expect(am(bb, 'Pfingstsonntag')).toBe(tag(2026, 5, 24));
  });

  it('bussUndBettag: 18.11.2026, jedes Jahr ein Mittwoch vom 16. bis 22. November', () => {
    expect(bussUndBettag(2026)).toBe(tag(2026, 11, 18));
    for (let j = 1980; j <= 2031; j++) {
      const d = new Date(bussUndBettag(j));
      expect([j, getDay(d), d.getMonth()]).toEqual([j, 3, 10]);
      expect(d.getDate()).toBeGreaterThanOrEqual(16);
      expect(d.getDate()).toBeLessThanOrEqual(22);
    }
  });
});

describe('Feiertage je Land (AUF-028)', () => {
  it('Zahl der Feiertage 2026 je Land', () => {
    const soll: Record<Bundesland, number> = {
      BW: 12,
      BY: 12,
      BE: 10,
      BB: 12,
      HB: 10,
      HH: 10,
      HE: 10,
      MV: 11,
      NI: 10,
      NW: 11,
      RP: 11,
      SL: 12,
      SN: 11,
      ST: 11,
      SH: 10,
      TH: 11,
    };
    expect(BUNDESLAENDER.map((l) => l.code).sort()).toEqual(Object.keys(soll).sort());
    for (const l of BUNDESLAENDER) {
      expect([l.code, holidaysOf(2026, l.code).length]).toEqual([l.code, soll[l.code]]);
    }
  });

  it('ueberall: Neujahr, Karfreitag, Ostermontag, 1. Mai, Himmelfahrt, Pfingstmontag, 3. Oktober, Weihnachten', () => {
    for (const l of BUNDESLAENDER) {
      expect(namen(2026, l.code)).toEqual(
        expect.arrayContaining([
          'Neujahr',
          'Karfreitag',
          'Ostermontag',
          'Tag der Arbeit',
          'Christi Himmelfahrt',
          'Pfingstmontag',
          'Tag der Deutschen Einheit',
          '1. Weihnachtstag',
          '2. Weihnachtstag',
        ]),
      );
    }
  });

  it('Landesfeiertage stehen genau dort, wo das Landesgesetz sie nennt', () => {
    const wo = (name: string) =>
      BUNDESLAENDER.filter((l) => namen(2026, l.code).includes(name))
        .map((l) => l.code)
        .sort();
    expect(wo('Heilige Drei Koenige')).toEqual(['BW', 'BY', 'ST']);
    expect(wo('Frauentag')).toEqual(['BE', 'MV']);
    expect(wo('Ostersonntag')).toEqual(['BB']);
    expect(wo('Pfingstsonntag')).toEqual(['BB']);
    expect(wo('Fronleichnam')).toEqual(['BW', 'BY', 'HE', 'NW', 'RP', 'SL']);
    expect(wo('Mariae Himmelfahrt')).toEqual(['SL']);
    expect(wo('Weltkindertag')).toEqual(['TH']);
    expect(wo('Reformationstag')).toEqual(['BB', 'HB', 'HH', 'MV', 'NI', 'SH', 'SN', 'ST', 'TH']);
    expect(wo('Allerheiligen')).toEqual(['BW', 'BY', 'NW', 'RP', 'SL']);
    expect(wo('Buss- und Bettag')).toEqual(['SN']);
  });

  it('Berlin: der 17. Juni 2028 einmalig', () => {
    const be28 = holidaysOf(2028, 'BE');
    expect(be28.map((h) => h.date)).toContain(tag(2028, 6, 17));
    expect(be28).toHaveLength(11);
    expect(holidaysOf(2027, 'BE')).toHaveLength(10);
    expect(holidaysOf(2027, 'BE').map((h) => h.date)).not.toContain(tag(2027, 6, 17));
    expect(holidaysOf(2028, 'BB').map((h) => h.date)).not.toContain(tag(2028, 6, 17));
  });

  it('regionale Feiertage nur zugeschaltet und nur im eigenen Land', () => {
    expect(holidaysOf(2026, 'BY', ['mariaehimmelfahrt']).map((h) => h.date)).toContain(
      tag(2026, 8, 15),
    );
    expect(holidaysOf(2026, 'BY', ['friedensfest']).map((h) => h.date)).toContain(
      tag(2026, 8, 8),
    );
    expect(holidaysOf(2026, 'SN', ['fronleichnam']).map((h) => h.date)).toContain(
      tag(2026, 6, 4),
    );
    expect(holidaysOf(2026, 'TH', ['fronleichnam'])).toHaveLength(12);
    expect(holidaysOf(2026, 'HE', ['mariaehimmelfahrt'])).toHaveLength(10);
    expect(REGIONALE_FEIERTAGE.HE).toEqual([]);
  });

  it('gleicher Tag zaehlt einmal: der 1. Mai 2008 ist auch Christi Himmelfahrt', () => {
    expect(holidaysOf(2008, 'BY').filter((h) => h.date === tag(2008, 5, 1))).toEqual([
      { date: tag(2008, 5, 1), name: 'Tag der Arbeit / Christi Himmelfahrt' },
    ]);
  });

  it('aufsteigend, lokale Mitternacht', () => {
    for (const j of [2027, 2028]) {
      for (const l of BUNDESLAENDER) {
        const liste = holidaysOf(j, l.code);
        for (let i = 1; i < liste.length; i++) {
          expect(liste[i].date).toBeGreaterThan(liste[i - 1].date);
        }
        for (const h of liste) expect(new Date(h.date).getHours()).toBe(0);
      }
    }
  });
});

describe('Feiertage einer Beschaeftigung (AUF-029)', () => {
  it('cleanPublicHolidays: Land Pflicht, regionale nur aus dem Angebot, Tage auf Mitternacht', () => {
    expect(
      cleanPublicHolidays({
        land: 'BY',
        regional: ['friedensfest', 'fronleichnam', 'friedensfest'],
        extra: [tag(2026, 12, 24) + 3_600_000, tag(2026, 12, 24), 'x'],
        skip: [tag(2026, 1, 6)],
      }),
    ).toEqual({
      land: 'BY',
      regional: ['friedensfest'],
      extra: [tag(2026, 12, 24)],
      skip: [tag(2026, 1, 6)],
    });
    expect(cleanPublicHolidays({ land: 'HE' })).toEqual({
      land: 'HE',
      regional: [],
      extra: [],
      skip: [],
    });
    expect(cleanPublicHolidays({ land: 'XX', regional: [] })).toBeUndefined();
    expect(cleanPublicHolidays(null)).toBeUndefined();
    expect(cleanPublicHolidays('BY')).toBeUndefined();
  });

  it('publicHolidayMap: Land, eigene Tage dazu, gestrichene weg, nur in den Jahren', () => {
    const bayern = {
      land: 'BY' as const,
      regional: [],
      extra: [tag(2026, 12, 24), tag(2027, 12, 24)],
      skip: [tag(2026, 1, 6)],
    };
    const m = publicHolidayMap(bayern, 2026, 2026);
    expect(m.get(tag(2026, 12, 24))).toBe('Eigener Feiertag');
    expect(m.has(tag(2026, 1, 6))).toBe(false);
    expect(m.has(tag(2027, 12, 24))).toBe(false);
    expect(m.get(tag(2026, 10, 3))).toBe('Tag der Deutschen Einheit');
    expect(m.size).toBe(12);
    expect(publicHolidayMap(undefined, 2026, 2026).size).toBe(0);
    expect(publicHolidayMap(bayern, 2026, 2027).size).toBe(25);
  });
});

describe('Feiertage im Formular (AUF-030)', () => {
  const by = { land: 'BY' as const, regional: [], extra: [], skip: [] };

  it('withHolidayLand: leer schaltet aus, ein neues Land behaelt eigene und gestrichene Tage', () => {
    expect(withHolidayLand(by, '')).toBeUndefined();
    expect(withHolidayLand(undefined, 'HE')).toEqual({ land: 'HE', regional: [], extra: [], skip: [] });
    const voll = {
      land: 'BY' as const,
      regional: ['mariaehimmelfahrt' as const],
      extra: [tag(2026, 12, 24)],
      skip: [tag(2026, 1, 6)],
    };
    expect(withHolidayLand(voll, 'SN')).toEqual({
      land: 'SN',
      regional: [],
      extra: [tag(2026, 12, 24)],
      skip: [tag(2026, 1, 6)],
    });
    expect(withHolidayLand(voll, 'XX')).toBe(voll);
  });

  it('toggleRegionalHoliday: an und ab, nur was das Land anbietet', () => {
    const mit = toggleRegionalHoliday(by, 'friedensfest');
    expect(mit.regional).toEqual(['friedensfest']);
    expect(toggleRegionalHoliday(mit, 'friedensfest').regional).toEqual([]);
    expect(toggleRegionalHoliday(by, 'fronleichnam').regional).toEqual([]);
  });

  it('streichen und eigene Tage: auf Mitternacht, ohne Doppelte, aufsteigend', () => {
    const gestrichen = toggleSkippedHoliday(by, tag(2026, 1, 6) + 3_600_000);
    expect(gestrichen.skip).toEqual([tag(2026, 1, 6)]);
    expect(toggleSkippedHoliday(gestrichen, tag(2026, 1, 6) + 7_200_000).skip).toEqual([]);
    const eigen = addExtraHoliday(addExtraHoliday(by, tag(2026, 12, 31)), tag(2026, 12, 24) + 60_000);
    expect(eigen.extra).toEqual([tag(2026, 12, 24), tag(2026, 12, 31)]);
    expect(addExtraHoliday(eigen, tag(2026, 12, 24)).extra).toHaveLength(2);
    expect(removeExtraHoliday(eigen, tag(2026, 12, 24) + 60_000).extra).toEqual([tag(2026, 12, 31)]);
  });

  it('holidayPreview: Landesfeiertage samt gestrichenen, dazu eigene, nach Datum', () => {
    const p = holidayPreview(
      { ...by, extra: [tag(2026, 12, 24), tag(2027, 1, 2)], skip: [tag(2026, 1, 6)] },
      2026,
    );
    expect(p).toHaveLength(13);
    expect(p[1]).toEqual({
      date: tag(2026, 1, 6),
      name: 'Heilige Drei Koenige',
      eigen: false,
      gestrichen: true,
    });
    expect(p.find((h) => h.date === tag(2026, 12, 24))).toEqual({
      date: tag(2026, 12, 24),
      name: 'Eigener Feiertag',
      eigen: true,
      gestrichen: false,
    });
    expect(p.map((h) => h.date)).toEqual([...p.map((h) => h.date)].sort((a, b) => a - b));
    expect(holidayPreview(undefined, 2026)).toEqual([]);
  });

  it('holidayNameOn: Name am Feiertag, sonst undefined', () => {
    expect(holidayNameOn(by, tag(2026, 5, 14) + 7_200_000)).toBe('Christi Himmelfahrt');
    expect(holidayNameOn(by, tag(2026, 5, 15))).toBeUndefined();
    expect(holidayNameOn(undefined, tag(2026, 5, 14))).toBeUndefined();
    expect(holidayNameOn({ ...by, skip: [tag(2026, 5, 14)] }, tag(2026, 5, 14))).toBeUndefined();
    expect(holidayNameOn({ ...by, extra: [tag(2026, 12, 24)] }, tag(2026, 12, 24))).toBe(
      'Eigener Feiertag',
    );
  });
});

describe('Feiertage nach damaligem Recht ab 2017 (AUF-042)', () => {
  // Belege: GVBl. Berlin 2015 S. 378, 2019 S. 22, 2024 S. 460; GVOBl. M-V 2022 S. 427; HmbGVBl. 2018
  // S. 63; Bremen und Niedersachsen (Fassungen ab 29.06.2018); Schleswig-Holstein Drs. 19/509 (Beschluss
  // 22.02.2018); Thueringen Drs. 6/6163 (Beschluss 28.02.2019); GVBl. Bayern 2016 Nr. 4, GVBl. Hessen
  // 2013 S. 566, GV. NRW. 2015 S. 496, Nds. Drs. 18/827.
  const hat = (j: number, land: Bundesland, m: number, d: number) =>
    holidaysOf(j, land).some((h) => h.date === tag(j, m, d));
  const name = (j: number, land: Bundesland, m: number, d: number) =>
    holidaysOf(j, land).find((h) => h.date === tag(j, m, d))?.name;

  it('Berlin: Frauentag ab 2019, einmalig 2017, 2020 und 2025', () => {
    expect(hat(2018, 'BE', 3, 8)).toBe(false);
    expect(name(2019, 'BE', 3, 8)).toBe('Frauentag');
    expect(hat(2016, 'BE', 10, 31)).toBe(false);
    expect(name(2017, 'BE', 10, 31)).toBe('500. Jahrestag der Reformation');
    expect(hat(2018, 'BE', 10, 31)).toBe(false);
    expect(name(2020, 'BE', 5, 8)).toBe(
      '75. Jahrestag der Befreiung vom Nationalsozialismus und der Beendigung des Zweiten Weltkrieges in Europa',
    );
    expect(hat(2021, 'BE', 5, 8)).toBe(false);
    expect(name(2025, 'BE', 5, 8)).toBe(
      '80. Jahrestag der Befreiung vom Nationalsozialismus und der Beendigung des Zweiten Weltkriegs in Europa',
    );
    expect(hat(2026, 'BE', 5, 8)).toBe(false);
  });

  it('Reformationstag in HB, HH, NI und SH erst ab 2018; 2017 einmalig nur in HB und NI belegt', () => {
    for (const l of ['HB', 'HH', 'NI', 'SH'] as const) {
      expect([l, hat(2016, l, 10, 31), hat(2018, l, 10, 31)]).toEqual([l, false, true]);
    }
    expect(['HB', 'NI', 'HH', 'SH'].map((l) => hat(2017, l as Bundesland, 10, 31))).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(name(2018, 'HH', 10, 31)).toBe('Reformationstag');
  });

  it('Frauentag in MV ab 2023, Weltkindertag in TH ab 2019', () => {
    expect([hat(2022, 'MV', 3, 8), hat(2023, 'MV', 3, 8)]).toEqual([false, true]);
    expect([hat(2018, 'TH', 9, 20), hat(2019, 'TH', 9, 20)]).toEqual([false, true]);
  });

  it('31.10.2017 einmalig in BY, HE und NW; in BW, RP und SL nicht abgebildet', () => {
    for (const l of ['BY', 'HE', 'NW'] as const) {
      expect([l, hat(2016, l, 10, 31), hat(2017, l, 10, 31), hat(2018, l, 10, 31)]).toEqual([
        l,
        false,
        true,
        false,
      ]);
    }
    expect(['BW', 'RP', 'SL'].map((l) => hat(2017, l as Bundesland, 10, 31))).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('holidayHistoryNote: Rechtsstand, dazu der fehlende Beleg fuer den 31.10.2017', () => {
    const satz =
      'Fruehere Jahre rechnen nach dem damaligen Recht, ab 2017 amtlich belegt; davor gilt der Stand von 2017.';
    expect(holidayHistoryNote('BY')).toBe(satz);
    expect(holidayHistoryNote('BE')).toBe(satz);
    for (const l of ['BW', 'HH', 'RP', 'SH', 'SL'] as const) {
      expect(holidayHistoryNote(l)).toBe(
        `${satz} Den einmaligen Feiertag am 31.10.2017 kennt die App fuer dieses Land nicht (nicht amtlich belegt) – bei Bedarf als eigenen Tag eintragen.`,
      );
    }
  });
});
