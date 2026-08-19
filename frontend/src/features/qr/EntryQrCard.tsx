import { QRCodeCanvas } from 'qrcode.react';
import { currentParticipant } from '@/stores/authStore';
import { encodeQrPayload } from '@/features/qr/payload';
import type { LiveQr } from '@/features/qr/useLiveQr';
import { Avatar, ErrorState, Spinner } from '@/components/ui';

/**
 * The pass itself — the brand-gradient card carrying the participant's live QR,
 * their photo, name and ID.
 *
 * A gradient card rather than a plain frame: a scanner-side volunteer recognises
 * the colour before they read anything on it. Shared between My QR and the
 * Accommodation & Mess confirmation so the code a student is told to show at the
 * hostel gate is visibly the same object in both places, rather than two cards
 * that only happen to encode the same payload.
 *
 * Takes the live-QR state as a prop instead of calling `useLiveQr` itself: the
 * page owning the card usually needs the countdown too, and two hook instances
 * would run two encryption timers against one screen.
 */
export function EntryQrCard({ qr, size = 220 }: { qr: LiveQr; size?: number }) {
  const participant = currentParticipant();
  const displayName = participant?.full_name || participant?.email || 'Participant';

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand to-accent p-5 shadow-lift">
      <div
        aria-hidden
        className="absolute -right-12 -top-14 h-40 w-40 rounded-full bg-white/20 blur-2xl"
      />

      <div className="relative flex flex-col items-center gap-4">
        <div className="flex w-full items-center justify-between gap-2 text-white">
          <span className="text-[10px] font-black uppercase tracking-[0.22em] opacity-90">
            Paradox Connect
          </span>
          {participant?.house && (
            <span className="truncate rounded-full bg-white/20 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider backdrop-blur-sm">
              {participant.house}
            </span>
          )}
        </div>

        {qr.status === 'loading' && (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-white">
            <Spinner size={32} label="Preparing your digital ID" />
            <p className="text-sm opacity-90">Preparing your ID…</p>
          </div>
        )}

        {qr.status === 'error' && (
          <div className="w-full rounded-2xl bg-surface p-2">
            <ErrorState
              title="ID not ready"
              description={qr.error ?? undefined}
              onRetry={qr.retry}
            />
          </div>
        )}

        {qr.status === 'ready' && qr.payload && participant && (
          <>
            <div className="rounded-2xl bg-white p-4 shadow-card">
              <QRCodeCanvas
                value={encodeQrPayload(qr.payload)}
                size={size}
                level="M"
                aria-label="Your digital ID QR code"
              />
            </div>
            <div className="flex w-full items-center gap-3 rounded-2xl bg-white/15 px-4 py-2.5 backdrop-blur-sm">
              <Avatar src={participant.photo} name={displayName} size={40} />
              <div className="min-w-0 text-left text-white">
                <p className="truncate font-semibold">{displayName}</p>
                <p className="truncate text-xs tabular-nums opacity-80">ID: {participant.id}</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
