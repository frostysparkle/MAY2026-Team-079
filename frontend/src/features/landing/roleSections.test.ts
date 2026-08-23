import { describe, it, expect } from 'vitest';
import { homeRoute, landingSections } from './roleSections';
import { postLoginRoute } from '@/features/auth/postLoginRoute';
import { ROUTES } from '@/config/routes';
import type { ParticipantSession, StaffSession } from '@/stores/authStore';

const participant = (over: Partial<ParticipantSession> = {}): ParticipantSession => ({
  id: 'DS23F1000001',
  email: 'p@ds.study.iitm.ac.in',
  access_token: 't',
  token_type: 'participant',
  full_name: 'Arjun Verma',
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
  ...over,
});

const staff = (role: string): StaffSession => ({
  id: 'ST0001',
  email: 'wind-head@ds.study.iitm.ac.in',
  access_token: 't',
  token_type: 'staff',
  role,
  department: 'technical',
  designation: 'Coordinator',
});

const labels = (session: Parameters<typeof landingSections>[0]) =>
  landingSections(session).map((s) => s.label);

describe('landingSections', () => {
  it('always opens with Home, pointing at that role’s own landing', () => {
    for (const session of [null, participant(), staff('super_admin'), staff('volunteer')]) {
      const [first, ...rest] = landingSections(session);
      expect(first).toEqual({ label: 'Home', to: homeRoute(session) });
      expect(rest.some((s) => s.label === 'Home')).toBe(false);
    }
  });

  it('gives a visitor the public brochure', () => {
    expect(labels(null)).toEqual(['Home', 'Events', 'Schedule', 'Workshops', 'Sponsors', 'Staff']);
    expect(landingSections(null).find((s) => s.label === 'Events')?.to).toBe(ROUTES.publicEvents);
  });

  it('points a participant at the app build of each section, not the brochure', () => {
    const sections = landingSections(participant());
    expect(sections.find((s) => s.label === 'Events')?.to).toBe(ROUTES.events);
    expect(sections.find((s) => s.label === 'Workshops')?.to).toBe(ROUTES.workshops);
    expect(sections.find((s) => s.label === 'Schedule')?.to).toBe(ROUTES.schedule);
    expect(sections.find((s) => s.label === 'Stay')?.to).toBe(ROUTES.accommodation);
    // Sponsors has no signed-in build, so the brochure page stays the target.
    expect(sections.find((s) => s.label === 'Sponsors')?.to).toBe(ROUTES.sponsors);
  });

  it('offers a participant Help & Support from the landing itself', () => {
    // It was reachable only from `AppShell`'s rail, which exists only *inside* a
    // section — so a student who signed in and opened Events from the portal
    // never learned the fest could be asked a question at all. The landing is the
    // screen they arrive on, so it has to name it.
    const sections = landingSections(participant());
    expect(sections.find((s) => s.label === 'Help & Support')?.to).toBe(ROUTES.support);
  });

  it('names Help & Support once, not as the three sections it replaced', () => {
    const shown = labels(participant());
    for (const gone of ['Help', 'Report', 'Queries']) {
      expect(shown).not.toContain(gone);
    }
  });

  it('gives a Super Admin the fest-wide sections', () => {
    expect(labels(staff('super_admin'))).toEqual([
      'Home',
      'Overview',
      'Events',
      'Workshops',
      'Mess',
      'Hostels',
      'Staff',
      'Audit Logs',
    ]);
  });

  it('gives other staff their dashboard and the public programme', () => {
    const sections = landingSections(staff('volunteer'));
    expect(sections.find((s) => s.label === 'Dashboard')?.to).toBe(ROUTES.staffDuties);
    // No admin section leaks into a non-super-admin's landing.
    expect(sections.every((s) => !s.to.startsWith('/staff/admin'))).toBe(true);
  });

  it('sends every role to a route their guard admits', () => {
    // The landing is protected, so a section that pointed into the wrong area
    // would bounce the user to Access Denied on the first click.
    for (const s of landingSections(participant())) {
      expect(s.to.startsWith('/staff')).toBe(false);
    }
    for (const s of landingSections(staff('volunteer'))) {
      expect(s.to.startsWith('/app')).toBe(false);
    }
    for (const s of landingSections(staff('super_admin'))) {
      expect(s.to.startsWith('/app')).toBe(false);
    }
  });
});

describe('postLoginRoute', () => {
  it('lands a participant on their Landing Page', () => {
    expect(postLoginRoute(participant())).toBe(ROUTES.home);
  });

  it('still diverts an unfinished participant profile', () => {
    expect(postLoginRoute(participant({ full_name: null }))).toBe(ROUTES.completeProfile);
  });

  it('routes staff by role, as the guide asks', () => {
    // A Super Admin is on no entity team, so a duty list would be empty for them;
    // the fest-wide board is the only thing that reads.
    expect(postLoginRoute(staff('super_admin'))).toBe(ROUTES.adminOverview);
    // Everybody else lands on their work rather than on the portal.
    expect(postLoginRoute(staff('volunteer'))).toBe(ROUTES.staffDuties);
    expect(postLoginRoute(staff('event_head'))).toBe(ROUTES.staffDuties);
    expect(postLoginRoute(staff('other'))).toBe(ROUTES.staffDuties);
  });

  it('never sends staff into the participant tree, or a participant into the staff tree', () => {
    expect(postLoginRoute(staff('super_admin')).startsWith('/app')).toBe(false);
    expect(postLoginRoute(staff('volunteer')).startsWith('/app')).toBe(false);
    expect(postLoginRoute(participant()).startsWith('/staff')).toBe(false);
  });
});
