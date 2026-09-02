import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PHONE_ISO,
  INDIA,
  formatPhone,
  parsePhone,
  phoneError,
  phoneFieldError,
  validatePhone,
} from './phone';

describe('phone countries', () => {
  it('defaults to India at 10 national digits', () => {
    expect(DEFAULT_PHONE_ISO).toBe('IN');
    expect(INDIA.callingCode).toBe('91');
    expect(INDIA.min).toBe(10);
    expect(INDIA.max).toBe(10);
  });
});

describe('validatePhone', () => {
  it('treats a bare Indian mobile as +91', () => {
    expect(validatePhone('9876543210')).toBe('+91 9876543210');
  });

  it('canonicalises an explicit India number', () => {
    expect(validatePhone('+91 9876543210')).toBe('+91 9876543210');
    expect(validatePhone('+919876543210')).toBe('+91 9876543210');
  });

  it('drops a trunk zero when the remainder fits the limit', () => {
    expect(validatePhone('+91 09876543210')).toBe('+91 9876543210');
  });

  it('rejects more than 10 national digits for India', () => {
    expect(phoneError('+91 98765432101')).toMatch(/cannot exceed 10 digits/);
  });

  it('rejects fewer than 10 national digits for India', () => {
    expect(phoneError('+91 987654321')).toMatch(/10 digits/);
  });

  it('validates the United States at 10 digits after +1', () => {
    expect(validatePhone('+1 4155550100')).toBe('+1 4155550100');
  });

  it("uses the UAE limit, not India's", () => {
    expect(validatePhone('+971 501234567')).toBe('+971 501234567');
    expect(phoneError('+971 50123456789')).toMatch(/cannot exceed/);
  });

  it('caps Singapore at 8 national digits', () => {
    expect(validatePhone('+65 81234567')).toBe('+65 81234567');
    expect(phoneError('+65 812345678')).toMatch(/cannot exceed 8 digits/);
  });

  it('rejects an unknown country code', () => {
    expect(phoneError('+999 12345678')).toMatch(/country code/);
  });
});

describe('phoneFieldError', () => {
  it('leaves emptiness to the required rule', () => {
    expect(phoneFieldError('')).toBe(true);
    expect(phoneFieldError('   ')).toBe(true);
  });

  it('returns the country-specific message for a bad number', () => {
    expect(phoneFieldError('+91 123')).toMatch(/10 digits/);
  });
});

describe('parsePhone', () => {
  it('does not enforce length, so the error can name the cap', () => {
    const parsed = parsePhone('+91 123');
    expect(parsed?.country.iso).toBe('IN');
    expect(parsed?.national).toBe('123');
  });

  it('formats as +code then national digits', () => {
    expect(formatPhone(INDIA, '9876543210')).toBe('+91 9876543210');
  });
});
