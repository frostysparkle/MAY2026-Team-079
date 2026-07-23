import { useEffect, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { api } from '@/api';
import type { MyRegistration } from '@/api/types';
import { CHECKPOINT_TYPES, TOTP, type CheckpointType } from '@/config/constants';
import { useAuthStore } from '@/stores/authStore';
import { useDeviceSecret } from '@/features/qr/useDeviceSecret';
import { encodeQrPayload } from '@/features/qr/payload';
import { generateCode, secondsRemaining } from '@/lib/totp';
import { Spinner, ErrorState, Avatar, Select } from '@/components/ui';
import { cn } from '@/lib/cn';

const CHECKPOINT_LABELS: Record<CheckpointType, string> = {
  event: 'Event',
  mess: 'Mess',
  hostel: 'Hostel',
  workshop: 'Workshop',
};

/**
 * The on-device digital identity card: a per-checkpoint TOTP QR generated
 * entirely client-side from the cached secret (works offline, refreshes every
 * 30s). Shared by the dedicated My QR screen and the My Pass hub so the pass
 * logic lives in exactly one place.
 */
export function DigitalIdCard() {
  const participant = useAuthStore((s) => s.participant);
  const [checkpoint, setCheckpoint] = useState<CheckpointType>('event');
  const [registeredEvents, setRegisteredEvents] = useState<MyRegistration[]>([]);
  const [eventId, setEventId] = useState('');
  const scopedEventId = checkpoint === 'event' ? eventId || undefined : undefined;
  const { secret, status, error, retry } = useDeviceSecret(checkpoint, scopedEventId);

  useEffect(() => {
    let active = true;
    api
      .listMyRegistrations()
      .then(({ registrations }) => {
        if (!active) return;
        setRegisteredEvents(registrations);
        setEventId((current) => current || registrations[0]?.eventId || '');
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const code = secret ? generateCode(secret, now) : null;
  const remaining = secondsRemaining(now);
  const fraction = remaining / TOTP.period;

  return (
    <div className="flex flex-col gap-4">
      {/* Checkpoint selector — each checkpoint uses its own secret. */}
      <div
        role="tablist"
        aria-label="Checkpoint"
        className="no-scrollbar flex gap-1 overflow-x-auto rounded-full bg-surface-2 p-1"
      >
        {CHECKPOINT_TYPES.map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={checkpoint === c}
            onClick={() => setCheckpoint(c)}
            className={cn(
              'tap flex-1 rounded-full px-3 py-1.5 text-sm font-semibold whitespace-nowrap',
              checkpoint === c ? 'bg-surface text-brand shadow-card' : 'text-muted',
            )}
          >
            {CHECKPOINT_LABELS[c]}
          </button>
        ))}
      </div>

      {checkpoint === 'event' && (
        <Select
          label="Registered event"
          placeholder={
            registeredEvents.length > 0 ? 'Select an event' : 'No registered events'
          }
          value={eventId}
          disabled={registeredEvents.length === 0}
          onChange={(event) => setEventId(event.target.value)}
          options={registeredEvents.map((event) => ({
            value: event.eventId,
            label: `${event.title} · ${event.eventDate}`,
          }))}
        />
      )}

      {/* The ID card */}
      <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-brand to-brand-dark p-5 shadow-lift">
        {status === 'ready' && code && participant && (
          <div className="flex items-center gap-3 pb-4 text-white">
            <Avatar
              src={participant.photoUrl}
              name={participant.fullName || participant.email}
              size={40}
            />
            <div className="min-w-0">
              <p className="truncate font-semibold">{participant.fullName || participant.email}</p>
              <p className="truncate text-xs text-white/70">
                {CHECKPOINT_LABELS[checkpoint]} · ID {participant.id}
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-col items-center gap-4 rounded-2xl bg-white p-6">
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
              <QRCodeCanvas
                value={encodeQrPayload({ pid: participant.id, code })}
                size={220}
                level="M"
                aria-label="Your digital ID QR code"
              />
              <div className="flex items-center gap-4">
                <p className="font-mono text-3xl font-bold tracking-[0.3em] text-ink">{code}</p>
                <CountdownRing seconds={remaining} fraction={fraction} />
              </div>
            </>
          )}
        </div>
      </div>

      <p className="text-center text-xs text-muted">
        Works offline · your code refreshes every {TOTP.period} seconds for security.
      </p>
    </div>
  );
}

/** Circular countdown that depletes over the current 30s TOTP window. */
function CountdownRing({ seconds, fraction }: { seconds: number; fraction: number }) {
  const radius = 15.9155; // circumference ~= 100 for easy dasharray math
  return (
    <div className="relative h-12 w-12">
      <svg viewBox="0 0 36 36" className="h-12 w-12 -rotate-90">
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          stroke="currentColor"
          className="text-surface-2"
          strokeWidth="3"
        />
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          stroke="currentColor"
          className="text-brand transition-[stroke-dashoffset] duration-1000 ease-linear"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="100"
          strokeDashoffset={100 - fraction * 100}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-ink">
        {seconds}
      </span>
    </div>
  );
}
