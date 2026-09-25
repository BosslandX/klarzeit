import { describe, expect, it } from 'vitest';
import { cleanClockodoConfig } from './clockodo';

const CFG = {
  apiUser: 'testnutzer',
  syncFrom: new Date(2026, 8, 1).getTime(),
  defaultCustomersId: 11,
  defaultProjectsId: null,
  defaultServicesId: 31,
  billable: 1 as const,
};

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
});
