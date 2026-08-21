import {
  Building2,
  DoorOpen,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Ticket,
  UserRound,
  UtensilsCrossed,
  WifiOff,
} from 'lucide-react';
import { currentParticipant } from '@/stores/authStore';
import { QR_REFRESH_SECONDS, useLiveQr } from '@/features/qr/useLiveQr';
import { EntryQrCard } from '@/features/qr/EntryQrCard';
import { DetailPanel, Fact, FactList, IconTile, ProgressBar, StatusBadge } from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import { PanelMasonry } from '@/components/layout/PanelMasonry';

/**
 * My QR ID. One RSA-OAEP-encrypted QR works at every checkpoint — no
 * per-checkpoint selector needed anymore. Generated entirely on-device from
 * the public key cached at login; no network call on refresh, so this still
 * works offline exactly like the old TOTP scheme did.
 *
 * Laid out as an admin detail screen is: `FestivalScreen`, then panels on the
 * shared `DetailPanel` surface. The pass itself keeps its brand-gradient tile —
 * that is what makes it recognisable at a checkpoint from arm's length — but it
 * is now a *card*, with the wordmark and house on it, rather than a coloured box
 * around a QR. Beside it, from `lg` up, sit the two things a participant
 * actually needs to know and previously had to infer from one line of small
 * print: where the pass works, and why it keeps changing.
 *
 * Deliberately free of router imports — nothing here links anywhere, and keeping
 * it that way means the page can be rendered and tested on its own.
 */
export default function MyQrPage() {
  const participant = currentParticipant();
  const qr = useLiveQr();
  const { status, secondsRemaining } = qr;

  return (
    <FestivalScreen
      title="My QR"
      eyebrow={participant?.house ?? 'Participant'}
      subtitle="Show this at any checkpoint to be scanned. It works offline."
    >
      {/* The pass leads, and on a phone it is the whole screen. From `lg` it
          takes a fixed column and *sticks*, so the guidance beside it scrolls
          past a pass that stays readable — the same treatment the
          complete-profile rail uses. Sticking is also what makes the height
          difference between the two columns deliberate rather than a gap.
          Both columns are `minmax(0,…)` so a long value wraps inside its column
          instead of widening it. */}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <DetailPanel
          className="lg:sticky lg:top-4"
          title="Digital ID"
          trailing={
            status === 'ready' ? (
              <StatusBadge tone="success" className="gap-1.5">
                <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                Live
              </StatusBadge>
            ) : undefined
          }
          footer={
            status === 'ready' ? (
              <div className="flex flex-col gap-1.5">
                <span className="flex items-center justify-between gap-2 tabular-nums">
                  <span className="flex items-center gap-1.5">
                    <RefreshCw size={12} strokeWidth={2.5} aria-hidden /> Refreshes automatically
                  </span>
                  <span>in {secondsRemaining}s</span>
                </span>
                <ProgressBar
                  value={secondsRemaining}
                  max={QR_REFRESH_SECONDS}
                  label="Seconds until this QR code refreshes"
                />
              </div>
            ) : undefined
          }
        >
          <EntryQrCard qr={qr} />
        </DetailPanel>

        {/* Masonry, not a grid.

            These three panels are 4, 3 and 3 rows deep, and as a two-column grid
            that showed: the 4-row panel set the height of the row, the 3-row one
            beside it ended short of it, and "At The Checkpoint" — spanning both
            columns to get a full-width line for its numbered steps — began below
            the taller of the two, leaving a block of empty canvas under the
            shorter one. That hole is the uneven spacing on this screen. Columns
            pack by height, so they end level, nothing is stretched to match a
            neighbour, and the span is no longer needed to fill anything. */}
        <PanelMasonry columns={2}>
          <DetailPanel
            title="Where It Works"
            meta="4 checkpoints"
            footer="Nothing to choose and nothing to provision — the same code is read at every one of them."
          >
            <FactList>
              <Fact
                icon={UtensilsCrossed}
                label="Mess Halls"
                value="Scanned at the counter for each meal"
              />
              <Fact
                icon={Building2}
                label="Hostel Entry"
                value="Scanned on your way into your block"
              />
              <Fact
                icon={DoorOpen}
                label="Hostel Exit"
                value="Scanned again on your way out, so the block's headcount stays right"
              />
              <Fact
                icon={Ticket}
                label="Events & Workshops"
                value="Scanned by the organising team at the venue"
              />
            </FactList>
          </DetailPanel>

          {/* `meta` and `footer` on all three, as on the panel above: a count
              beside the title and a hairline note under the rows are what make a
              panel on this screen recognisable as the same object as a panel on
              Profile or Stay. Two of the three were missing both. */}
          <DetailPanel
            title="How It Stays Safe"
            meta="3 safeguards"
            footer="None of this needs the network: the pass is built on your phone from a key it already holds."
          >
            <FactList>
              <Fact
                icon={ShieldCheck}
                label="Encrypted"
                value="Your ID is encrypted with the fest's public key, so only a checkpoint can read it"
              />
              <Fact
                icon={RefreshCw}
                label="Short-Lived"
                value={`A new code every ${QR_REFRESH_SECONDS} seconds — a screenshot stops working almost immediately`}
              />
              <Fact
                icon={WifiOff}
                label="Works Offline"
                value="Generated on your phone, so a patchy signal at the gate changes nothing"
              />
            </FactList>
          </DetailPanel>

          <DetailPanel
            title="At The Checkpoint"
            meta="3 steps"
            footer="A volunteer scans the code; you never type anything or hand your phone over."
          >
            <ol className="flex flex-col">
              <Step icon={UserRound} n={1} text="Open this screen and turn your brightness up." />
              <Step icon={ScanLine} n={2} text="Hold the code steady under the scanner." />
              <Step
                icon={ShieldCheck}
                n={3}
                text="Wait for the volunteer's confirmation before moving on."
              />
            </ol>
          </DetailPanel>
        </PanelMasonry>
      </div>
    </FestivalScreen>
  );
}

/**
 * One numbered instruction, on a `Fact` row's rhythm — same tile, same hairline,
 * same padding — so all three panels on this screen read as one list vocabulary
 * rather than as two.
 */
function Step({
  icon,
  n,
  text,
}: {
  icon: React.ComponentProps<typeof IconTile>['icon'];
  n: number;
  text: string;
}) {
  return (
    <li className="flex items-center gap-3 border-b border-line py-3 first:pt-0 last:border-b-0 last:pb-0">
      <IconTile icon={icon} size="sm" tone="muted" />
      <span className="min-w-0 text-sm leading-relaxed text-ink">
        <span className="mr-1.5 font-black tabular-nums text-brand">{n}.</span>
        {text}
      </span>
    </li>
  );
}
