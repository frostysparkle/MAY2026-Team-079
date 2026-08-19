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
 * **No `grid` for the panels.** The fact groups are 3 and 4 rows tall, so a
 * grid row is as tall as its tallest panel and every shorter one trails a strip
 * of empty surface. The masonry `HomePage` already uses packs them by height
 * instead, which is why the columns end level.
 *
 * Read-only by construction: every control here navigates, and nothing writes.
 * Editing is `CompleteProfilePage`'s job.
 */
export default function ProfilePage() {
  const navigate = useNavigate();
  const participant = currentParticipant();

  if (!participant) {
    return (
      <FestivalScreen title="Profile" eyebrow="Participant" width="md">
        <EmptyState title="Not signed in" description="Please sign in to view your profile." />
      </FestivalScreen>
    );
  }

  // An incomplete profile has almost nothing to lay out, and every module gates
  // on it, so the one thing worth showing is the way to finish it.
  if (participant.full_name === null) {
    return (
      <FestivalScreen title="Profile" eyebrow="Participant" width="md">
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
      actions={
        <>
          <Button onClick={() => navigate(ROUTES.completeProfile)} className="gap-1.5">
            <FileEdit size={15} strokeWidth={2.5} /> Edit profile
          </Button>
          <Button
            variant="secondary"
            onClick={() => navigate(ROUTES.changePassword)}
            className="gap-1.5"
          >
            <Lock size={14} /> Change password
          </Button>
          <Button variant="ghost" onClick={() => navigate(ROUTES.myQr)} className="gap-1.5">
            <QrCode size={14} /> My QR
          </Button>
        </>
      }
    >
      {/* ---- identity ----
          Two halves that each earn their width: who you are on the left, how
          complete the record is on the right. The right half is why this is a
          bespoke block rather than a `DetailPanel` — it is the page's only
          figure, and it belongs beside the name rather than in a row of cards
          of its own. */}
      <section className="relative overflow-hidden rounded-2xl bg-surface p-5 shadow-card ring-1 ring-black/[0.03] sm:p-6">
        {/* A wash of the brand gradient rather than a solid band: it marks this
            card as the page's subject without turning it into a second title. */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-28 bg-gradient-to-br from-brand to-accent opacity-[0.08]"
        />

        <div className="relative flex flex-col items-center gap-5 text-center sm:flex-row sm:items-center sm:text-left">
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

          <div className="w-full shrink-0 rounded-2xl bg-surface-2/70 p-4 text-left ring-1 ring-line sm:w-56">
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
          Masonry rather than a grid: the groups are 3 and 4 rows tall, and
          columns that pack by height end level where grid rows do not. */}
      <div className="gap-5 md:columns-2 xl:columns-3 [&>*]:mb-5 [&>*]:break-inside-avoid">
        {/* The name is not repeated here: it is the largest thing on the header
            block above, and a screen that says it twice reads as a form
            print-out rather than as a profile. */}
        <DetailPanel title="Personal">
          <FactList>
            <Fact icon={Cake} label="Date of Birth" value={formatDob(participant.dob)} />
            <Fact icon={UserRound} label="Gender" value={genderLabel(participant.gender)} />
            <Fact icon={Phone} label="Phone" value={participant.phone} />
          </FactList>
        </DetailPanel>

        <DetailPanel title="Location">
          <FactList>
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
        <DetailPanel title="Academic & Fest">
          <FactList>
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
            title="Emergency Contact"
            footer="Used by the organisers only if something happens to you on campus."
          >
            <FactList>
              <Fact icon={UserRound} label="Name" value={emergency.name} />
              <Fact icon={LifeBuoy} label="Relation" value={emergency.relation} />
              <Fact icon={Phone} label="Phone" value={emergency.phone} />
            </FactList>
          </DetailPanel>
        )}

        {!complete && (
          <DetailPanel
            title="Still Missing"
            meta={`${completion.missing.length}`}
            footer="Some modules — hostel and mess allocation among them — need a complete profile."
          >
            <div className="flex flex-wrap gap-1.5">
              {completion.missing.map((label) => (
                <StatusBadge key={label} tone="warning">
                  {label}
                </StatusBadge>
              ))}
            </div>
            <Button
              size="sm"
              onClick={() => navigate(ROUTES.completeProfile)}
              className="w-fit gap-1.5"
            >
              <FileEdit size={13} strokeWidth={2.5} /> Add them
            </Button>
          </DetailPanel>
        )}
      </div>
    </FestivalScreen>
  );
}
