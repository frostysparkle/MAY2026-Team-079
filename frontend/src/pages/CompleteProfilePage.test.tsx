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
  house: 'Wayanad House',
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
    expect(screen.getByLabelText(/Phone Number/i)).toHaveValue('9876543210');
    expect(screen.getByLabelText(/Address/i)).toHaveValue('12 Marine Drive');
    expect(screen.getByLabelText(/Country/i)).toHaveDisplayValue('India');
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

  it('no longer collects an emergency contact', () => {
    render(
      <MemoryRouter>
        <CompleteProfilePage />
      </MemoryRouter>,
    );

    expect(screen.queryByText(/Emergency Contact/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Contact Name/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Relation/i)).not.toBeInTheDocument();
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
