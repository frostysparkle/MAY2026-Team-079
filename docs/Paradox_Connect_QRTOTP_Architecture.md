# Paradox Connect — QR/TOTP Digital ID: Architecture & Security

## Summary

Same model as Google Authenticator, Microsoft Authenticator, and GitHub's 2FA: a shared secret is provisioned once, then both sides independently compute a time-based code using that secret — no network call needed to generate a code. The QR is just a convenience layer on top: instead of a student reading out a 6-digit number, the code (plus their participant ID) is encoded into a QR image the organizer scans.

**Standard used:** TOTP, RFC 6238 — HMAC-SHA1, 6-digit code, 30-second time step, ±1 step clock tolerance.

## TOTP Parameters (frontend and backend MUST match exactly)

Both the frontend generator (`otpauth`) and the backend verifier (`pyotp`) must be configured
with identical parameters, or codes generated on-device will never verify server-side. These
values are fixed and not to be changed independently by either team:

| Parameter                  | Value                                                                 |
|----------------------------|-----------------------------------------------------------------------|
| Standard                   | TOTP, RFC 6238                                                         |
| Hashing algorithm          | HMAC-SHA1                                                              |
| Number of digits           | 6                                                                      |
| Time step / period         | 30 seconds                                                            |
| Validation window          | ±1 step (accepts the previous, current, and next step; ~90s total)    |
| Secret encoding            | Base32 (RFC 4648, no padding) — the wire/storage format for the secret |
| Secret length              | 160-bit (20 bytes) random, i.e. a 32-character Base32 string          |
| Timezone / time source     | UTC epoch seconds; both sides operate on IST wall-clock (see below), but TOTP math itself uses Unix time, which is timezone-independent |
| Counter formula            | `T = floor(current_unix_time / 30)` (standard RFC 6238)               |

**Interoperability note:** `pyotp` (Python) and `otpauth` (JS) both default to SHA1 / 6 digits /
30s and both consume a Base32 secret — so with the values above they interoperate without custom
configuration. The one thing to verify in code review is that the Base32 secret string is passed
byte-for-byte identically to both libraries (no case changes, no added padding).

---

## Phase 1 — Provisioning (one-time, online)

1. Student completes registration via Google Sign-in.
2. Backend generates a **distinct TOTP secret per participant per event/checkpoint context** — not one global secret per participant. A secret valid for one event/checkpoint is never valid at another, even for the same participant. Each secret is provisioned (once, while online) for the specific context it applies to.
3. Each secret is stored **encrypted at rest** in MongoDB, keyed by `(participant_id, checkpoint_context)` (encryption key kept outside the database — environment variable or secret manager, never alongside the data).
4. A context's secret is sent to the device **exactly once**, over HTTPS, as part of the registration/profile-completion (or event-provisioning) response. It is never re-sent or re-exposed by any later API call.
5. Device stores each secret in the browser's most secure available local storage, indexed by its checkpoint context (not plain `localStorage` in the naive sense — use `IndexedDB` with the Web Crypto API to encrypt the value at rest, since this is a PWA rather than a native app with OS Keychain access).

This must happen while the device is online — it's the one moment the whole system depends on connectivity for the student side.

## Phase 2 — Check-in (repeating, split offline/online)

**On the student's device (offline, no network call):**
1. Compute the current 6-digit TOTP code locally, using the cached secret for the relevant checkpoint context + current time.
2. Render a QR code encoding `{ participant_id, current_code }` — never the secret itself. The QR intentionally does **not** carry the event/checkpoint context (see step 5).
3. Repeat automatically every 30 seconds for as long as the screen is open.

**On the organizer's device (online, requires network):**
4. Scan the QR, extract `{ participant_id, current_code }`.
5. Send `{ participant_id, current_code, checkpoint_context }` to the backend. The organizer app already knows which event/checkpoint it is scanning for, so it supplies the context — it does not need to be embedded in the QR.

**On the backend (online, stateless across instances — shared state in Redis):**
6. Look up the stored secret for `(participant_id, checkpoint_context)`, independently compute the expected code for the current (and adjacent) time window.
7. Compare. Check the code hasn't already been used in this window (replay/duplicate-scan protection, via the shared Redis store — see below). Check eligibility (payment status, hostel/mess access, etc., per the relevant module).
8. Return a result: Valid, or Invalid with a reason (Expired QR / Unknown Participant / Wrong Checkpoint / Duplicate Scan / Not Eligible).
9. Organizer's device displays the result.

### Shared verification state (Redis)

The backend is stateless and runs across multiple instances, so any verification request may land
on any instance. Replay protection therefore cannot use in-process memory — all instances must
consult one shared store (Redis) for:

- **Used TOTP codes** — a successfully verified `(participant_id, checkpoint_context, code, time-window)` is marked used immediately, with a TTL equal to the validity window (~90s), so a replay within the window returns *Duplicate Scan* regardless of which instance handles it.
- **Rate-limit counters** — keyed on the composite of participant ID + scanner device + IP address (see the "Brute-forcing codes" row in Vulnerabilities & mitigations).
- **Temporary verification state** — any short-lived state the verify path needs.

This shared store is the same caching layer the PRD places on the QR/TOTP verification path
(the system's highest-traffic operation).

---

## Vulnerabilities & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Device compromised, secret extracted | Attacker can forge valid codes indefinitely, on any device | Secure client-side storage (encrypted IndexedDB, not plain localStorage); server never re-exposes the secret after initial issue; self-service "regenerate ID" rotates the secret |
| QR screenshotted/shared (buddy punching) | Two people use one identity within the same ~30s window | 30s expiry limits the window automatically; for high-stakes checkpoints (hostel), show the participant's name/photo on the Scan Result screen so staff can visually cross-check |
| Same code scanned twice (replay) | Reused entry/exit before expiry | Backend marks a code as "used" immediately on successful verification; second scan in the same window returns Duplicate Scan |
| Brute-forcing codes | 6 digits = 1,000,000 combinations | Rate-limit scan attempts on a **composite key of participant ID + scanner device + IP address** (not participant ID alone, so an attacker can't spread guesses across many IDs), enforced via the shared Redis store; log failed attempts for audit |
| Database breach | One leak exposes every participant's secret at once | Secrets encrypted at rest; encryption key stored outside the database. Per-event/per-checkpoint scoping also limits blast radius — a leaked secret is only valid for one context |
| Clock drift | Device time wrong → codes never match | ±1 step (~90s total) validation tolerance. All parties operate in IST (see below); TOTP itself is computed on Unix epoch time, which is timezone-independent, so a correct device clock is sufficient. Sync/verify device time against the server during the online provisioning step |
| Lost/stolen device, no revocation path | Old secret stays valid forever | Login again → generate a **new** secret → **invalidate the previous secret** → only the new device can generate valid codes. The old secret is never reissued or downloaded again (see Lost Device Recovery below) |
| Organizer device has no internet | Verification cannot happen at all — this is a direct tradeoff of online-only organizer verification | Already covered by the team's existing decision to defer a manual/paper fallback (PRD Section 9.2 open question / Risk R5) — no new decision needed, just noting the connection |

---

## Time standardization (IST)

The system operates within a single timezone. **India Standard Time (IST) is the official timezone
for the application**, and both frontend and backend must consistently treat displayed/operational
time as IST. Because the whole audience is in one timezone, we do not anticipate timezone-related
mismatch issues.

Note that TOTP itself does not depend on the display timezone: RFC 6238 computes the code from Unix
epoch seconds (`T = floor(current_unix_time / 30)`), which is the same absolute instant everywhere.
The practical requirement is simply that each device's *clock is correct* (not drifted), which the
±1 step tolerance and the provisioning-time sync above address. IST is the standard for all
human-facing timestamps (logs, receipts, schedules).

## Lost Device Recovery

If a participant loses or changes their device, the recovery flow is:

```
Login Again
      ↓
Generate a New Secret (per event/checkpoint context, as at provisioning)
      ↓
Invalidate the Previous Secret
      ↓
Only the New Device Can Generate Valid Codes
```

The previous secret is **never reissued or downloaded again**. Recovery does not "re-fetch" the old
secret — there is deliberately no endpoint that re-exposes an existing secret. This guarantees a
lost or compromised device cannot keep generating valid QR/TOTP codes once the participant has
recovered on a new device. (This is the same mechanism as the self-service / Admin "regenerate ID"
revocation path.)

---

## Implementation notes for the team

- **Ashwin (backend):** needs a TOTP library (`pyotp`) configured to the exact parameters in the TOTP Parameters table (SHA1 / 6 digits / 30s / Base32); per-`(participant_id, checkpoint_context)` encrypted-secret storage; the one-time provisioning response; the verify endpoint that takes `checkpoint_context` from the organizer app and looks up the matching secret; used-code tracking and composite (participant + scanner + IP) rate limiting, both in **Redis** (shared across instances); and the regenerate/invalidate path for lost-device recovery.
- **Ravi (frontend):** needs a client-side TOTP generation library (`otpauth`) configured to the *same* parameters, computing codes offline; a QR-rendering library for the live check-in QR (payload `{ participant_id, current_code }`, no context field); and secure per-context local storage (IndexedDB, not plain localStorage) for the cached secrets. The "My QR ID" page no longer polls the server every refresh — it generates locally and only calls the server once, during provisioning.
- **Both:** confirm together that (a) the provisioning step happens automatically right after Complete Your Profile succeeds — the one guaranteed moment the device is online before the student might go offline later at the venue — and (b) the Base32 secret string is passed byte-for-byte identically to `pyotp` and `otpauth` so codes interoperate.
