import { useNavigate } from 'react-router-dom';
import { FileEdit, Lock } from 'lucide-react';
import { ROUTES } from '@/config/routes';
import { currentParticipant } from '@/stores/authStore';
import { Avatar, Button, EmptyState, SectionHeading, StatusBadge } from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';

/**
 * The participant's own record, read-only.
 *
 * Laid out as the admin detail screens are: `FestivalScreen` with the actions in
 * its centred bar, then a panel per group of facts. The three groups were already
 * here; what changed is that they now use the shared `SectionHeading` and the same
 * panel surface as every other screen, instead of a local heading style and a bare
 * `Card` per section.
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

  return (
    <FestivalScreen
      title="Profile"
      eyebrow={participant.house ?? 'Participant'}
      subtitle={participant.email}
      width="lg"
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
        </>
      }
    >
      {/* Identity, on the same panel surface as the fact groups below it. */}
      <div className="flex items-center gap-4 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-black/[0.03]">
        <Avatar src={participant.photo} name={participant.full_name} size={72} />
        <div className="min-w-0">
          <p className="truncate text-lg font-black tracking-tight text-ink">
            {participant.full_name}
          </p>
          <p className="truncate text-sm text-muted">{participant.email}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {participant.house && <StatusBadge tone="info">{participant.house}</StatusBadge>}
            <StatusBadge tone="neutral">{participant.id}</StatusBadge>
          </div>
        </div>
      </div>

      <Group title="Personal">
        <Row label="Date of Birth" value={participant.dob} />
        <Row label="Gender" value={participant.gender} />
        <Row label="Phone" value={participant.phone} />
      </Group>

      <Group title="Location">
        <Row
          label="City"
          value={[participant.city, participant.state].filter(Boolean).join(', ')}
        />
        <Row label="Country" value={participant.country} />
        <Row label="Address" value={participant.address} />
      </Group>

      <Group title="Academic">
        <Row label="Program" value={participant.program} />
        <Row label="Course Stage" value={participant.course_stage} />
      </Group>
    </FestivalScreen>
  );
}

/**
 * One titled panel of profile rows.
 *
 * `SectionHeading` alone, with no leading icon: that is how every admin panel
 * titles itself, and the heading already carries an accent bar of its own.
 */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-black/[0.03]">
      <SectionHeading title={title} />
      <dl>{children}</dl>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-2 last:border-b-0 last:pb-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-right text-sm font-medium text-ink">{value || '—'}</dd>
    </div>
  );
}
