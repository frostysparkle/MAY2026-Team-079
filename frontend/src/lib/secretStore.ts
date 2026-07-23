/**
 * Encrypted client-side storage for per-checkpoint TOTP secrets.
 *
 * Secrets are stored in IndexedDB, encrypted at rest with AES-GCM. The wrapping
 * key is a *non-extractable* CryptoKey kept in IndexedDB — structured-clonable
 * but not readable by JS, so a casual dump of storage does not reveal secrets.
 * (This is obfuscation-grade, not hardware-backed; a compromised device is
 * covered by the server-side "regenerate ID" revocation path, per the arch doc.)
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { CheckpointType } from '@/config/constants';

const DB_NAME = 'paradox-connect';
const DB_VERSION = 1;
const KEY_STORE = 'crypto';
const SECRET_STORE = 'secrets';
const WRAP_KEY_ID = 'wrapKey';

interface StoredSecret {
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE);
        if (!db.objectStoreNames.contains(SECRET_STORE)) db.createObjectStore(SECRET_STORE);
      },
    });
  }
  return dbPromise;
}

/** Get the AES-GCM wrapping key, creating and persisting it on first use. */
async function getWrapKey(): Promise<CryptoKey> {
  const db = await getDb();
  const existing = (await db.get(KEY_STORE, WRAP_KEY_ID)) as CryptoKey | undefined;
  if (existing) return existing;

  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  await db.put(KEY_STORE, key, WRAP_KEY_ID);
  return key;
}

function secretKey(context: CheckpointType, eventId?: string): string {
  if (context === 'event') {
    if (!eventId) throw new Error('An event ID is required for an event secret.');
    return `${context}:${eventId}`;
  }
  return context;
}

/** Encrypt and store a scoped TOTP secret. Overwrites only the selected scope. */
export async function saveSecret(
  context: CheckpointType,
  secretBase32: string,
  eventId?: string,
): Promise<void> {
  const key = await getWrapKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(secretBase32),
  );
  const db = await getDb();
  await db.put(SECRET_STORE, { iv, ciphertext } satisfies StoredSecret, secretKey(context, eventId));
}

/** Load and decrypt a scoped TOTP secret, or null if none is stored. */
export async function loadSecret(
  context: CheckpointType,
  eventId?: string,
): Promise<string | null> {
  const db = await getDb();
  const record = (await db.get(SECRET_STORE, secretKey(context, eventId))) as
    | StoredSecret
    | undefined;
  if (!record) return null;
  const key = await getWrapKey();
  const plaintext = await crypto.subtle.decrypt(
    // Copy into an ArrayBuffer-backed view to satisfy BufferSource typing.
    { name: 'AES-GCM', iv: new Uint8Array(record.iv) },
    key,
    record.ciphertext,
  );
  return new TextDecoder().decode(plaintext);
}

/** Remove all cached secrets (used on sign-out / device handover). */
export async function clearSecrets(): Promise<void> {
  const db = await getDb();
  await db.clear(SECRET_STORE);
}
