import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import CompleteProfilePage from './CompleteProfilePage';
import { useAuthStore } from '@/stores/authStore';
import type { ParticipantLoginResponse } from '@/api/types';

const newUser: ParticipantLoginResponse = {
  id: 'DS23F1000099',
  email: 'new@ds.study.iitm.ac.in',
  access_token: 'tok',
  token_type: 'participant',
  full_name: null,
  dob: null,
  house: null,
  gender: null,
  phone: null,
  country: null,
  state: null,
  city: null,
  address: null,
  program: null,
  course_stage: null,
  photo: null,
  public_key: null,
};

/** The same participant with a profile already on file, as Edit reaches it. */
const returningUser: ParticipantLoginResponse = {
  ...newUser,
  full_name: 'Ananya Raghavan',
  dob: '2003-04-11',
  house: 'Wayanad',
  gender: 'female',
  phone: '9876543210',
  country: 'India',
  state: 'Kerala',
  city: 'Kochi',
  address: '12 Marine Drive',
  program: 'DS',
  course_stage: 'foundational',
};

describe('CompleteProfilePage', () => {
  beforeEach(() => useAuthStore.getState().setParticipantSession(newUser));

  it('defaults the phone country code to India', () => {
    render(
      <MemoryRouter>
        <CompleteProfilePage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('combobox', { name: /phone number country code/i })).toHaveValue('IN');
    expect(screen.getByRole('textbox', { name: /phone number/i })).toHaveAttribute(
      'maxLength',
      '10',
    );
  });

  it('blocks submission and shows validation errors when empty', async () => {
    render(
      <MemoryRouter>
        <CompleteProfilePage />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Save and continue/i }));

    expect(await screen.findByText('Full name is required.')).toBeInTheDocument();
    // Profile is not marked complete because the submit was blocked.
    expect(
      useAuthStore.getState().session?.token_type === 'participant' &&
        (useAuthStore.getState().session as ParticipantLoginResponse).full_name,
    ).toBeNull();
  });

  // PATCH /profile/complete replaces the whole profile document, so an edit that
  // opened blank would save a blank record over a complete one.
  it('opens already filled in when a profile exists', () => {
    useAuthStore.getState().setParticipantSession(returningUser);
    render(
      <MemoryRouter>
        <CompleteProfilePage />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText(/Full Name/i)).toHaveValue('Ananya Raghavan');
    expect(screen.getByRole('textbox', { name: /phone number/i })).toHaveValue('9876543210');
    expect(screen.getByRole('combobox', { name: /phone number country code/i })).toHaveValue('IN');
    expect(screen.getByLabelText(/Address/i)).toHaveValue('12 Marine Drive');
    expect(screen.getByRole('combobox', { name: /^Country/ })).toHaveDisplayValue('India');
    expect(screen.getByLabelText(/State/i)).toHaveDisplayValue('Kerala');
    expect(screen.getByLabelText(/City/i)).toHaveDisplayValue('Kochi');
    expect(screen.getByLabelText(/House/i)).toHaveDisplayValue('Wayanad House');
    expect(screen.getByLabelText(/Program/i)).toHaveDisplayValue('DS');
    expect(screen.getByLabelText(/Course Stage/i)).toHaveDisplayValue('Foundational');
  });

  // The pass is only usable at a checkpoint with a face on it, so the photo is
  // required here even though the backend accepts a profile without one.
  it('requires a profile photo before the form can be submitted', async () => {
    render(
      <MemoryRouter>
        <CompleteProfilePage />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Save and continue/i }));

    expect(await screen.findByText('A profile photo is required.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upload photo/i })).toBeInTheDocument();
  });

  /**
   * This screen is the only place `profile.emergency_contact` can be written.
   *
   * It used not to collect one at all, which made Help & Contacts' "your
   * emergency contact" card permanently empty while telling the participant to
   * add it here. These three assert the field exists, that it stays optional, and
   * that a half-filled contact is refused rather than sent as a 422.
   */
  it('collects an emergency contact, so the Help & Contacts card can be filled', () => {
    render(
      <MemoryRouter>
        <CompleteProfilePage />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Emergency contact/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Relation/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Phone$/i)).toBeInTheDocument();
  });

  it('opens the contact already filled in when the session carries one', () => {
    useAuthStore.getState().setParticipantSession({
      ...returningUser,
      emergency_contact: { name: 'Ramesh Rao', relation: 'father', phone: '9812345678' },
    });
    render(
      <MemoryRouter>
        <CompleteProfilePage />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText(/^Name/i)).toHaveValue('Ramesh Rao');
    expect(screen.getByLabelText(/Relation/i)).toHaveDisplayValue('Father');
    expect(screen.getByLabelText(/^Phone$/i)).toHaveValue('9812345678');
  });

  it('refuses a half-filled emergency contact rather than sending a 422', async () => {
    // `EmergencyContact` types all three fields as required, so two of them is
    // rejected by the API. Better to say which is missing than to relay a 422.
    render(
      <MemoryRouter>
        <CompleteProfilePage />
      </MemoryRouter>,
    );

    await userEvent.type(screen.getByLabelText(/^Name/i), 'Ramesh Rao');
    await userEvent.click(screen.getByRole('button', { name: /Save and continue/i }));

    expect(
      await screen.findByText(
        'Give the name, the relation and the phone number, or leave all three blank.',
      ),
    ).toBeInTheDocument();
  });

  it('frames itself as an edit, not a first-time setup, when a profile exists', () => {
    useAuthStore.getState().setParticipantSession(returningUser);
    render(
      <MemoryRouter>
        <CompleteProfilePage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /Edit Your Profile/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save changes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Cancel$/i })).toBeInTheDocument();
  });
});
