import { describe, it, expect, beforeEach } from 'vitest';
import { mockApi, __resetMockApiForTests } from './mockApi';
import { importPublicKeyFromPem, encryptParticipantId } from '@/lib/rsaOaep';

async function loginAndBuildQr(email: string, password = 'password123') {
  const login = await mockApi.login({ email, password });
  const key = await importPublicKeyFromPem(login.public_key!);
  const data = await encryptParticipantId(key, login.id);
  return { login, qr: { participant_id: login.id, data, timestamp: new Date().toISOString() } };
}

describe('mockApi', () => {
  beforeEach(() => __resetMockApiForTests());

  it('rejects a non-IITM email on register', async () => {
    await expect(
      mockApi.register({ email: 'someone@gmail.com', password: 'password123' }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Must be an @*.study.iitm.ac.in email',
    });
  });

  it('registers, then logs in with the new credentials', async () => {
    const reg = await mockApi.register({
      email: 'fresh@ds.study.iitm.ac.in',
      password: 'password123',
    });
    expect(reg.participant_id).toMatch(/^DS/);
    const login = await mockApi.login({
      email: 'fresh@ds.study.iitm.ac.in',
      password: 'password123',
    });
    expect(login.token_type).toBe('participant');
    expect(login.full_name).toBeNull();
    expect(login.public_key).toContain('BEGIN PUBLIC KEY');
  });

  it('rejects wrong password on login', async () => {
    await expect(
      mockApi.login({ email: 'participant@ds.study.iitm.ac.in', password: 'wrong' }),
    ).rejects.toMatchObject({
      status: 401,
      message: 'Invalid credentials',
    });
  });

  it('logs in staff separately from participants', async () => {
    const staff = await mockApi.adminLogin({
      email: 'superadmin@paradox.dev',
      password: 'password123',
    });
    expect(staff.token_type).toBe('staff');
    expect(staff.role).toBe('super_admin');
  });

  it('completes a real RSA-OAEP scan round trip and rejects a mismatched mess', async () => {
    const { qr } = await loginAndBuildQr('participant@ds.study.iitm.ac.in');
    await mockApi.adminLogin({ email: 'messvolunteer@paradox.dev', password: 'password123' });

    const ok = await mockApi.scanMess('MS01', 'breakfast', 1, qr);
    expect(ok.message).toBe('Scan successful, entry allowed');

    // Duplicate scan for the same slot/day is rejected.
    await expect(mockApi.scanMess('MS01', 'breakfast', 1, qr)).rejects.toMatchObject({
      status: 400,
      message: 'Already logged in for breakfast on day 1',
    });
  });

  it('rejects an expired QR timestamp', async () => {
    const login = await mockApi.login({
      email: 'participant@ds.study.iitm.ac.in',
      password: 'password123',
    });
    const key = await importPublicKeyFromPem(login.public_key!);
    const data = await encryptParticipantId(key, login.id);
    const staleQr = {
      participant_id: login.id,
      data,
      timestamp: new Date(Date.now() - 90_000).toISOString(),
    };
    await mockApi.adminLogin({ email: 'messvolunteer@paradox.dev', password: 'password123' });

    await expect(mockApi.scanMess('MS01', 'breakfast', 1, staleQr)).rejects.toMatchObject({
      status: 400,
      message: 'QR Code expired',
    });
  });

  it('blocks a non-super-admin from creating a mess', async () => {
    await mockApi.adminLogin({ email: 'eventhead@paradox.dev', password: 'password123' });
    await expect(
      mockApi.createMess({
        mess_id: 'MESS2',
        name: 'North Mess',
        capacity: 100,
        preference: 'veg',
      }),
    ).rejects.toMatchObject({ status: 403, message: 'Not authorized' });
  });

  it('enforces duplicate event registration as 409', async () => {
    await mockApi.login({ email: 'participant@ds.study.iitm.ac.in', password: 'password123' });
    await mockApi.registerForEvent('22', {});
    await expect(mockApi.registerForEvent('22', {})).rejects.toMatchObject({ status: 409 });
  });

  it('serves the public programme without a token', async () => {
    const events = await mockApi.listPublicEvents();
    expect(events.length).toBeGreaterThan(0);
    // The brochure projection withholds staff and registration internals.
    for (const event of events) {
      expect(event).not.toHaveProperty('event_team');
      expect(event).not.toHaveProperty('registration_fields');
    }
  });

  it("returns this participant's own workshop bookings", async () => {
    await mockApi.login({ email: 'participant@ds.study.iitm.ac.in', password: 'password123' });
    const all = await mockApi.listWorkshops();
    const target = all[0];

    await mockApi.registerForWorkshop(target.workshop_id);
    const mine = await mockApi.myWorkshopRegistrations();

    const booked = mine.find((w) => w.workshop_id === target.workshop_id);
    expect(booked).toMatchObject({
      workshop_id: target.workshop_id,
      slot_id: target.slot_id,
      name: target.name,
      attended: false,
    });
  });

  it('names the slot clash distinctly from a duplicate booking', async () => {
    await mockApi.login({ email: 'participant@ds.study.iitm.ac.in', password: 'password123' });
    const all = await mockApi.listWorkshops();
    const first = all[0];
    const sameSlot = all.find(
      (w) => w.slot_id === first.slot_id && w.workshop_id !== first.workshop_id,
    );

    await mockApi.registerForWorkshop(first.workshop_id);

    // Booking the same workshop twice and booking a clashing one are different
    // mistakes and must not report the same reason.
    await expect(mockApi.registerForWorkshop(first.workshop_id)).rejects.toMatchObject({
      status: 400,
      message: 'Already registered for this workshop',
    });
    if (sameSlot) {
      await expect(mockApi.registerForWorkshop(sameSlot.workshop_id)).rejects.toMatchObject({
        status: 400,
        message: 'Already registered for another workshop in this time slot',
      });
    }
  });

  it('lets a participant request and withdraw accommodation', async () => {
    await mockApi.register({ email: 'fresh-stay@ds.study.iitm.ac.in', password: 'password123' });
    await mockApi.login({ email: 'fresh-stay@ds.study.iitm.ac.in', password: 'password123' });

    expect((await mockApi.myHostel()).registered).toBe(false);

    await mockApi.registerForAccommodation();
    expect((await mockApi.myHostel()).registered).toBe(true);

    await mockApi.cancelAccommodationRequest();
    expect((await mockApi.myHostel()).registered).toBe(false);
  });

  it('only allocates hostels to participants who asked for one', async () => {
    await mockApi.register({ email: 'wants-bed@ds.study.iitm.ac.in', password: 'password123' });
    await mockApi.login({ email: 'wants-bed@ds.study.iitm.ac.in', password: 'password123' });
    await mockApi.completeProfile({
      full_name: 'Wants Bed',
      dob: '2003-01-01',
      house: 'Wayanad',
      gender: 'male',
      phone: '9876543210',
      mess_preference: 'veg',
      country: 'India',
      state: 'Tamil Nadu',
      city: 'Chennai',
      address: '1 Test St',
      program: 'BS',
      course_stage: 'Foundation',
    });
    await mockApi.registerForAccommodation();

    await mockApi.adminLogin({ email: 'superadmin@paradox.dev', password: 'password123' });
    await mockApi.allocateHostels();

    await mockApi.login({ email: 'wants-bed@ds.study.iitm.ac.in', password: 'password123' });
    expect((await mockApi.myHostel()).assigned_hostel).not.toBeNull();
  });
});
