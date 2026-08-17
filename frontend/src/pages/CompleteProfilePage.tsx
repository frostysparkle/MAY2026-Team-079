import { useState } from 'react';
import { useForm, useWatch, type Control } from 'react-hook-form';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  CircleCheck,
  CircleDashed,
  FileEdit,
  GraduationCap,
  IdCard,
  type LucideIcon,
  MapPin,
  Siren,
  User,
} from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { ProfileCompleteRequest } from '@/api/types';
import { ROUTES } from '@/config/routes';
import { GENDER_OPTIONS, MESS_PREFERENCES, PROGRAMS, COURSE_STAGES } from '@/config/constants';
import { HOUSES } from '@/config/houses';
import { useAuthStore, currentParticipant } from '@/stores/authStore';
import { postLoginRoute } from '@/features/auth/postLoginRoute';
import { AuthLayout } from '@/features/auth/AuthLayout';
import {
  Avatar,
  Button,
  IconTile,
  ProgressRing,
  ResultBanner,
  Select,
  StatusBadge,
  TextInput,
} from '@/components/ui';
import { PhotoUpload } from '@/features/profile/PhotoUpload';
import { LocationSelect, type LocationValue } from '@/features/profile/LocationSelect';

const HOUSE_OPTIONS = HOUSES.map((h) => ({ value: h, label: h }));
const MESS_PREF_OPTIONS = MESS_PREFERENCES.map((p) => ({
  value: p,
  label: p === 'non_veg' ? 'Non-veg' : p[0].toUpperCase() + p.slice(1),
}));
const PROGRAM_OPTIONS = PROGRAMS.map((p) => ({ value: p, label: p }));
const COURSE_STAGE_OPTIONS = COURSE_STAGES.map((s) => ({
  value: s,
  label: s[0].toUpperCase() + s.slice(1),
}));

type FormValues = {
  full_name: string;
  dob: string;
  house: string;
  gender: string;
  phone: string;
  mess_preference: string;
  address: string;
  program: string;
  course_stage: string;
  emergency_contact_name?: string;
  emergency_contact_relation?: string;
  emergency_contact_phone?: string;
};

/** How far along the required half of the form is. */
interface Progress {
  filled: number;
  total: number;
  personal: boolean;
  location: boolean;
  academic: boolean;
  emergency: boolean;
}

/**
 * Which groups are filled in, and how many of the twelve fields the backend
 * requires are answered. Derived rather than tracked, so it can never disagree
 * with what is in the form.
 */
function progressOf(values: Partial<FormValues>, location: LocationValue): Progress {
  const required = [
    values.full_name,
    values.dob,
    values.house,
    values.gender,
    values.phone,
    location.country,
    location.state,
    location.city,
    values.address,
    values.program,
    values.course_stage,
    values.mess_preference,
  ];
  return {
    filled: required.filter(Boolean).length,
    total: required.length,
    personal: Boolean(
      values.full_name && values.dob && values.house && values.gender && values.phone,
    ),
    location: Boolean(location.country && location.state && location.city && values.address),
    academic: Boolean(values.program && values.course_stage && values.mess_preference),
    emergency: Boolean(values.emergency_contact_name && values.emergency_contact_phone),
  };
}

/**
 * One group of fields as a themed surface card — the same
 * `rounded-3xl` / `shadow-lift` panel the sign-in and password screens use,
 * with the icon-tile + uppercase-tracked heading that titles sections
 * elsewhere in the app. A real <fieldset>/<legend> so the grouping is
 * announced to screen readers, not just drawn.
 *
 * The fields sit in a two-column grid on anything wider than a phone, and
 * every section uses that same grid, so a field's width is decided by how long
 * its answer is (a name or an address spans both columns) rather than by how
 * many fields the section happens to hold.
 */
function FormSection({
  icon: Icon,
  title,
  optional = false,
  children,
}: {
  icon: LucideIcon;
  title: string;
  /** Renders an "Optional" pill beside the title. */
  optional?: boolean;
  children: React.ReactNode;
}) {
  // `min-w-0` because a fieldset defaults to `min-inline-size: min-content`,
  // which long <select> option labels (the country list) would otherwise use to
  // push the card wider than its column.
  return (
    <fieldset className="min-w-0 rounded-3xl bg-surface p-4 shadow-lift ring-1 ring-black/[0.04] sm:p-5">
      <legend className="flex items-center gap-2.5">
        <IconTile icon={Icon} size="sm" />
        <span className="text-sm font-black uppercase tracking-[0.12em] text-ink">{title}</span>
        {optional && <StatusBadge tone="neutral">Optional</StatusBadge>}
      </legend>
      <div className="mt-3.5 grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

/** One line of the side rail's checklist. */
function ChecklistRow({
  label,
  done,
  optional,
}: {
  label: string;
  done: boolean;
  optional?: boolean;
}) {
  const Icon = done ? CircleCheck : CircleDashed;
  return (
    <li className="flex items-center gap-2 text-sm">
      <Icon
        aria-hidden
        size={16}
        strokeWidth={2.25}
        className={done ? 'shrink-0 text-success' : 'shrink-0 text-muted'}
      />
      <span className={done ? 'font-medium text-ink' : 'text-muted'}>{label}</span>
      {optional && !done && (
        <span className="ml-auto text-[11px] font-medium uppercase tracking-wide text-muted">
          Optional
        </span>
      )}
      <span className="sr-only">{done ? ' — complete' : ' — not filled in'}</span>
    </li>
  );
}

/**
 * The side rail: pass preview, photo picker, and a live checklist.
 *
 * Its own component so that `useWatch` re-renders only the rail as fields are
 * typed, leaving the form's inputs untouched — and so the page never calls
 * `watch()`, which would opt the whole screen out of compiler memoization.
 */
function ProfileRail({
  control,
  participantId,
  location,
  photo,
  onPhotoChange,
}: {
  control: Control<FormValues>;
  participantId: string;
  location: LocationValue;
  photo: string | null;
  onPhotoChange: (dataUrl: string | null) => void;
}) {
  const values = useWatch({ control });
  const progress = progressOf(values, location);
  const complete = progress.filled === progress.total;

  const displayName = values.full_name?.trim() || 'Your name';
  const chips = [values.house, values.program, location.city].filter(Boolean) as string[];

  return (
    <aside className="flex flex-col gap-5 lg:sticky lg:top-4 lg:self-start">
      <section
        aria-labelledby="pass-preview-title"
        className="flex flex-col gap-4 rounded-3xl bg-surface p-4 shadow-lift ring-1 ring-black/[0.04] sm:p-5"
      >
        <div className="flex items-center gap-2.5">
          <IconTile icon={IdCard} size="sm" />
          <h2
            id="pass-preview-title"
            className="text-sm font-black uppercase tracking-[0.12em] text-ink"
          >
            Your Pass
          </h2>
        </div>

        {/* The same gradient digital-ID card as My QR, so what the photo and
            name are for is visible while they are being entered. */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand to-accent p-4 shadow-lift">
          <div
            aria-hidden
            className="absolute -right-10 -top-12 h-32 w-32 rounded-full bg-white/20 blur-2xl"
          />
          <div className="relative flex items-center gap-3 rounded-2xl bg-white/15 px-3 py-2.5 backdrop-blur-sm">
            <Avatar src={photo} name={displayName} size={40} />
            <div className="min-w-0 text-left text-white">
              <p className="truncate text-sm font-semibold">{displayName}</p>
              <p className="truncate text-xs opacity-80">ID: {participantId}</p>
            </div>
          </div>
          {chips.length > 0 && (
            <div className="relative mt-3 flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <span
                  key={chip}
                  className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-semibold text-white backdrop-blur-sm"
                >
                  {chip}
                </span>
              ))}
            </div>
          )}
        </div>

        <PhotoUpload value={photo} onChange={onPhotoChange} />
      </section>

      <section
        aria-labelledby="progress-title"
        className="flex flex-col gap-3 rounded-3xl bg-surface p-4 shadow-lift ring-1 ring-black/[0.04] sm:p-5"
      >
        <div className="flex items-center gap-3">
          <ProgressRing
            value={progress.filled}
            max={progress.total}
            label="Required fields completed"
            size={48}
            thickness={5}
            tone={complete ? 'success' : 'brand'}
          />
          <div className="min-w-0">
            <h2
              id="progress-title"
              className="text-sm font-black uppercase tracking-[0.12em] text-ink"
            >
              Progress
            </h2>
            <p className="text-xs text-muted">
              {progress.filled} of {progress.total} required fields
            </p>
          </div>
        </div>

        <ul className="flex flex-col gap-2 border-t border-line pt-3">
          <ChecklistRow label="Personal" done={progress.personal} />
          <ChecklistRow label="Location" done={progress.location} />
          <ChecklistRow label="Academic & Mess" done={progress.academic} />
          <ChecklistRow label="Emergency Contact" done={progress.emergency} optional />
          <ChecklistRow label="Photo" done={Boolean(photo)} optional />
        </ul>
      </section>
    </aside>
  );
}

/** Live count beside the submit button, in the sticky action bar. */
function RequiredFieldsHint({
  control,
  location,
}: {
  control: Control<FormValues>;
  location: LocationValue;
}) {
  const values = useWatch({ control });
  const { filled, total } = progressOf(values, location);
  const left = total - filled;

  return (
    <p className="text-xs text-muted">
      {left === 0
        ? 'All required fields are filled in.'
        : `${left} required field${left === 1 ? '' : 's'} left.`}
    </p>
  );
}

/**
 * Complete Your Profile — the last step of signing in, laid out as a form
 * beside a live side rail on wide viewports and a single column on a phone.
 *
 * Fields match ProfileCompleteRequest exactly; location and photo are
 * custom-controlled and validated separately from react-hook-form's fields.
 *
 * Doubles as the edit screen, reached from Profile → Edit profile, and opens
 * already answered from the stored session in that case. That matters for more
 * than convenience: `PATCH /profile/complete` replaces the whole profile
 * document, so a blank form would submit a blank record over a complete one.
 * `mess_preference` and the emergency contact are the exception — `/auth/login`
 * does not return them, so they can only be prefilled within the session that
 * saved them, and the checklist shows when they still need an answer.
 *
 * The rail exists because the form's fields are capped at a readable measure,
 * which left a wide screen empty on both sides of a narrow column. It carries
 * the pass preview (the same gradient digital-ID card the participant will
 * carry at checkpoints, so the photo has a visible purpose), the photo picker,
 * and a live checklist — rather than a taller stack of the same fields.
 *
 * Rendered in the shared AuthLayout shell: this route sits outside the app's
 * nav shell, so it wears the same festival-sky backdrop, wordmark and surface
 * cards as the sign-in, register and password screens.
 */
export default function CompleteProfilePage() {
  const navigate = useNavigate();
  const updateParticipantProfile = useAuthStore((s) => s.updateParticipantProfile);
  const participant = currentParticipant();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      full_name: participant?.full_name ?? '',
      dob: participant?.dob ?? '',
      house: participant?.house ?? '',
      gender: participant?.gender ?? '',
      phone: participant?.phone ?? '',
      mess_preference: participant?.mess_preference ?? '',
      address: participant?.address ?? '',
      program: participant?.program ?? '',
      course_stage: participant?.course_stage ?? '',
      emergency_contact_name: participant?.emergency_contact?.name ?? '',
      emergency_contact_relation: participant?.emergency_contact?.relation ?? '',
      emergency_contact_phone: participant?.emergency_contact?.phone ?? '',
    },
  });

  const [location, setLocation] = useState<LocationValue>({
    country: participant?.country ?? '',
    state: participant?.state ?? '',
    city: participant?.city ?? '',
  });
  const [photo, setPhoto] = useState<string | null>(participant?.photo ?? null);
  const [customErrors, setCustomErrors] = useState<{
    location?: Partial<Record<keyof LocationValue, string>>;
  }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Session is required to complete a profile.
  if (!participant) {
    return <Navigate to={ROUTES.splash} replace />;
  }
  const session = participant;

  // Reached from Profile → Edit Profile once the profile exists; a first-time
  // participant has nothing to go back to, so the back control is hidden.
  const isEditing = session.full_name !== null;

  function validateCustom(): boolean {
    const locErrors: Partial<Record<keyof LocationValue, string>> = {};
    if (!location.country) locErrors.country = 'Country is required.';
    if (!location.state) locErrors.state = 'State is required.';
    if (!location.city) locErrors.city = 'City is required.';
    setCustomErrors({ location: Object.keys(locErrors).length ? locErrors : undefined });
    return Object.keys(locErrors).length === 0;
  }

  async function onSubmit(formValues: FormValues) {
    setSubmitError(null);
    if (!validateCustom()) return;

    const emergency_contact =
      formValues.emergency_contact_name && formValues.emergency_contact_phone
        ? {
            name: formValues.emergency_contact_name.trim(),
            relation: formValues.emergency_contact_relation?.trim() ?? '',
            phone: formValues.emergency_contact_phone.trim(),
          }
        : undefined;

    const payload: ProfileCompleteRequest = {
      full_name: formValues.full_name.trim(),
      dob: formValues.dob,
      house: formValues.house,
      gender: formValues.gender,
      phone: formValues.phone.trim(),
      mess_preference: formValues.mess_preference,
      country: location.country,
      state: location.state,
      city: location.city,
      address: formValues.address.trim(),
      emergency_contact,
      program: formValues.program,
      course_stage: formValues.course_stage,
      photo: photo ?? undefined,
    };

    try {
      const updated = await api.completeProfile(payload);
      updateParticipantProfile(updated);
      navigate(postLoginRoute({ ...session, ...updated }), { replace: true });
    } catch (e) {
      setSubmitError(
        e instanceof ApiClientError ? e.message : 'Could not save your profile. Please try again.',
      );
    }
  }

  return (
    <AuthLayout
      size="xl"
      align="top"
      backTo={isEditing ? ROUTES.profile : undefined}
      mark={<IconTile icon={FileEdit} size="lg" />}
      title={isEditing ? 'Edit Your Profile' : 'Complete Your Profile'}
    >
      {submitError && (
        <ResultBanner variant="error" title="Could not save">
          {submitError}
        </ResultBanner>
      )}

      <form
        className="flex flex-col gap-5"
        onSubmit={handleSubmit(onSubmit, () => validateCustom())}
        noValidate
      >
        {/* The fields keep a readable measure; the rail uses the space that
            leaves on a wide screen. Both collapse to one column on a phone. */}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6">
          <div className="flex flex-col gap-5">
            <FormSection icon={User} title="Personal">
              {/* Wrapped rather than given a col-span class: `className` on the
                  field primitives styles the control itself, not the grid item. */}
              <div className="sm:col-span-2">
                <TextInput
                  label="Full Name"
                  required
                  autoComplete="name"
                  placeholder="e.g. Ananya Raghavan"
                  error={errors.full_name?.message}
                  {...register('full_name', { required: 'Full name is required.' })}
                />
              </div>
              <TextInput
                label="Date of Birth"
                type="date"
                required
                error={errors.dob?.message}
                {...register('dob', { required: 'Date of birth is required.' })}
              />
              <TextInput
                label="Phone Number"
                type="tel"
                required
                autoComplete="tel"
                placeholder="10 digits"
                error={errors.phone?.message}
                {...register('phone', {
                  required: 'Phone number is required.',
                  pattern: { value: /^\d{10}$/, message: 'Enter a 10-digit phone number.' },
                })}
              />
              <Select
                label="House"
                required
                placeholder="Select house"
                options={HOUSE_OPTIONS}
                error={errors.house?.message}
                {...register('house', { required: 'House is required.' })}
              />
              <Select
                label="Gender"
                required
                placeholder="Select gender"
                options={GENDER_OPTIONS}
                error={errors.gender?.message}
                {...register('gender', { required: 'Gender is required.' })}
              />
            </FormSection>

            <FormSection icon={MapPin} title="Location">
              <LocationSelect
                initial={{
                  country: session.country ?? '',
                  state: session.state ?? '',
                  city: session.city ?? '',
                }}
                onChange={setLocation}
                errors={customErrors.location}
              />
              <TextInput
                label="Address"
                required
                autoComplete="street-address"
                error={errors.address?.message}
                {...register('address', { required: 'Address is required.' })}
              />
            </FormSection>

            <FormSection icon={GraduationCap} title="Academic & Mess">
              <Select
                label="Program"
                required
                placeholder="Select program"
                options={PROGRAM_OPTIONS}
                error={errors.program?.message}
                {...register('program', { required: 'Program is required.' })}
              />
              <Select
                label="Course Stage"
                required
                placeholder="Select stage"
                options={COURSE_STAGE_OPTIONS}
                error={errors.course_stage?.message}
                {...register('course_stage', { required: 'Course stage is required.' })}
              />
              <Select
                label="Mess Preference"
                required
                placeholder="Select preference"
                options={MESS_PREF_OPTIONS}
                error={errors.mess_preference?.message}
                {...register('mess_preference', { required: 'Mess preference is required.' })}
              />
            </FormSection>

            <FormSection icon={Siren} title="Emergency Contact" optional>
              <div className="sm:col-span-2">
                <TextInput
                  label="Contact Name"
                  autoComplete="off"
                  placeholder="e.g. Meera Raghavan"
                  {...register('emergency_contact_name')}
                />
              </div>
              <TextInput
                label="Relation"
                autoComplete="off"
                placeholder="e.g. Parent"
                {...register('emergency_contact_relation')}
              />
              <TextInput
                label="Contact Phone"
                type="tel"
                autoComplete="off"
                placeholder="10 digits"
                error={errors.emergency_contact_phone?.message}
                {...register('emergency_contact_phone', {
                  // Same rule as the participant's own number, so one field is
                  // not stricter than the other about the same kind of answer.
                  pattern: { value: /^\d{10}$/, message: 'Enter a 10-digit phone number.' },
                })}
              />
            </FormSection>
          </div>

          <ProfileRail
            control={control}
            participantId={session.id}
            location={location}
            photo={photo}
            onPhotoChange={setPhoto}
          />
        </div>

        {/* Sticky action bar — the same one the admin editors use, so a long
            form never hides its primary action below the fold, and the same
            Save / Cancel pairing when there is an existing record to return to. */}
        <div className="safe-bottom sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t border-line bg-canvas/95 py-4 backdrop-blur">
          <Button type="submit" size="lg" loading={isSubmitting}>
            {isEditing ? 'Save changes' : 'Save and continue'}
          </Button>
          {isEditing && (
            <Button
              type="button"
              size="lg"
              variant="ghost"
              onClick={() => navigate(ROUTES.profile)}
            >
              Cancel
            </Button>
          )}
          <RequiredFieldsHint control={control} location={location} />
        </div>
      </form>
    </AuthLayout>
  );
}
