import type { ScanResultCode } from '@/api/types';
import type { BannerVariant } from '@/components/ui';

export interface ResultDisplay {
  variant: BannerVariant;
  title: string;
  description: string;
}

/**
 * Presentation for every scan outcome. All seven codes are handled explicitly —
 * a scan never falls through to a generic error. Valid is green; hard failures
 * are red; recoverable/soft states (duplicate, payment pending) are amber.
 */
export const RESULT_DISPLAY: Record<ScanResultCode, ResultDisplay> = {
  valid: {
    variant: 'success',
    title: 'Valid',
    description: 'Entry allowed.',
  },
  expired: {
    variant: 'error',
    title: 'Expired QR',
    description: 'This code has expired. Ask the participant to show a fresh code.',
  },
  unknown_participant: {
    variant: 'error',
    title: 'Unknown Participant',
    description: 'No participant matches this ID.',
  },
  duplicate: {
    variant: 'warning',
    title: 'Duplicate Scan',
    description: 'This code was already used. Ask for a fresh code before re-entry.',
  },
  wrong_checkpoint: {
    variant: 'error',
    title: 'Wrong Checkpoint',
    description: 'This ID is not valid for this checkpoint.',
  },
  not_eligible: {
    variant: 'error',
    title: 'Not Eligible',
    description: 'The participant is not eligible at this checkpoint.',
  },
  payment_pending: {
    variant: 'warning',
    title: 'Payment Pending',
    description: 'Payment is not complete. Direct the participant to resolve payment.',
  },
};
