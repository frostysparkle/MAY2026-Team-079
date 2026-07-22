import { useState } from 'react';
import { api, ApiClientError } from '@/api';
import type { OnboardingChoice } from '@/api/types';
import { Button, Card, ResultBanner } from '@/components/ui';

/**
 * Accommodation intent (optional). The student only expresses intent here — the
 * block/room stays admin-allocated and the fee is settled in the payment step
 * (spec: student-experience-redesign, Req 4, Property 7).
 */
export function AccommodationStep({ onDone }: { onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState<OnboardingChoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(choice: OnboardingChoice) {
    setBusy(choice);
    setError(null);
    try {
      await api.setAccommodationChoice(choice);
      await onDone();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not save your choice. Try again.');
      setBusy(null);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-bold text-ink">Need a place to stay?</h2>
        <p className="mt-1 text-sm text-muted">
          Book on-campus hostel accommodation for the fest. You can skip this if you’re commuting.
        </p>
      </div>

      {error && (
        <ResultBanner variant="error" title="Could not save">
          {error}
        </ResultBanner>
      )}

      <div className="flex flex-col gap-2">
        <Button fullWidth loading={busy === 'yes'} onClick={() => void choose('yes')}>
          Yes, book accommodation
        </Button>
        <Button
          fullWidth
          variant="secondary"
          loading={busy === 'no'}
          onClick={() => void choose('no')}
        >
          No, I’ll arrange my own
        </Button>
      </div>
    </Card>
  );
}
