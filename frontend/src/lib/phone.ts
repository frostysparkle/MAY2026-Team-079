/**
 * Country-coded phone numbers for participant profiles.
 *
 * Mirrors `backend/phone.py` and `backend/phone_countries.json`. India is
 * the default country and is pinned to 10 national digits; a bare 10-digit
 * mobile starting 6–9 is still accepted so stored Indian numbers keep working.
 */

import phoneCountries from './phoneCountries.json';

export interface PhoneCountry {
  iso: string;
  name: string;
  callingCode: string;
  min: number;
  max: number;
}

export const DEFAULT_PHONE_ISO = 'IN';

const INDIA_MOBILE_START = new Set(['6', '7', '8', '9']);

export const PHONE_COUNTRIES: readonly PhoneCountry[] = phoneCountries;

const BY_ISO = new Map(PHONE_COUNTRIES.map((country) => [country.iso, country]));

const CALLING_CODE_INDEX: ReadonlyArray<readonly [string, PhoneCountry]> = (() => {
  const seen = new Map<string, PhoneCountry>();
  for (const country of PHONE_COUNTRIES) {
    if (!seen.has(country.callingCode)) seen.set(country.callingCode, country);
  }
  return [...seen.entries()].sort((a, b) => b[0].length - a[0].length);
})();

export const INDIA = mustCountry(DEFAULT_PHONE_ISO);

/** India first (the default), then every other country by name. */
export const PHONE_COUNTRY_OPTIONS: readonly PhoneCountry[] = [
  INDIA,
  ...PHONE_COUNTRIES.filter((country) => country.iso !== DEFAULT_PHONE_ISO).sort((a, b) =>
    a.name.localeCompare(b.name),
  ),
];

function mustCountry(iso: string): PhoneCountry {
  const country = BY_ISO.get(iso);
  if (!country) throw new Error(`phone country table is missing ${iso}`);
  return country;
}

export function countryByIso(iso: string): PhoneCountry | undefined {
  return BY_ISO.get(iso);
}

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export function formatPhone(country: PhoneCountry, national: string): string {
  return `+${country.callingCode} ${national}`;
}

export function lengthHint(country: PhoneCountry): string {
  return country.min === country.max
    ? `${country.max} digits`
    : `${country.min}–${country.max} digits`;
}

export interface ParsedPhone {
  country: PhoneCountry;
  national: string;
}

function matchCallingCode(digits: string): ParsedPhone | undefined {
  for (const [code, country] of CALLING_CODE_INDEX) {
    if (digits.startsWith(code) && digits.length > code.length) {
      return { country, national: digits.slice(code.length) };
    }
    if (digits === code) return { country, national: '' };
  }
  return undefined;
}

export function parsePhone(value: string): ParsedPhone | undefined {
  let text = value.trim();
  if (!text) return undefined;
  if (text.startsWith('00') && !text.startsWith('000')) text = `+${text.slice(2)}`;
  const hasPlus = text.startsWith('+');
  const digits = digitsOnly(text);
  if (!digits) return undefined;

  let parsed: ParsedPhone | undefined;
  if (hasPlus) {
    parsed = matchCallingCode(digits);
  } else if (digits.length === 10 && INDIA_MOBILE_START.has(digits[0] ?? '')) {
    parsed = { country: INDIA, national: digits };
  }
  if (!parsed) return undefined;

  const { country, national } = parsed;
  if (
    national.startsWith('0') &&
    country.min <= national.length - 1 &&
    national.length - 1 <= country.max
  ) {
    return { country, national: national.slice(1) };
  }
  return parsed;
}

export function phoneError(value: string): string | null {
  const text = value.trim();
  if (!text) return 'Enter a phone number.';
  const parsed = parsePhone(text);
  if (!parsed) return 'Enter a phone number with a country code, e.g. +91 9876543210.';
  const { country, national } = parsed;
  if (!national) return `Enter a number after +${country.callingCode}.`;
  if (national.length > country.max) {
    return `Phone number cannot exceed ${country.max} digits for ${country.name} (+${country.callingCode}).`;
  }
  if (national.length < country.min) {
    return `Enter a ${lengthHint(country)} number for ${country.name} (+${country.callingCode}).`;
  }
  return null;
}

export function validatePhone(value: string): string {
  const error = phoneError(value);
  if (error) throw new Error(error);
  const parsed = parsePhone(value);
  if (!parsed) throw new Error(error ?? 'Enter a valid phone number.');
  return formatPhone(parsed.country, parsed.national);
}

/** RHF `validate`: empty is the required rule's job; anything else must parse. */
export function phoneFieldError(value: string): true | string {
  if (!value.trim()) return true;
  return phoneError(value) ?? true;
}
