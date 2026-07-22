import { Link } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';
import { ROLE_LABELS } from '@/config/constants';
import { Card, EmptyState, Button, Avatar } from '@/components/ui';

const GENDER_LABELS: Record<string, string> = {
  male: 'Male',
  female: 'Female',
  other: 'Other',
  prefer_not_to_say: 'Prefer not to say',
};
const PROGRAM_LABELS: Record<string, string> = {
  standalone_degree: 'Standalone Degree',
  dual_degree: 'Dual Degree',
  working_professional: 'Working Professional',
};
const STAGE_LABELS: Record<string, string> = {
  foundational: 'Foundational',
  diploma: 'Diploma',
  degree: 'Degree',
  other: 'Other',
};

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-2 last:border-b-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-right text-sm font-medium text-gray-800">{value || '—'}</dd>
    </div>
  );
}

/** Read-only view of the participant's single profile. */
export default function ProfilePage() {
  const participant = useAuthStore((s) => s.participant);

  if (!participant) {
    return <EmptyState title="Not signed in" description="Please sign in to view your profile." />;
  }

  if (!participant.profileComplete) {
    return (
      <EmptyState
        title="Profile incomplete"
        description="Complete your profile to use every module."
        icon="📝"
        action={
          <Link to={ROUTES.completeProfile}>
            <Button>Complete Your Profile</Button>
          </Link>
        }
      />
    );
  }

  const stage =
    participant.courseStage === 'other'
      ? participant.courseStageOther || 'Other'
      : participant.courseStage
        ? STAGE_LABELS[participant.courseStage]
        : null;

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Gradient cover with the avatar overlapping. */}
      <div className="relative">
        <div className="h-24 rounded-3xl bg-gradient-to-br from-brand to-accent shadow-card" />
        <div className="-mt-10 flex flex-col items-center px-4 text-center">
          <Avatar src={participant.photoUrl} name={participant.fullName} size={84} />
          <h1 className="mt-2 truncate text-lg font-black tracking-tight text-ink">
            {participant.fullName}
          </h1>
          <p className="truncate text-sm text-muted">{participant.email}</p>
          <span className="mt-2 inline-block rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand">
            {ROLE_LABELS[participant.role]}
          </span>
        </div>
      </div>

      <Card>
        <dl>
          <Row label="Age" value={participant.age ? String(participant.age) : null} />
          <Row
            label="Gender"
            value={participant.gender ? GENDER_LABELS[participant.gender] : null}
          />
          <Row label="Phone" value={participant.phone} />
          <Row
            label="Location"
            value={[participant.city, participant.state, participant.country]
              .filter(Boolean)
              .join(', ')}
          />
          <Row
            label="Program"
            value={participant.program ? PROGRAM_LABELS[participant.program] : null}
          />
          <Row label="Course Stage" value={stage} />
        </dl>
      </Card>
    </div>
  );
}
