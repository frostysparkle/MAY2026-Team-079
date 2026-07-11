import { describe, it, expect } from 'vitest';
import { encodeQrPayload, decodeQrPayload } from './payload';

describe('QR payload', () => {
  it('encodes and decodes a payload round-trip', () => {
    const encoded = encodeQrPayload({ pid: 'p_1', code: '123456' });
    expect(decodeQrPayload(encoded)).toEqual({ pid: 'p_1', code: '123456' });
  });

  it('returns null for non-JSON or unrelated QR content', () => {
    expect(decodeQrPayload('https://example.com')).toBeNull();
    expect(decodeQrPayload('{"foo":"bar"}')).toBeNull();
  });
});
