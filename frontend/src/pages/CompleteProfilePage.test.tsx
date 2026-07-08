import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import CompleteProfilePage from './CompleteProfilePage';
import { useAuthStore } from '@/stores/authStore';
import type { Participant } from '@/api/types';

const newUser: Participant = {
  id: 'p_new',
  email: 'new@ds.study.iitm.ac.in',
  fullName: '',
  role: 'participant',
  age: null,
  gender: null,
  phone: null,
  country: null,
  state: null,
  city: null,
  program: null,
  courseStage: null,
  courseStageOther: null,
  photoUrl: null,
  profileComplete: false,
  createdAt: '2026-07-08T00:00:00Z',
};

describe('CompleteProfilePage', () => {
  beforeEach(() => useAuthStore.getState().setSession('tok', newUser));

  it('blocks submission and shows validation errors when empty', async () => {
    render(
      <MemoryRouter>
        <CompleteProfilePage />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Save and continue/i }));

    expect(await screen.findByText('Full name is required.')).toBeInTheDocument();
    expect(screen.getByText('A profile photo is required.')).toBeInTheDocument();
    // Profile is not marked complete because the submit was blocked.
    expect(useAuthStore.getState().participant?.profileComplete).toBe(false);
  });
});
