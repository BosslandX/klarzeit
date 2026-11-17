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
