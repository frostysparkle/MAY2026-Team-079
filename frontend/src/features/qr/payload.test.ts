import { describe, it, expect } from 'vitest';
import { encodeQrPayload, decodeQrPayload } from './payload';

describe('qr payload', () => {
  it('round-trips a valid ScanQRRequest', () => {
    const req = {
      participant_id: 'DS23F1000001',
      data: 'Y2lwaGVy',
      timestamp: '2026-08-16T10:00:00Z',
    };
    expect(decodeQrPayload(encodeQrPayload(req))).toEqual(req);
  });

  it('returns null for malformed JSON', () => {
    expect(decodeQrPayload('not json')).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    expect(decodeQrPayload(JSON.stringify({ participant_id: 'x' }))).toBeNull();
  });
});
