/**
 * RSA-OAEP QR encryption via native SubtleCrypto — no crypto library needed.
 * Confirmed compatible with the backend's `cryptography` SubjectPublicKeyInfo
 * PEM output (backend/security.py::generate_rsa_key_pair) end-to-end.
 */

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .replace(/\s+/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export async function importPublicKeyFromPem(pem: string): Promise<CryptoKey> {
  const der = pemToArrayBuffer(pem);
  return crypto.subtle.importKey('spki', der, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, [
    'encrypt',
  ]);
}

/** Encrypts `{participant_id}` — this is the `ScanQRRequest.data` field. */
export async function encryptParticipantId(
  publicKey: CryptoKey,
  participantId: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({ participant_id: participantId }));
  const ciphertext = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, bytes);
  return arrayBufferToBase64(ciphertext);
}
