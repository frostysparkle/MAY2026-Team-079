import { describe, it, expect } from 'vitest';
import { mockApi } from './mockApi';
import { generateCode } from '@/lib/totp';

describe('mockApi', () => {
  it('rejects registration with a weak password', async () => {
    await expect(
      mockApi.register({ email: 'weak@ds.study.iitm.ac.in', password: 'short' }),
    ).rejects.toMatchObject({ code: 'weak_password' });
  });

  it('rejects invalid credentials on login', async () => {
    await expect(
      mockApi.login({ email: 'nobody@ds.study.iitm.ac.in', password: 'password123' }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
  });

  it('logs in a seeded participant without treating them as new', async () => {
    const res = await mockApi.login({ email: 'student@mg.study.iitm.ac.in', password: 'password123' });
    expect(res.isNewUser).toBe(false);
    expect(res.session.participant.role).toBe('participant');
  });

  it('registers a new participant with an incomplete profile', async () => {
    const res = await mockApi.register({ email: 'brandnew@ds.study.iitm.ac.in', password: 'password123' });
    expect(res.isNewUser).toBe(true);
    expect(res.session.participant.profileComplete).toBe(false);
  });

  it('rejects registering an email that already exists', async () => {
    await expect(
      mockApi.register({ email: 'student@mg.study.iitm.ac.in', password: 'password123' }),
    ).rejects.toMatchObject({ code: 'email_already_registered' });
  });

  it('verifies a freshly generated code, then rejects its replay as duplicate', async () => {
    await mockApi.login({ email: 'student@mg.study.iitm.ac.in', password: 'password123' });
    const { participantId, secretBase32 } = await mockApi.provisionSecret({
      checkpointContext: 'event',
    });
    const code = generateCode(secretBase32);

    const first = await mockApi.verifyScan({
      participantId,
      currentCode: code,
      checkpointContext: 'event',
    });
    expect(first.result).toBe('valid');

    const replay = await mockApi.verifyScan({
      participantId,
      currentCode: code,
      checkpointContext: 'event',
    });
    expect(replay.result).toBe('duplicate');
  });

  it('rejects a code from a different checkpoint context (per-context secrets)', async () => {
    await mockApi.login({ email: 'student@mg.study.iitm.ac.in', password: 'password123' });
    const { participantId, secretBase32 } = await mockApi.provisionSecret({
      checkpointContext: 'event',
    });
    // Code generated for the event secret, scanned at the mess checkpoint.
    // Because each checkpoint has its own secret, the event code does not verify.
    const res = await mockApi.verifyScan({
      participantId,
      currentCode: generateCode(secretBase32),
      checkpointContext: 'mess',
    });
    expect(res.result).toBe('expired');
  });
});
