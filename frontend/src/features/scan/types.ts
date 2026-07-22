import type { CheckpointType } from '@/config/constants';

/**
 * Data the scanner hands to the Scan Result screen via router state. Verification
 * (the network call) happens on the result screen so its loading state is shown.
 */
export interface PendingScan {
  participantId: string;
  currentCode: string;
  checkpoint: CheckpointType;
  /** For event checkpoints: which event this scan counts toward (Epic 3). */
  eventId?: string;
}
