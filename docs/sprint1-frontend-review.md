# Sprint 1 — Frontend Review & Analysis

Review of the Sprint 1 Frontend Plan before implementation. Captures the decisions,
inconsistencies, edge cases, and assumptions the build follows, so any team member can
understand *why* the code is shaped the way it is.

## Locked decisions (from the plan + architecture review)

- **Google Sign-in only**, no password anywhere. Domain must match one of the four IITM
  suffixes or registration is rejected.
- **4-tier RBAC**: Participant → Organizer → Admin → Super Admin. Role is always resolved
  **server-side** after sign-in; the splash "role" buttons only choose which login screen to
  show and carry no permission.
- **Complete Your Profile** is one full page. Photo goes to a separate `photos` collection,
  linked by participant ID — never embedded in the profile document.
- **Digital ID** is a per-participant, per-event/checkpoint TOTP secret. The QR is generated
  **on-device** and must work offline after first provisioning.

## Issues / inconsistencies found

1. **Scan Result reason codes were stale.** The plan (§8) lists only *Expired QR / Unknown
   Participant / Duplicate Scan*. The QR/TOTP architecture defines more outcomes. The build
   renders all of: **Valid, Expired QR, Unknown Participant, Duplicate Scan, Wrong Checkpoint,
   Not Eligible, Payment Pending** (the last used at hostel check-in per FR-5.2).
2. **Per-checkpoint secret vs. QR payload.** The QR carries only `{ participant_id, current_code }`.
   The event/checkpoint context is supplied by the *organizer app* at scan time, not embedded in
   the QR. The verification API type reflects this (`checkpoint_context` on the request).
3. **First Super Admin cannot be created in-app** — it is a one-time backend/DB step. There is no
   frontend screen for it; the UI only exposes role assignment to an already-authenticated Super
   Admin.

## Edge cases the UI must handle

- Google account with a non-IITM domain → clear, specific rejection message.
- Google account already registered → distinct message (not the same as domain rejection).
- Camera permission denied on the scanner → graceful fallback + manual participant-ID entry.
- Unrelated/invalid QR codes → ignored silently, no alert spam.
- No participants yet (Admin list), no accommodation assigned, no menu set → explicit empty states.
- Offline on the My QR page → still renders a valid code from the cached secret (no spinner after
  first load).
- Non-admin hitting an admin route → Access Denied page, with no admin content rendered behind it.

## UI/UX and best-practice notes

- Mobile-first: screens are used on phones in queues; optimize for speed and legibility.
- Every screen composes the shared reusable components (Button, TextInput, Banner, Loader, Empty,
  Error, Card, Nav Shell) instead of re-implementing states.
- Accessibility baked into the primitives: real labels, keyboard nav, visible focus, adequate
  contrast, ARIA roles on status banners.
- All network access goes through one typed API client with a swappable mock layer, so the real
  backend drops in later with no component changes.

## Assumptions made (documented, non-architectural)

- App lives in a **`frontend/`** subdirectory, leaving room for the backend (`backend/`) later and
  keeping `docs/` clean at the repo root.
- **Typed `mockApi` module** instead of MSW: MSW's service worker would collide with the real PWA
  service worker required for offline QR, so a plain typed mock behind the API interface is cleaner.
- **Zustand** for the small amount of global state (auth/session + resolved role, toasts, cached-
  secret status); React Context reserved for static values.

## Deferred to a later sprint (scope discipline)

- Polished animated QR countdown ring (ship a basic numeric countdown first).
- Remembering the last selected role on the splash screen.
