import { beforeEach, describe, expect, it } from 'vitest';
import { getScannerDeviceId } from './scannerDevice';

describe('getScannerDeviceId', () => {
  beforeEach(() => localStorage.clear());

  it('creates one stable browser identifier', () => {
    const first = getScannerDeviceId();
    const second = getScannerDeviceId();
    expect(first.length).toBeGreaterThanOrEqual(8);
    expect(second).toBe(first);
  });
});
