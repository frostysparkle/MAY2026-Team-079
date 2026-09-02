import { useState } from 'react';
import { useForm, useWatch, type Control } from 'react-hook-form';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  Camera,
  CircleCheck,
  CircleDashed,
  FileEdit,
  GraduationCap,
  LifeBuoy,
  type LucideIcon,
  MapPin,
  User,
} from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { EmergencyContact, ProfileCompleteRequest } from '@/api/types';
import { ROUTES } from '@/config/routes';
import { GENDER_OPTIONS, PROGRAMS, COURSE_STAGES } from '@/config/constants';
import { HOUSE_OPTIONS, bareHouse } from '@/config/houses';
import { useAuthStore, currentParticipant } from '@/stores/authStore';
import { postLoginRoute } from '@/features/auth/postLoginRoute';
import { AuthLayout } from '@/features/auth/AuthLayout';
import {
  Avatar,
  Button,
  FieldErrors,
  IconTile,
  ProgressRing,
  ResultBanner,
  Select,
  StatusBadge,
  TextInput,
} from '@/components/ui';
import type { FieldError } from '@/api/errors';
import { PhotoUpload } from '@/features/profile/PhotoUpload';
import { LocationSelect, type LocationValue } from '@/features/profile/LocationSelect';
import { cn } from '@/lib/cn';

const PROGRAM_OPTIONS = PROGRAMS.map((p) => ({ value: p, label: p }));
const COURSE_STAGE_OPTIONS = COURSE_STAGES.map((s) => ({
  value: s,
  label: s[0].toUpperCase() + s.slice(1),
}));

/**
 * The relations `EmergencyContact.relation` is documented to take.
 *
 * A fixed list rather than free text because the backend names these four in
 * `models.py`, and a typed relation is what lets Help & Contacts print "Father"
 * rather than whatever was typed.
 */
const RELATION_OPTIONS = [
  { value: 'father', label: 'Father' },
  { value: 'mother', label: 'Mother' },
  { value: 'elder_sibling', label: 'Elder sibling' },
  { value: 'guardian', label: 'Guardian' },
];

/**
 * The one panel surface this screen uses — the same `rounded-3xl` card as the
 * sign-in and password screens. Declared once so every card on the page (form
 * section and side rail alike) shares an identical radius, padding, shadow and
 * hairline, instead of each block re-typing its own near-miss variant.
 */
const PANEL = 'rounded-3xl bg-surface p-5 shadow-lift ring-1 ring-black/[0.04] sm:p-6';

/** Uppercase micro-label used above a sub-block inside a panel. */
const MICRO_LABEL = 'text-[11px] font-semibold uppercase tracking-[0.14em] text-muted';

type FormValues = {
  full_name: string;
  dob: string;
  house: string;
  gender: string;
  phone: string;
  address: string;
  program: string;
  course_stage: string;
  /**
   * Next-of-kin. Optional on the backend and optional here — but collected,
   * which it was not.
   *
   * Nothing in the app used to write these, so `profile.emergency_contact` could
   * only ever be set by a seeder, and Help & Contacts' "your emergency contact"
   * card was permanently empty while telling the participant to add it on a
   * screen that could not. This is that screen.
   */
  emergency_name: string;
  emergency_relation: string;
  emergency_phone: string;
};

/**
 * The inputs on this form, as the names the backend uses for them.
 *
 * Used to route a 422's field errors: a rejection naming one of these is marked
 * on its own input, and anything else (`emergency_contact.phone`, or a field this
 * form does not collect) is listed under the banner instead of being silently
 * dropped.
 */
const FORM_FIELDS = [
  'full_name',
  'dob',
  'house',
  'gender',
  'phone',
  'address',
  'program',
  'course_stage',
] as const satisfies readonly (keyof FormValues)[];

function isFormField(field: string): field is (typeof FORM_FIELDS)[number] {
  return (FORM_FIELDS as readonly string[]).includes(field);
}

/**
 * The three emergency-contact inputs as the API's object, or `null` when none of
 * them was filled in.
 *
 * All three or nothing, because `EmergencyContact` types every field as a
 * required `str`: sending two of them is a 422, and sending three empty strings
 * stores a contact that cannot be rung. `null` therefore means "the participant
 * did not give one", which the caller turns into "leave the field alone".
 */
function emergencyContactFrom(values: FormValues): EmergencyContact | null {
  const name = values.emergency_name.trim();
  const relation = values.emergency_relation.trim();
  const phone = values.emergency_phone.trim();
  if (!name || !relation || !phone) return null;
  return { name, relation, phone };
}

/** Whether some but not all of the contact was given — the one invalid state. */
function partialEmergencyContact(values: FormValues): boolean {
  const parts = [values.emergency_name, values.emergency_relation, values.emergency_phone].map(
    (p) => p.trim(),
  );
  return parts.some(Boolean) && !parts.every(Boolean);
}

/** How far along the required half of the form is. */
interface Progress {
  filled: number;
  total: number;
  personal: boolean;
  location: boolean;
  academic: boolean;
  photo: boolean;
}

/**
 * Which groups are filled in, and how many of the twelve answers the profile
 * requires are given. Derived rather than tracked, so it can never disagree
 * with what is in the form.
 *
 * The photo counts as a required answer like any field: it is mandatory before
 * a profile can be completed, so the count, the checklist and the submit hint
 * all have to agree that it is outstanding.
 *
 * The meal preference is deliberately not among them. It is asked on the
 * Accommodation & Mess step instead, which is where a student decides whether
 * they are eating on campus at all — asking it here made everybody answer a
 * dietary question, including the majority who never take mess.
 */
function progressOf(
  values: Partial<FormValues>,
  location: LocationValue,
  photo: string | null,
): Progress {
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
    photo,
  ];
  return {
    filled: required.filter(Boolean).length,
    total: required.length,
    personal: Boolean(
      values.full_name && values.dob && values.house && values.gender && values.phone,
    ),
    location: Boolean(location.country && location.state && location.city && values.address),
    academic: Boolean(values.program && values.course_stage),
    photo: Boolean(photo),
  };
}

/**
 * The heading every panel on this screen wears: icon tile, uppercase tracked
 * title, an optional badge, and an optional line of guidance beneath.
 *
 * Shared by the form's `<fieldset>` sections and the rail's `<section>`s so a
 * panel title is one shape with one spacing rhythm, wherever it appears.
 * Everything is a `<span>` (`headingId` promotes the title to an `<h2>`), which
 * keeps it valid inside a `<legend>` as well as inside a section.
 */
function PanelTitle({
  icon: Icon,
  title,
  description,
  badge,
  headingId,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  badge?: React.ReactNode;
  /** Renders the title as an `<h2>` with this id, for `aria-labelledby`. */
  headingId?: string;
}) {
  const titleClass = 'text-sm font-black uppercase tracking-[0.12em] text-ink';
  // Phrasing-only elements when the title sits inside a <legend>, which cannot
  // hold a <div>; a real heading (and the divs around it) everywhere else.
  const Box = headingId ? 'div' : 'span';
  return (
    <Box className="flex flex-col gap-1.5">
      <Box className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <IconTile icon={Icon} size="sm" />
        {headingId ? (
          <h2 id={headingId} className={titleClass}>
            {title}
          </h2>
        ) : (
          <span className={titleClass}>{title}</span>
        )}
        {badge}
      </Box>
      {description && (
        <span className="block text-xs leading-relaxed text-muted">{description}</span>
      )}
    </Box>
  );
}

/**
 * One group of fields as a panel — a real `<fieldset>`/`<legend>` so the
 * grouping is announced to screen readers, not just drawn.
 *
 * Every section uses the same two-column grid on anything wider than a phone,
 * so a field's width is decided by how long its answer is (a name spans both
 * columns) rather than by how many fields the section happens to hold, and
 * fields line up column-for-column from one card to the next.
 */
function FormSection({
  icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  // `min-w-0` because a fieldset defaults to `min-inline-size: min-content`,
  // which long <select> option labels (the country list) would otherwise use to
  // push the card wider than its column.
  return (
    <fieldset className={cn('min-w-0', PANEL)}>
      {/* Floated so the browser stops rendering it as a straddling legend,
          which would sit on top of the panel's rounded edge instead of inside
          its padding. */}
      <legend className="float-left w-full">
        <PanelTitle icon={icon} title={title} description={description} />
      </legend>
      <div className="clear-both grid gap-4 pt-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

/** A field that takes the whole row of a section's two-column grid. */
function Wide({ children }: { children: React.ReactNode }) {
  // A wrapper rather than a col-span class on the field: `className` on the
  // field primitives styles the control itself, not the grid item.
  return <div className="sm:col-span-2">{children}</div>;
}

/** One line of the side rail's checklist. */
function ChecklistRow({ label, done }: { label: string; done: boolean }) {
  const Icon = done ? CircleCheck : CircleDashed;
  return (
    <li className="flex items-center gap-2.5 text-sm">
      <Icon
        aria-hidden
        size={16}
        strokeWidth={2.25}
        className={done ? 'shrink-0 text-success' : 'shrink-0 text-muted'}
      />
      <span className={done ? 'font-medium text-ink' : 'text-muted'}>{label}</span>
      <span className="sr-only">{done ? ' — complete' : ' — not filled in'}</span>
    </li>
  );
}

/**
 * The side rail: the mandatory photo (with the pass it will appear on), and a
 * live checklist of what is still outstanding.
 *
 * Its own component so that `useWatch` re-renders only the rail as fields are
 * typed, leaving the form's inputs untouched — and so the page never calls
 * `watch()`, which would opt the whole screen out of compiler memoization.
 *
 * It is first in the DOM, and placed into the second column only from `lg` up.
 * On a phone that puts the required photo at the top of the flow rather than
 * stranded below every field; the checklist, which is an at-a-glance aid rather
 * than a control, is desktop-only, because the sticky bar already carries the
 * same count where the rail is not shown.
 */
function ProfileRail({
  control,
  participantId,
  location,
  photo,
  photoError,
  onPhotoChange,
  className,
}: {
  control: Control<FormValues>;
  participantId: string;
  location: LocationValue;
  photo: string | null;
  photoError?: string;
  onPhotoChange: (dataUrl: string | null) => void;
  className?: string;
}) {
  const values = useWatch({ control });
  const progress = progressOf(values, location, photo);
  const complete = progress.filled === progress.total;

  const displayName = values.full_name?.trim() || 'Your name';
  const chips = [values.house, values.program, location.city].filter(Boolean) as string[];

  return (
    <aside className={cn('flex flex-col gap-5 lg:sticky lg:top-4 lg:self-start', className)}>
      <section aria-labelledby="photo-panel-title" className={cn('flex flex-col gap-4', PANEL)}>
        <PanelTitle
          icon={Camera}
          title="Profile Photo"
          headingId="photo-panel-title"
          badge={<StatusBadge tone="danger">Required</StatusBadge>}
        />

        <PhotoUpload value={photo} onChange={onPhotoChange} error={photoError} required />

        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <span className={MICRO_LABEL}>Pass preview</span>
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
        </div>
      </section>

      <section
        aria-labelledby="progress-panel-title"
        className={cn('hidden flex-col gap-4 lg:flex', PANEL)}
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
              id="progress-panel-title"
              className="text-sm font-black uppercase tracking-[0.12em] text-ink"
            >
              Progress
            </h2>
            <p className="text-xs text-muted">
              {progress.filled} of {progress.total} required answers
            </p>
          </div>
        </div>

        <ul className="flex flex-col gap-2.5 border-t border-line pt-4">
          <ChecklistRow label="Personal" done={progress.personal} />
          <ChecklistRow label="Location" done={progress.location} />
          <ChecklistRow label="Academic" done={progress.academic} />
          <ChecklistRow label="Profile photo" done={progress.photo} />
        </ul>
      </section>
    </aside>
  );
}

/**
 * Complete Your Profile — the last step of signing in, laid out as a stack of
 * field panels beside a live side rail on wide viewports and a single column on
 * a phone.
 *
 * Fields match ProfileCompleteRequest exactly; location and photo are
 * custom-controlled and validated separately from react-hook-form's fields. The
 * photo is required here, on the frontend: the backend accepts a profile
 * without one, but a pass with no photo is not usable at a checkpoint, so the
 * form will not submit until one is picked.
 *
 * Doubles as the edit screen, reached from Profile → Edit profile, and opens
 * already answered from the stored session in that case. That matters for more
 * than convenience: `PATCH /profile/complete` replaces the whole profile
 * document, so a blank form would submit a blank record over a complete one.
 * For the same reason the stored emergency contact and meal preference are
 * resubmitted untouched: this screen collects neither, and leaving them out of
 * the payload would erase answers already on file.
 *
 * The meal preference moved to the next step. The flow is Complete Profile →
 * Accommodation & Mess, and it is there — where a student says whether they want
 * a bed, meals, both, or nothing — that being asked what they eat makes sense.
 * Asking here put a dietary question in front of every student, including the
 * majority who never take mess, and it had to be answered before the profile
 * could be saved at all.
 *
 * The rail exists because the form's fields are capped at a readable measure,
 * which left a wide screen empty on both sides of a narrow column. It carries
 * the mandatory photo picker and the pass preview (the same gradient digital-ID
 * card the participant will carry at checkpoints, so the photo has a visible
 * purpose), plus a live checklist — rather than a taller stack of the same
 * fields.
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
    getValues,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      full_name: participant?.full_name ?? '',
      dob: participant?.dob ?? '',
      house: bareHouse(participant?.house ?? ''),
      gender: participant?.gender ?? '',
      phone: participant?.phone ?? '',
      address: participant?.address ?? '',
      program: participant?.program ?? '',
      course_stage: participant?.course_stage ?? '',
      emergency_name: participant?.emergency_contact?.name ?? '',
      emergency_relation: participant?.emergency_contact?.relation ?? '',
      emergency_phone: participant?.emergency_contact?.phone ?? '',
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
    photo?: string;
    emergency?: string;
  }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  /** Field-level problems from a 422, for the ones with no input on this form. */
  const [submitFieldErrors, setSubmitFieldErrors] = useState<FieldError[]>([]);

  // Session is required to complete a profile.
  if (!participant) {
    return <Navigate to={ROUTES.splash} replace />;
  }
  const session = participant;

  // Reached from Profile → Edit Profile once the profile exists; a first-time
  // participant has nothing to go back to, so the back control is hidden.
  const isEditing = session.full_name !== null;

  function choosePhoto(dataUrl: string | null) {
    setPhoto(dataUrl);
    // Clear the "photo required" message the moment one is picked, rather than
    // leaving it up until the next submit.
    if (dataUrl) setCustomErrors((prev) => ({ ...prev, photo: undefined }));
  }

  function validateCustom(formValues: FormValues): boolean {
    const locErrors: Partial<Record<keyof LocationValue, string>> = {};
    if (!location.country) locErrors.country = 'Country is required.';
    if (!location.state) locErrors.state = 'State is required.';
    if (!location.city) locErrors.city = 'City is required.';
    const photoError = photo ? undefined : 'A profile photo is required.';
    // The contact is optional, but a half-filled one is not: the API types all
    // three fields as required, so two of them is a 422 rather than a partial
    // save. Caught here so the message names what is missing.
    const emergencyError = partialEmergencyContact(formValues)
      ? 'Give the name, the relation and the phone number, or leave all three blank.'
      : undefined;
    setCustomErrors({
      location: Object.keys(locErrors).length ? locErrors : undefined,
      photo: photoError,
      emergency: emergencyError,
    });
    return Object.keys(locErrors).length === 0 && !photoError && !emergencyError;
  }

  async function onSubmit(formValues: FormValues) {
    setSubmitError(null);
    if (!validateCustom(formValues)) return;

    const payload: ProfileCompleteRequest = {
      full_name: formValues.full_name.trim(),
      dob: formValues.dob,
      house: bareHouse(formValues.house),
      gender: formValues.gender,
      phone: formValues.phone.trim(),
      // Carried through untouched, like the emergency contact below: this screen
      // no longer asks for a meal preference, and `PATCH /profile/complete`
      // replaces the profile wholesale, so leaving it out of the payload would
      // overwrite a choice already made on the Accommodation & Mess step.
      mess_preference: session.mess_preference,
      country: location.country,
      state: location.state,
      city: location.city,
      address: formValues.address.trim(),
      // Collected here now, rather than carried through from the session
      // untouched. Sent only when there is something to send: the backend
      // replaces the profile wholesale, so an all-blank contact would write an
      // empty record over a real one. `undefined` at least leaves the field
      // alone as far as this client is concerned.
      emergency_contact: emergencyContactFrom(formValues) ?? session.emergency_contact ?? undefined,
      program: formValues.program,
      course_stage: formValues.course_stage,
      photo: photo ?? undefined,
    };

    try {
      const updated = await api.completeProfile(payload);
      updateParticipantProfile(updated);
      // A first-time completion continues the sign-up: the next thing a student
      // has to decide is whether they need a bed and meals, and rooms are
      // finite, so that question is asked once, here, rather than left to be
      // discovered on a dashboard panel. Editing an existing profile is not
      // sign-up and goes back where it came from.
      navigate(isEditing ? postLoginRoute({ ...session, ...updated }) : ROUTES.accommodation, {
        replace: true,
      });
    } catch (e) {
      setSubmitError(
        e instanceof ApiClientError ? e.message : 'Could not save your profile. Please try again.',
      );
      // A 422 names the fields it rejected. Attach each one to its own input
      // where the name matches this form's, so the reader is taken to the box to
      // fix rather than left to work it out from a sentence at the top. Anything
      // that does not map to a field on screen (a nested `emergency_contact.*`,
      // say) stays in the list below the banner.
      setSubmitFieldErrors(e instanceof ApiClientError ? e.fieldErrors : []);
      if (e instanceof ApiClientError) {
        for (const fieldError of e.fieldErrors) {
          if (isFormField(fieldError.field)) {
            setError(fieldError.field, { type: 'server', message: fieldError.message });
          }
        }
      }
    }
  }

  return (
    <AuthLayout
      size="xl"
      align="top"
      backTo={isEditing ? ROUTES.profile : undefined}
      mark={<IconTile icon={FileEdit} size="lg" />}
      markInline
      title={isEditing ? 'Edit Your Profile' : 'Complete Your Profile'}
    >
      {submitError && (
        <ResultBanner variant="error" title="Could not save">
          <div className="flex flex-col gap-2">
            <p>{submitError}</p>
            {/* Only the rejections with no box on this form; the rest are marked
                on their own inputs by `setError` above. */}
            <FieldErrors errors={submitFieldErrors.filter((e) => !isFormField(e.field))} />
          </div>
        </ResultBanner>
      )}

      <form
        className="flex flex-col gap-5"
        // The invalid branch runs the custom checks too, so a submit blocked by a
        // required field still surfaces a missing photo or a half-filled contact
        // rather than reporting them one round-trip later.
        onSubmit={handleSubmit(onSubmit, () => validateCustom(getValues()))}
        noValidate
      >
        {/* The fields keep a readable measure; the rail uses the space that
            leaves on a wide screen. Both collapse to one column on a phone,
            where the rail's photo panel leads instead of trailing. */}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6">
          <ProfileRail
            className="lg:col-start-2 lg:row-start-1"
            control={control}
            participantId={session.id}
            location={location}
            photo={photo}
            photoError={customErrors.photo}
            onPhotoChange={choosePhoto}
          />

          <div className="flex flex-col gap-5 lg:col-start-1 lg:row-start-1">
            <FormSection icon={User} title="Personal">
              <Wide>
                <TextInput
                  label="Full Name"
                  required
                  autoComplete="name"
                  placeholder="e.g. Ananya Raghavan"
                  error={errors.full_name?.message}
                  {...register('full_name', { required: 'Full name is required.' })}
                />
              </Wide>
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

            <FormSection icon={GraduationCap} title="Academic">
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
            </FormSection>

            {/* Optional, and the only section that is — so it sits last, after
                everything the profile cannot be saved without. */}
            <FormSection icon={LifeBuoy} title="Emergency contact">
              <div className="sm:col-span-2">
                <p className="text-xs text-muted">
                  Who the fest should call about you. Optional, and shown only to you — on Help
                  &amp; Contacts, beside the fest&rsquo;s own duty numbers.
                </p>
              </div>
              <TextInput
                label="Name"
                autoComplete="off"
                placeholder="e.g. Ramesh Rao"
                error={errors.emergency_name?.message}
                {...register('emergency_name')}
              />
              <Select
                label="Relation"
                placeholder="Select relation"
                options={RELATION_OPTIONS}
                error={errors.emergency_relation?.message}
                {...register('emergency_relation')}
              />
              <TextInput
                label="Phone"
                type="tel"
                autoComplete="off"
                placeholder="e.g. 9876500001"
                error={customErrors.emergency}
                {...register('emergency_phone')}
              />
              {isEditing && !session.emergency_contact && (
                <div className="sm:col-span-2">
                  <p className="text-xs text-warning">
                    No contact is on file for this session. If one was recorded earlier it is not
                    readable back by any endpoint, so it cannot be shown here — filling this in
                    replaces whatever is stored.
                  </p>
                </div>
              )}
            </FormSection>
          </div>
        </div>

        {/* Sticky action bar — the same Save-then-Cancel pairing the admin
            editors use, so a long form never hides its primary action below the
            fold. */}
        <div className="safe-bottom sticky bottom-0 z-10 border-t border-line bg-canvas/95 py-4 backdrop-blur">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
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
          </div>
        </div>
      </form>
    </AuthLayout>
  );
}
