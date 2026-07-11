import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore, hasRoleAtLeast, isAuthenticated } from './authStore';
import type { Participant } from '@/api/types';

const admin: Participant = {
  id: 'p1',
  email: 'a@ds.study.iitm.ac.in',
  fullName: 'Admin',
  role: 'admin',
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
  profileComplete: true,
  createdAt: '2026-07-01T00:00:00Z',
};

describe('authStore', () => {
  beforeEach(() => useAuthStore.getState().clear());

  it('starts unauthenticated', () => {
    expect(isAuthenticated()).toBe(false);
  });

  it('stores a session and reports the role hierarchy correctly', () => {
    useAuthStore.getState().setSession('tok', admin);
    expect(isAuthenticated()).toBe(true);
    expect(hasRoleAtLeast('organizer')).toBe(true); // admin > organizer
    expect(hasRoleAtLeast('super_admin')).toBe(false); // admin < super_admin
  });

  it('clears the session', () => {
    useAuthStore.getState().setSession('tok', admin);
    useAuthStore.getState().clear();
    expect(isAuthenticated()).toBe(false);
  });
});
