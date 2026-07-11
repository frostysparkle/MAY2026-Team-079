import { describe, it, expect } from 'vitest';
import { RESULT_DISPLAY } from './resultDisplay';
import type { ScanResultCode } from '@/api/types';

const ALL_CODES: ScanResultCode[] = [
  'valid',
  'expired',
  'unknown_participant',
  'duplicate',
  'wrong_checkpoint',
  'not_eligible',
  'payment_pending',
];

describe('RESULT_DISPLAY', () => {
  it('handles every scan result code explicitly', () => {
    for (const code of ALL_CODES) {
      expect(RESULT_DISPLAY[code]).toBeDefined();
      expect(RESULT_DISPLAY[code].title).toBeTruthy();
      expect(RESULT_DISPLAY[code].description).toBeTruthy();
    }
  });

  it('maps valid to success and hard failures to error', () => {
    expect(RESULT_DISPLAY.valid.variant).toBe('success');
    expect(RESULT_DISPLAY.expired.variant).toBe('error');
    expect(RESULT_DISPLAY.wrong_checkpoint.variant).toBe('error');
    expect(RESULT_DISPLAY.payment_pending.variant).toBe('warning');
  });
});
