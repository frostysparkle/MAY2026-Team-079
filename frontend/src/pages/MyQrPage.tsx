import { useEffect, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { CHECKPOINT_TYPES, type CheckpointType } from '@/config/constants';
import { useAuthStore } from '@/stores/authStore';
import { useDeviceSecret } from '@/features/qr/useDeviceSecret';
import { encodeQrPayload } from '@/features/qr/payload';
import { generateCode, secondsRemaining } from '@/lib/totp';
import { Spinner, ErrorState } from '@/components/ui';
import { cn } from '@/lib/cn';

const CHECKPOINT_LABELS: Record<CheckpointType, string> = {
  event: 'Event',
  mess: 'Mess',
  hostel: 'Hostel',
  workshop: 'Workshop',
};

/**
 * My QR ID. The digital identity is generated entirely on-device from the cached
 * per-checkpoint secret — no server call on refresh — and works offline once the
 * secret has been provisioned. A checkpoint selector picks which context's code
 * to show, since secrets are scoped per checkpoint.
 */
export default function MyQrPage() {
  const participant = useAuthStore((s) => s.participant);
  const [checkpoint, setCheckpoint] = useState<CheckpointType>('event');
  const { secret, status, error, retry } = useDeviceSecret(checkpoint);

  // Tick every second so the code and countdown stay current. Generation is
  // local and cheap; this never touches the network.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const code = secret ? generateCode(secret, now) : null;
  const remaining = secondsRemaining(now);

  return (
    <div className="flex flex-col gap-5 p-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900">My Digital ID</h1>
        <p className="text-sm text-muted">Show this QR at the checkpoint to be scanned.</p>
      </div>

      {/* Checkpoint selector — each checkpoint uses its own secret. */}
      <div role="tablist" aria-label="Checkpoint" className="flex gap-2 overflow-x-auto">
        {CHECKPOINT_TYPES.map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={checkpoint === c}
            onClick={() => setCheckpoint(c)}
            className={cn(
              'rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap',
              checkpoint === c ? 'bg-brand text-white' : 'bg-gray-100 text-muted',
            )}
          >
            {CHECKPOINT_LABELS[c]}
          </button>
        ))}
      </div>

      <div className="flex flex-col items-center gap-4 rounded-2xl border border-line bg-surface p-6">
        {status === 'loading' && (
          <div className="flex h-64 flex-col items-center justify-center gap-3">
            <Spinner size={32} label="Preparing your digital ID" />
            <p className="text-sm text-muted">Preparing your ID…</p>
          </div>
        )}

        {status === 'error' && (
          <ErrorState title="ID not ready" description={error ?? undefined} onRetry={retry} />
        )}

        {status === 'ready' && code && participant && (
          <>
            <div className="rounded-xl bg-white p-4">
              <QRCodeCanvas
                value={encodeQrPayload({ pid: participant.id, code })}
                size={220}
                level="M"
                aria-label="Your digital ID QR code"
              />
            </div>
            {/* Basic numeric countdown; an animated ring is a later refinement. */}
            <div className="text-center">
              <p className="font-mono text-2xl tracking-widest text-gray-900">{code}</p>
              <p className="text-xs text-muted">Refreshes in {remaining}s</p>
            </div>
            <div className="text-center">
              <p className="font-semibold text-gray-900">{participant.fullName || participant.email}</p>
              <p className="text-xs text-muted">ID: {participant.id}</p>
            </div>
          </>
        )}
      </div>

      <p className="text-center text-xs text-muted">
        Works offline. Your code changes every 30 seconds for security.
      </p>
    </div>
  );
}
