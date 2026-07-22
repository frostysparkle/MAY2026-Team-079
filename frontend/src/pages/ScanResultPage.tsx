import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from '@/api';
import type { VerifyScanResponse } from '@/api/types';
import { ROUTES } from '@/config/routes';
import type { PendingScan } from '@/features/scan/types';
import { RESULT_DISPLAY } from '@/features/scan/resultDisplay';
import { Button, ResultBanner, Spinner } from '@/components/ui';

/**
 * Scan Result. Verifies the pending scan (loading state shown during the call)
 * and renders the outcome for all seven result codes, with the participant's
 * name/photo shown for a valid result so staff can cross-check.
 */
export default function ScanResultPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const scan = (location.state as PendingScan | null) ?? null;

  const [loading, setLoading] = useState(true);
  const [response, setResponse] = useState<VerifyScanResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!scan) return;
    let active = true;
    setLoading(true);
    api
      .verifyScan({
        participantId: scan.participantId,
        currentCode: scan.currentCode,
        checkpointContext: scan.checkpoint,
        eventId: scan.eventId,
      })
      .then((res) => active && setResponse(res))
      .catch(() => active && setFailed(true))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [scan]);

  // Direct navigation with no scan data → send back to the scanner.
  if (!scan) {
    return <Navigate to={ROUTES.scanner} replace />;
  }

  const display = response ? RESULT_DISPLAY[response.result] : null;

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col gap-5 p-4">
      <h1 className="text-xl font-black tracking-tight text-ink">Scan Result</h1>

      {loading && (
        <div className="flex flex-col items-center gap-3 py-12">
          <Spinner size={32} label="Verifying" />
          <p className="text-sm text-muted">Verifying…</p>
        </div>
      )}

      {!loading && failed && (
        <ResultBanner variant="error" title="Verification failed">
          Could not reach the server. Check the connection and try again.
        </ResultBanner>
      )}

      {!loading && display && response && (
        <>
          <ResultBanner variant={display.variant} title={display.title}>
            {response.detail ?? display.description}
          </ResultBanner>

          {response.participant && (
            <div className="flex items-center gap-3 rounded-xl border border-line p-4">
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-gray-100">
                {response.participant.photoUrl ? (
                  <img
                    src={response.participant.photoUrl}
                    alt={`${response.participant.fullName}'s profile`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted">
                    N/A
                  </div>
                )}
              </div>
              <div>
                <p className="font-semibold text-gray-900">{response.participant.fullName}</p>
                <p className="text-xs text-muted">ID: {response.participant.id}</p>
              </div>
            </div>
          )}
        </>
      )}

      <Button fullWidth onClick={() => navigate(ROUTES.scanner, { replace: true })}>
        Scan Next Participant
      </Button>
    </main>
  );
}
