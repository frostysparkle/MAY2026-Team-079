import { useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Cake,
  FileEdit,
  Flag,
  Globe2,
  GraduationCap,
  Home,
  LifeBuoy,
  Lock,
  Map,
  MapPin,
  Phone,
  QrCode,
  UserRound,
  UtensilsCrossed,
} from 'lucide-react';
import { ROUTES } from '@/config/routes';
import { currentParticipant } from '@/stores/authStore';
import {
  Avatar,
  Button,
  BUTTON_ICON,
  BUTTON_ICON_STROKE,
  DetailPanel,
  EmptyState,
  Fact,
  FactList,
  ProgressBar,
  StatusBadge,
} from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import {
  courseStageLabel,
  formatDob,
  genderLabel,
  messPreferenceLabel,
  profileCompletion,
} from '@/features/profile/profileDisplay';

/**
 * The participant's own record, read-only — dressed as every other signed-in
 * screen: `FestivalScreen`, then `DetailPanel` surfaces carrying the shared
 * `Fact` rows, exactly as the Stay screen and the admin sections do.
 *
 * Two things this page deliberately does *not* do, both of them lessons from
 * the version before this one:
 *
 * **No row of `StatCard`s.** A stat row is the right opening for an admin
 * section because those screens open on counts. A profile has exactly one
 * figure — how complete it is — and the four cards that were here filled the
 * other three slots with the house, the course stage and the participant ID:
 * the same three facts already sitting as badges in the header directly above,
 * restated as headline figures they were too long to be. Four cards two-across
 * on a laptop, each holding one short word, is where most of this screen's
 * empty space came from. Completeness now lives in the header block that
 * actually needs a right-hand half, and the other three are read where they
 * belong, in the panels.
 *
 * A `grid`, not the masonry other screens use, for the panels below: the fact
 * groups here are all facets of one record rather than unrelated cards, so a
 * shorter one ("Personal") is meant to match a taller neighbour ("Location")
 * rather than settle at its own height. Every panel in that row shares one
 * fixed height (`h-72`) rather than stretching to match whichever is tallest —
 * stretching a three-row panel to a four-row panel's height just moves the
 * unused space from beside the card to inside it. The panels that can run past
 * that height scroll their own content instead of growing past it.
 *
 * Read-only by construction: every control here navigates, and nothing writes.
 * Editing is `CompleteProfilePage`'s job.
 */
export default function ProfilePage() {
  const navigate = useNavigate();
  const participant = currentParticipant();

  // Both fall-through states keep the screen's default width rather than
  // narrowing to `md`. A section that is 768px wide when it has nothing to show
  // and 1280px wide when it does moves its own title and eyebrow sideways as it
  // loads, which reads as the page having navigated somewhere.
  if (!participant) {
    return (
      <FestivalScreen title="Profile" eyebrow="Participant">
        <EmptyState title="Not signed in" description="Please sign in to view your profile." />
      </FestivalScreen>
    );
  }

  // An incomplete profile has almost nothing to lay out, and every module gates
  // on it, so the one thing worth showing is the way to finish it.
  if (participant.full_name === null) {
    return (
      <FestivalScreen title="Profile" eyebrow="Participant">
        <EmptyState
          title="Profile incomplete"
          description="Complete your profile to use every module."
          icon={FileEdit}
          action={
            <Button onClick={() => navigate(ROUTES.completeProfile)}>Complete your profile</Button>
          }
        />
      </FestivalScreen>
    );
  }

  const completion = profileCompletion(participant);
  const complete = completion.missing.length === 0;
  const messPreference = messPreferenceLabel(participant.mess_preference);
  const emergency = participant.emergency_contact;

  return (
    <FestivalScreen
      title="Profile"
      eyebrow={participant.house ?? 'Participant'}
      // Not the email: it is already under the name in the header block below,
      // and a screen that prints it twice within 200px reads as a bug.
      subtitle="Everything Paradox holds about you, and where to change it."
      // Three medium buttons, so three identically sized glyphs at one stroke
      // weight and the medium gap `Button` already sets. They used to be 15/14/14
      // at two weights with the small button's gap forced onto all three.
      actions={
        <>
          <Button onClick={() => navigate(ROUTES.completeProfile)}>
            <FileEdit size={BUTTON_ICON.md} strokeWidth={BUTTON_ICON_STROKE} /> Edit profile
          </Button>
          <Button variant="secondary" onClick={() => navigate(ROUTES.changePassword)}>
            <Lock size={BUTTON_ICON.md} strokeWidth={BUTTON_ICON_STROKE} /> Change password
          </Button>
          <Button variant="ghost" onClick={() => navigate(ROUTES.myQr)}>
            <QrCode size={BUTTON_ICON.md} strokeWidth={BUTTON_ICON_STROKE} /> My QR
          </Button>
        </>
      }
    >
      {/* ---- identity ----
          Two halves that each earn their width: who you are on the left, how
          complete the record is on the right. The right half is why this is a
          bespoke block rather than a `DetailPanel` — it is the page's only
          figure, and it belongs beside the name rather than in a row of cards
          of its own.

          Bespoke, but not differently sized: the radius, surface, shadow, ring
          and `p-4 sm:p-5` padding are `DetailPanel`'s, so this reads as the same
          kind of card as the panels under it. It used to be `p-5 sm:p-6`, one step
          more generous than every other card on the screen, which is exactly the
          sort of difference that registers as sloppiness without being
          identifiable. */}
      <section className="relative overflow-hidden rounded-2xl bg-surface p-4 shadow-card ring-1 ring-black/[0.03] sm:p-5">
        {/* A wash of the brand gradient rather than a solid band: it marks this
            card as the page's subject without turning it into a second title. */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-28 bg-gradient-to-br from-brand to-accent opacity-[0.08]"
        />

        {/* `sm:items-center` was redundant beside the unprefixed `items-center`
            it repeats. */}
        <div className="relative flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
          <Avatar
            src={participant.photo}
            name={participant.full_name}
            size={88}
            className="shadow-lift"
          />

          <div className="min-w-0 flex-1">
            <h2 className="truncate text-2xl font-black tracking-tight text-ink">
              {participant.full_name}
            </h2>
            <p className="mt-0.5 truncate text-sm text-muted">{participant.email}</p>
            {/* No house chip here: the eyebrow above the title already carries
                it, as it does on every participant screen, and the panels below
                state it again as a fact. Three times on one screen is one time
                too many. */}
            <div className="mt-2.5 flex flex-wrap justify-center gap-1.5 sm:justify-start">
              {participant.program && (
                <StatusBadge tone="info">{participant.program} programme</StatusBadge>
              )}
              <StatusBadge tone="neutral">{participant.id}</StatusBadge>
            </div>
          </div>

          {/* Widens a step at `lg`, where the block itself has grown from ~600px
              to ~1000px: held at a flat 14rem it read as a chip stranded at the
              end of a long empty row rather than as the half of the card it is. */}
          <div className="w-full shrink-0 rounded-2xl bg-surface-2/70 p-4 text-left ring-1 ring-line sm:w-56 lg:w-64">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                Profile
              </span>
              <span className="text-2xl font-black leading-none tabular-nums text-ink">
                {completion.percent}%
              </span>
            </div>
            <ProgressBar
              value={completion.filled}
              max={completion.total}
              tone={complete ? 'success' : 'warning'}
              label="Profile completeness"
              className="mt-2.5"
            />
            <p className="mt-2 text-xs tabular-nums text-muted">
              {complete
                ? `All ${completion.total} details added`
                : `${completion.filled} of ${completion.total} details added`}
            </p>
          </div>
        </div>
      </section>

      {/* ---- the record itself ----
          A grid, not the masonry the dashboard uses: masonry packs columns by
          height on purpose, so a shorter panel settles at its own content
          height instead of matching a taller neighbour — right when the panels
          are unrelated cards, wrong here, where five fact-groups of the same
          record read as one uneven page if "Location"'s four rows and
          "Personal"'s three end at different heights.

          Matching height by *stretching* the shorter panels — `items-stretch`
          plus `h-full`, this row's previous shape — matches the outline but not
          the content: "Personal" and "Academic & Fest" grew a card-height taller
          than their own three rows fill, and the gap between the last row and
          the bottom edge is exactly what reads as an unfinished card. Neither
          panel has a fourth fact to add — every field the profile actually
          collects for "Personal" is already one of its three rows.

          So the row is capped at a fixed height sized to that common case
          instead — `h-72`, comfortable room for three or four rows — rather
          than borrowed from whichever neighbour happens to be tallest. Every
          `FactList` in the row carries the same `overflow-y-auto` safety net
          regardless of how many rows it normally holds: at the sizes these
          panels are built for, none of them fill it, but a long wrapped
          address or a `mess_preference` row landing on an already-full card
          scrolls inside its own panel instead of pushing the card's outline
          taller than its neighbours'. The same trade the workshop interest
          cards make (`WorkshopManagePage`'s `h-80` charts): a shared height
          sized to the normal content, with the rare overflow handled inside
          it rather than by growing the row to fit it. */}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {/* The name is not repeated here: it is the largest thing on the header
            block above, and a screen that says it twice reads as a form
            print-out rather than as a profile. */}
        <DetailPanel className="h-72" title="Personal">
          <FactList className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
            <Fact icon={Cake} label="Date of Birth" value={formatDob(participant.dob)} />
            <Fact icon={UserRound} label="Gender" value={genderLabel(participant.gender)} />
            <Fact icon={Phone} label="Phone" value={participant.phone} />
          </FactList>
        </DetailPanel>

        <DetailPanel className="h-72" title="Location">
          <FactList className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
            <Fact icon={MapPin} label="City" value={participant.city} />
            <Fact icon={Map} label="State" value={participant.state} />
            <Fact icon={Globe2} label="Country" value={participant.country} />
            <Fact icon={Home} label="Address" value={participant.address} />
          </FactList>
        </DetailPanel>

        {/* Academic and fest-side facts together: they are the four answers the
            organisers allocate on, and splitting them left two panels of two
            rows each. `mess_preference` is not returned by `/auth/login`, so it
            appears only once a profile save has merged it into the session — an
            absent row means "not loaded", never "not chosen", and must not be
            rendered as an empty one. */}
        <DetailPanel className="h-72" title="Academic & Fest">
          <FactList className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
            <Fact icon={GraduationCap} label="Program" value={participant.program} />
            <Fact
              icon={BookOpen}
              label="Course Stage"
              value={courseStageLabel(participant.course_stage)}
            />
            <Fact icon={Flag} label="House" value={participant.house} />
            {messPreference && (
              <Fact icon={UtensilsCrossed} label="Mess Preference" value={messPreference} />
            )}
          </FactList>
        </DetailPanel>

        {emergency && (
          <DetailPanel
            className="h-72"
            title="Emergency Contact"
            footer="Used by the organisers only if something happens to you on campus."
          >
            <FactList className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
              <Fact icon={UserRound} label="Name" value={emergency.name} />
              <Fact icon={LifeBuoy} label="Relation" value={emergency.relation} />
              <Fact icon={Phone} label="Phone" value={emergency.phone} />
            </FactList>
          </DetailPanel>
        )}

        {!complete && (
          <DetailPanel
            className="h-72"
            title="Still Missing"
            meta={`${completion.missing.length}`}
            footer="Some modules — hostel and mess allocation among them — need a complete profile."
          >
            {/* Badges rather than `Fact` rows here, so this is the one panel in
                the row that can genuinely outgrow `h-72` — up to twelve labels
                wrapping, against three or four fixed rows everywhere else — and
                the one that gets the scroll for it. */}
            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
              <div className="flex flex-wrap gap-1.5">
                {completion.missing.map((label) => (
                  <StatusBadge key={label} tone="warning">
                    {label}
                  </StatusBadge>
                ))}
              </div>
            </div>
            <Button size="sm" onClick={() => navigate(ROUTES.completeProfile)} className="w-fit">
              <FileEdit size={BUTTON_ICON.sm} strokeWidth={BUTTON_ICON_STROKE} /> Add them
            </Button>
          </DetailPanel>
        )}
      </div>
    </FestivalScreen>
  );
}
