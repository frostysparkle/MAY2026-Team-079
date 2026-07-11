/**
 * TOTP helpers, wrapping `otpauth` with the app's fixed parameters
 * (SHA1 / 6 digits / 30s / ±1 window). These MUST match the backend `pyotp`
 * configuration and the architecture doc, or codes will never verify.
 */
import { TOTP as OTPAuthTOTP, Secret } from 'otpauth';
import { TOTP } from '@/config/constants';

function makeTotp(secretBase32: string): OTPAuthTOTP {
  return new OTPAuthTOTP({
    issuer: 'ParadoxConnect',
    algorithm: TOTP.algorithm,
    digits: TOTP.digits,
    period: TOTP.period,
    secret: Secret.fromBase32(secretBase32),
  });
}

/** Generate the current 6-digit code for a secret (used on the student device). */
export function generateCode(secretBase32: string, at: number = Date.now()): string {
  return makeTotp(secretBase32).generate({ timestamp: at });
}

/**
 * Verify a submitted code against a secret with ±window tolerance.
 * Returns the matched time-step delta (0, ±1) or null if invalid — the delta
 * lets a caller build replay protection keyed on the exact window.
 */
export function verifyCode(
  secretBase32: string,
  code: string,
  at: number = Date.now(),
): number | null {
  const delta = makeTotp(secretBase32).validate({
    token: code,
    timestamp: at,
    window: TOTP.window,
  });
  return delta; // null when no match within the window
}

/** Milliseconds remaining in the current 30s step (for the countdown UI). */
export function secondsRemaining(at: number = Date.now()): number {
  const stepMs = TOTP.period * 1000;
  return Math.ceil((stepMs - (at % stepMs)) / 1000);
}
