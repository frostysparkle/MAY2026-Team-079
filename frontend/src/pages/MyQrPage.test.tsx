import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import MyQrPage from './MyQrPage';
import { useAuthStore } from '@/stores/authStore';
import { importPublicKeyFromPem, encryptParticipantId } from '@/lib/rsaOaep';
import type { ParticipantLoginResponse } from '@/api/types';

describe('MyQrPage', () => {
  beforeEach(async () => {
    const pair = await crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['encrypt', 'decrypt'],
    );
    const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
    let binary = '';
    new Uint8Array(spki).forEach((b) => (binary += String.fromCharCode(b)));
    const pem = `-----BEGIN PUBLIC KEY-----\n${btoa(binary)}\n-----END PUBLIC KEY-----`;

    const session: ParticipantLoginResponse = {
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
      public_key: pem,
    };
    useAuthStore.getState().setParticipantSession(session);

    // Sanity: the imported key actually encrypts (exercises the same path the page uses).
    const key = await importPublicKeyFromPem(pem);
    await encryptParticipantId(key, session.id);
  });

  it('renders a QR code and the participant name once ready', async () => {
    render(<MyQrPage />);
    expect(await screen.findByLabelText('Your digital ID QR code')).toBeInTheDocument();
    expect(screen.getByText('Arjun Verma')).toBeInTheDocument();
    expect(screen.getByText(/ID: DS23F1000001/)).toBeInTheDocument();
  });
});
