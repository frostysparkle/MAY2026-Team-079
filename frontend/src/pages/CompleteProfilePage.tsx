import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { api, ApiClientError } from '@/api';
import type { CompleteProfileRequest, Gender, Program, CourseStage } from '@/api/types';
import { ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';
import { postLoginRoute } from '@/features/auth/postLoginRoute';
import { Button, ResultBanner, Select, TextInput } from '@/components/ui';
import { PhotoUpload } from '@/features/profile/PhotoUpload';
import { LocationSelect, type LocationValue } from '@/features/profile/LocationSelect';

const GENDERS: { value: Gender; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];
const PROGRAMS: { value: Program; label: string }[] = [
  { value: 'standalone_degree', label: 'Standalone Degree' },
  { value: 'dual_degree', label: 'Dual Degree' },
  { value: 'working_professional', label: 'Working Professional' },
];
const COURSE_STAGES: { value: CourseStage; label: string }[] = [
  { value: 'foundational', label: 'Foundational' },
  { value: 'diploma', label: 'Diploma' },
  { value: 'degree', label: 'Degree' },
  { value: 'other', label: 'Other' },
];

type FormValues = {
  fullName: string;
  age: number;
  gender: Gender;
  phone: string;
  program: Program;
  courseStage: CourseStage;
  courseStageOther?: string;
};

/**
 * Complete Your Profile — a single full page (per the locked decision). Personal,
 * location (cascading), photo, and academic details. Location and photo are
 * custom-controlled and validated separately from react-hook-form's fields.
 */
export default function CompleteProfilePage() {
  const navigate = useNavigate();
  const participant = useAuthStore((s) => s.participant);
  const updateParticipant = useAuthStore((s) => s.updateParticipant);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>();

  const [location, setLocation] = useState<LocationValue>({ country: '', state: '', city: '' });
  const [photo, setPhoto] = useState<string | null>(null);
  const [customErrors, setCustomErrors] = useState<{
    location?: Partial<Record<keyof LocationValue, string>>;
    photo?: string;
  }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Session is required to complete a profile.
  if (!participant) {
    navigate(ROUTES.splash, { replace: true });
    return null;
  }

  const courseStage = watch('courseStage');

  function validateCustom(): boolean {
    const locErrors: Partial<Record<keyof LocationValue, string>> = {};
    if (!location.country) locErrors.country = 'Country is required.';
    if (!location.state) locErrors.state = 'State is required.';
    if (!location.city) locErrors.city = 'City is required.';
    const photoError = photo ? undefined : 'A profile photo is required.';
    setCustomErrors({
      location: Object.keys(locErrors).length ? locErrors : undefined,
      photo: photoError,
    });
    return Object.keys(locErrors).length === 0 && !photoError;
  }

  async function onSubmit(values: FormValues) {
    setSubmitError(null);
    if (!validateCustom()) return;

    const payload: CompleteProfileRequest = {
      fullName: values.fullName.trim(),
      age: values.age,
      gender: values.gender,
      phone: values.phone.trim(),
      country: location.country,
      state: location.state,
      city: location.city,
      program: values.program,
      courseStage: values.courseStage,
      courseStageOther:
        values.courseStage === 'other' ? values.courseStageOther?.trim() : undefined,
      photoDataUrl: photo!,
    };

    try {
      const { participant: updated } = await api.completeProfile(payload);
      updateParticipant(updated);
      navigate(postLoginRoute(updated), { replace: true });
    } catch (e) {
      setSubmitError(
        e instanceof ApiClientError ? e.message : 'Could not save your profile. Please try again.',
      );
    }
  }

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Complete Your Profile</h1>
        <p className="mt-1 text-sm text-muted">
          You only need to do this once — it is reused across every module.
        </p>
      </div>

      {submitError && (
        <ResultBanner variant="error" title="Could not save">
          {submitError}
        </ResultBanner>
      )}

      {/* Also validate custom fields (location/photo) on the invalid path, so
          those errors surface even when react-hook-form's own fields fail. */}
      <form
        className="flex flex-col gap-5"
        onSubmit={handleSubmit(onSubmit, () => validateCustom())}
        noValidate
      >
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-1 text-sm font-semibold text-gray-800">Personal</legend>
          <TextInput
            label="Full Name"
            required
            error={errors.fullName?.message}
            {...register('fullName', { required: 'Full name is required.' })}
          />
          <TextInput
            label="Age"
            type="number"
            required
            error={errors.age?.message}
            {...register('age', {
              required: 'Age is required.',
              valueAsNumber: true,
              min: { value: 15, message: 'Age must be at least 15.' },
              max: { value: 100, message: 'Please enter a valid age.' },
            })}
          />
          <Select
            label="Gender"
            required
            placeholder="Select gender"
            options={GENDERS}
            error={errors.gender?.message}
            {...register('gender', { required: 'Gender is required.' })}
          />
          <TextInput
            label="Phone Number"
            type="tel"
            required
            error={errors.phone?.message}
            {...register('phone', {
              required: 'Phone number is required.',
              pattern: { value: /^\d{10}$/, message: 'Enter a 10-digit phone number.' },
            })}
          />
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-1 text-sm font-semibold text-gray-800">Location</legend>
          <LocationSelect onChange={setLocation} errors={customErrors.location} />
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-1 text-sm font-semibold text-gray-800">Photo</legend>
          <PhotoUpload value={photo} onChange={setPhoto} error={customErrors.photo} />
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-1 text-sm font-semibold text-gray-800">Academic</legend>
          <Select
            label="Program"
            required
            placeholder="Select program"
            options={PROGRAMS}
            error={errors.program?.message}
            {...register('program', { required: 'Program is required.' })}
          />
          <Select
            label="Course Stage"
            required
            placeholder="Select course stage"
            options={COURSE_STAGES}
            error={errors.courseStage?.message}
            {...register('courseStage', { required: 'Course stage is required.' })}
          />
          {courseStage === 'other' && (
            <TextInput
              label="Please specify"
              required
              error={errors.courseStageOther?.message}
              {...register('courseStageOther', {
                required: 'Please specify your course stage.',
              })}
            />
          )}
        </fieldset>

        <Button type="submit" fullWidth loading={isSubmitting}>
          Save and continue
        </Button>
      </form>
    </main>
  );
}
