import { describe, it, expect, beforeEach } from 'vitest';
import {
  useAuthStore,
  isAuthenticated,
  isParticipant,
  isStaff,
  isSuperAdmin,
  isUhc,
  uhcHouse,
  isProfileComplete,
} from './authStore';
import type { ParticipantLoginResponse, StaffLoginResponse } from '@/api/types';

const participant: ParticipantLoginResponse = {
  id: 'DS23F1000001',
  email: 'p@ds.study.iitm.ac.in',
  access_token: 'tok.participant',
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
  public_key: '-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----',
};

const superAdmin: StaffLoginResponse = {
  id: 'BT1',
  email: 'admin@example.com',
  access_token: 'tok.staff',
  token_type: 'staff',
  role: 'super_admin',
  department: 'technical',
  designation: 'Lead',
};

const uhcStaff: StaffLoginResponse = {
  id: 'BT2',
  email: 'wayanad-sec@ds.study.iitm.ac.in',
  access_token: 'tok.uhc',
  token_type: 'staff',
  role: 'staff',
  department: 'uhc',
  designation: 'Medic',
};

describe('authStore', () => {
  beforeEach(() => useAuthStore.getState().clear());

  it('starts unauthenticated', () => {
    expect(isAuthenticated()).toBe(false);
  });

  it('stores a participant session', () => {
    useAuthStore.getState().setParticipantSession(participant);
    expect(isAuthenticated()).toBe(true);
    expect(isParticipant()).toBe(true);
    expect(isStaff()).toBe(false);
    expect(isProfileComplete()).toBe(false);
  });

  it('stores a staff session and resolves super_admin / department', () => {
    useAuthStore.getState().setStaffSession(superAdmin);
    expect(isStaff()).toBe(true);
    expect(isSuperAdmin()).toBe(true);
    expect(isUhc()).toBe(false);
  });

  it('derives the UHC house from a hyphenated email', () => {
    useAuthStore.getState().setStaffSession(uhcStaff);
    expect(isUhc()).toBe(true);
    expect(uhcHouse()).toBe('wayanad');
  });

  it('returns null house for a UHC email with no hyphen (mirrors backend fragility)', () => {
    useAuthStore.getState().setStaffSession({ ...uhcStaff, email: 'medic@ds.study.iitm.ac.in' });
    expect(uhcHouse()).toBeNull();
  });

  it('marks profile complete once full_name is set', () => {
    useAuthStore.getState().setParticipantSession({ ...participant, full_name: 'Arjun Verma' });
    expect(isProfileComplete()).toBe(true);
  });

  it('clears the session', () => {
    useAuthStore.getState().setParticipantSession(participant);
    useAuthStore.getState().clear();
    expect(isAuthenticated()).toBe(false);
  });
});
