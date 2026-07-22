import { describe, it, expect } from 'vitest';
import { mockApi } from './mockApi';
import { generateCode } from '@/lib/totp';

describe('mockApi', () => {
  it('rejects a non-IITM email domain', async () => {
    await expect(mockApi.loginWithGoogle({ idToken: 'someone@gmail.com' })).rejects.toMatchObject({
      code: 'invalid_domain',
    });
  });

  it('logs in a seeded participant without treating them as new', async () => {
    const res = await mockApi.loginWithGoogle({ idToken: 'student@mg.study.iitm.ac.in' });
    expect(res.isNewUser).toBe(false);
    expect(res.session.participant.role).toBe('participant');
  });

  it('creates a new participant for an unseen IITM email', async () => {
    const res = await mockApi.loginWithGoogle({ idToken: 'brandnew@ds.study.iitm.ac.in' });
    expect(res.isNewUser).toBe(true);
    expect(res.session.participant.profileComplete).toBe(false);
  });

  it('verifies a freshly generated code, then rejects its replay as duplicate', async () => {
    await mockApi.loginWithGoogle({ idToken: 'student@mg.study.iitm.ac.in' });
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
    await mockApi.loginWithGoogle({ idToken: 'student@mg.study.iitm.ac.in' });
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
