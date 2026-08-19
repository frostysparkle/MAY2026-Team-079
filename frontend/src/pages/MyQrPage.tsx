import { QRCodeCanvas } from 'qrcode.react';
import { currentParticipant } from '@/stores/authStore';
import { useLiveQr } from '@/features/qr/useLiveQr';
import { encodeQrPayload } from '@/features/qr/payload';
import { Avatar, ErrorState, SectionHeading, Spinner, StatusBadge } from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';

/**
 * My QR ID. One RSA-OAEP-encrypted QR works at every checkpoint — no
 * per-checkpoint selector needed anymore. Generated entirely on-device from
 * the public key cached at login; no network call on refresh, so this still
 * works offline exactly like the old TOTP scheme did.
 *
 * Framed by `FestivalScreen` like every other screen, with the gradient tile kept
 * as the panel's contents: the brand-coloured card is what makes the pass
 * recognisable at a checkpoint from arm's length, so it stays.
 *
 * Deliberately free of router imports — nothing here links anywhere, and keeping
 * it that way means the page can be rendered and tested on its own.
 */
export default function MyQrPage() {
  const participant = currentParticipant();
  const { payload, status, error, secondsRemaining, retry } = useLiveQr();

  return (
    <FestivalScreen
      title="My QR"
      eyebrow={participant?.house ?? 'Participant'}
      subtitle="Show this at any checkpoint to be scanned. It works offline."
      width="md"
    >
      <section className="flex flex-col gap-4 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-black/[0.03]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionHeading title="Digital ID" />
          {status === 'ready' && (
            <StatusBadge tone="success">Refreshes in {secondsRemaining}s</StatusBadge>
          )}
        </div>

        <div className="flex flex-col items-center gap-4 rounded-2xl bg-gradient-to-br from-brand to-accent p-6 shadow-lift">
          {status === 'loading' && (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-white">
              <Spinner size={32} label="Preparing your digital ID" />
              <p className="text-sm opacity-90">Preparing your ID…</p>
            </div>
          )}

          {status === 'error' && (
            <div className="w-full rounded-2xl bg-surface p-2">
              <ErrorState title="ID not ready" description={error ?? undefined} onRetry={retry} />
            </div>
          )}

          {status === 'ready' && payload && participant && (
            <>
              <div className="rounded-2xl bg-white p-4 shadow-card">
                <QRCodeCanvas
                  value={encodeQrPayload(payload)}
                  size={220}
                  level="M"
                  aria-label="Your digital ID QR code"
                />
              </div>
              <div className="flex items-center gap-3 rounded-2xl bg-white/15 px-4 py-2.5 backdrop-blur-sm">
                <Avatar
                  src={participant.photo}
                  name={participant.full_name || participant.email}
                  size={36}
                />
                <div className="text-left text-white">
                  <p className="font-semibold">{participant.full_name || participant.email}</p>
                  <p className="text-xs opacity-80">ID: {participant.id}</p>
                </div>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-xs text-muted">
          Your QR refreshes automatically for security. A screenshot will stop working.
        </p>
      </section>
    </FestivalScreen>
  );
}
