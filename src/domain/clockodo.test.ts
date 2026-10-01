import { describe, expect, it } from 'vitest';
import {
  cleanClockodoConfig,
  cleanClockodoSync,
  cleanClockodoEntryRef,
  cleanClockodoAbsenceRef,
  defaultEntryRef,
} from './clockodo';

const CFG = {
  apiUser: 'testnutzer',
  syncFrom: new Date(2026, 8, 1).getTime(),
  defaultCustomersId: 11,
  defaultProjectsId: null,
  defaultServicesId: 31,
  billable: 1 as const,
};

const REF = { customersId: 11, projectsId: 21, servicesId: 31 };

describe('clockodo domain', () => {
  it('cleanClockodoConfig: gueltige Konfiguration bleibt', () => {
    expect(cleanClockodoConfig({ ...CFG, apiUser: ' testnutzer ' })).toEqual(
      CFG,
    );
  });

  it('cleanClockodoConfig: ungueltige Werte', () => {
    expect(cleanClockodoConfig(null)).toBeNull();
    expect(cleanClockodoConfig(undefined)).toBeNull();
    expect(cleanClockodoConfig('x')).toBeNull();
    expect(cleanClockodoConfig({ ...CFG, syncFrom: 'x' })).toBeNull();
    expect(
      cleanClockodoConfig({ ...CFG, defaultCustomersId: 0 }),
    ).toMatchObject({ defaultCustomersId: null });
    expect(
      cleanClockodoConfig({ ...CFG, defaultCustomersId: -3 }),
    ).toMatchObject({ defaultCustomersId: null });
    expect(
      cleanClockodoConfig({ ...CFG, defaultCustomersId: 1.5 }),
    ).toMatchObject({ defaultCustomersId: null });
    expect(
      cleanClockodoConfig({ ...CFG, defaultCustomersId: '11' }),
    ).toMatchObject({ defaultCustomersId: null });
    expect(cleanClockodoConfig({ ...CFG, billable: 2 })).toMatchObject({
      billable: null,
    });
    expect(cleanClockodoConfig({ ...CFG, apiUser: 5 })).toMatchObject({
      apiUser: '',
    });
  });

  it('cleanClockodoEntryRef: gueltige Auswahl', () => {
    expect(cleanClockodoEntryRef(REF)).toEqual(REF);
    expect(cleanClockodoEntryRef({ customersId: 11, servicesId: 31 })).toEqual({
      customersId: 11,
      projectsId: null,
      servicesId: 31,
    });
    expect(cleanClockodoEntryRef({ ...REF, projectsId: null })).toEqual({
      customersId: 11,
      projectsId: null,
      servicesId: 31,
    });
  });

  it('cleanClockodoEntryRef: ungueltige Auswahl', () => {
    expect(cleanClockodoEntryRef(null)).toBeNull();
    expect(cleanClockodoEntryRef('x')).toBeNull();
    expect(cleanClockodoEntryRef({ servicesId: 31 })).toBeNull();
    expect(cleanClockodoEntryRef({ customersId: 11, servicesId: 0 })).toBeNull();
    expect(cleanClockodoEntryRef({ customersId: '11', servicesId: 31 })).toBeNull();
    expect(
      cleanClockodoEntryRef({ customersId: 11, projectsId: 1.5, servicesId: 31 }),
    ).toBeNull();
  });


  it('cleanClockodoSync prueft Stand', () => {
    const ok = { ids: [101, 102], hash: 'abcd1234', at: 5 };
    expect(cleanClockodoSync(ok)).toEqual(ok);
    expect(cleanClockodoSync({ ids: [] })).toBeNull();
    expect(cleanClockodoSync({ ids: [0], hash: 'a', at: 1 })).toBeNull();
    expect(cleanClockodoSync({ ids: [1.5], hash: 'a', at: 1 })).toBeNull();
    expect(cleanClockodoSync({ ids: [1], hash: '', at: 1 })).toBeNull();
    expect(cleanClockodoSync({ ids: [1], hash: 'a', at: 'x' })).toBeNull();
    expect(cleanClockodoSync(null)).toBeNull();
  });

  it('defaultEntryRef aus den Vorgaben', () => {
    expect(defaultEntryRef(CFG)).toEqual({
      customersId: 11,
      projectsId: null,
      servicesId: 31,
    });
    expect(defaultEntryRef({ ...CFG, defaultProjectsId: 21 })).toEqual({
      customersId: 11,
      projectsId: 21,
      servicesId: 31,
    });
    expect(defaultEntryRef({ ...CFG, defaultServicesId: null })).toBeNull();
    expect(defaultEntryRef(null)).toBeNull();
  });

  it('cleanClockodoAbsenceRef: ganze positive id, Status 0 bis 4, endliche Zeit', () => {
    expect(cleanClockodoAbsenceRef({ id: 5, status: 0, at: 1 })).toEqual({ id: 5, status: 0, at: 1 });
    expect(cleanClockodoAbsenceRef({ id: 5, status: 4, at: 1 })).toEqual({ id: 5, status: 4, at: 1 });
    for (const id of [0, -1, 1.5, '5']) {
      expect(cleanClockodoAbsenceRef({ id, status: 0, at: 1 })).toBeNull();
    }
    for (const status of [5, -1, 1.5, '0', null]) {
      expect(cleanClockodoAbsenceRef({ id: 5, status, at: 1 })).toBeNull();
    }
    for (const at of [Number.NaN, 'x', undefined]) {
      expect(cleanClockodoAbsenceRef({ id: 5, status: 0, at })).toBeNull();
    }
    for (const raw of [null, undefined, 7, 'x']) {
      expect(cleanClockodoAbsenceRef(raw)).toBeNull();
    }
  });
});
