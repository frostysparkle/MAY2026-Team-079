# Paradox Connect Frontend Integration Guide v3

This guide is written so the frontend team does not need to go back to the backend author for anything. Every endpoint below documents **why it exists**, **who can call it**, **exactly what to send**, **exactly what comes back**, **every error and the precise condition that triggers it**, **side effects worth knowing**, and **how to use it in a real screen**. All of it was extracted directly from the router source (not guessed), so error strings and field names below are exact — match them verbatim in your error-handling code.

---

## Table of Contents

1. [Core Concepts & Conventions](#1-core-concepts--conventions)
2. [Authentication](#2-authentication)
3. [QR Code Handling](#3-qr-code-handling)
4. [Roles & Permissions Matrix](#4-roles--permissions-matrix)
5. [Time Windows & Scanning Logic](#5-time-windows--scanning-logic)
6. [Endpoint Reference — Auth & Profile](#6-endpoint-reference--auth--profile)
7. [Endpoint Reference — Backend Teams (Staff Management)](#7-endpoint-reference--backend-teams-staff-management)
8. [Endpoint Reference — Participants (Admin Roster)](#8-endpoint-reference--participants-admin-roster)
9. [Endpoint Reference — Events](#9-endpoint-reference--events)
10. [Endpoint Reference — Workshop Slots](#10-endpoint-reference--workshop-slots)
11. [Endpoint Reference — Workshops](#11-endpoint-reference--workshops)
12. [Endpoint Reference — Mess Halls](#12-endpoint-reference--mess-halls)
13. [Endpoint Reference — Hostels](#13-endpoint-reference--hostels)
14. [Endpoint Reference — Queries](#14-endpoint-reference--queries)
15. [Endpoint Reference — Issues](#15-endpoint-reference--issues)
16. [Endpoint Reference — Audit Logs](#16-endpoint-reference--audit-logs)
17. [Endpoint Reference — Embeddings](#17-endpoint-reference--embeddings)
18. [Real-Time Streams (SSE) — Cross-Cutting Notes](#18-real-time-streams-sse--cross-cutting-notes)
19. [Role Journeys & Screen Flows](#19-role-journeys--screen-flows)
20. [TypeScript Types & API Client Appendix](#20-typescript-types--api-client-appendix)
21. [Known Gaps & Things To Flag To Users](#21-known-gaps--things-to-flag-to-users)
22. [Full Vocabularies](#22-full-vocabularies)

---

## 1. Core Concepts & Conventions

### 1.1 Base URL

All routes are relative to `/api/v1`. Example: `GET /events/public` → `https://backend.example.com/api/v1/events/public`.

### 1.2 HTTP Status Codes

| Code | Meaning | Typical UI treatment |
|------|---------|----------------------|
| 200 | Success | render data |
| 400 | Business-rule violation or malformed input (not a schema error) | inline error near the relevant field, or a state-conflict message ("already allotted") |
| 401 | Invalid/expired token, or the account no longer exists | force re-login |
| 403 | Authenticated, but not allowed to do this (wrong role, wrong token type, not on the right team) | show "not authorized" state, don't retry |
| 404 | Entity not found (wrong id, or — deliberately, in some places — used to mask "not yours" so ids can't be enumerated) | show "not found" / redirect to a list view |
| 409 | Conflict (already exists, already assigned, already linked) | show "already exists" messaging, not a generic error |
| 422 | Pydantic validation error (wrong type, out-of-range enum/number, regex mismatch) | this is a genuine client bug — validate before you send |
| 429 | Rate limited (embeddings only) | back off using the `Retry-After` header |
| 500 | Unhandled server error | generic "something went wrong," report it |
| 502 | Upstream provider unreachable (embeddings only) | "temporarily unavailable" |

**Important distinction used throughout this API:** 400 means "your request was well-formed but the action can't happen right now" (e.g. "Mess already allotted"). 422 means "your request body itself is invalid" (wrong enum value, missing required field). Don't treat these the same in your UI — 400s are user-facing business states, 422s are bugs in your client code.

### 1.3 Pagination

| Endpoint | Default `limit` | Range |
|----------|------------------|-------|
| `GET /participants` | 200 | 1–500 |
| `GET /issues` | 100 | 1–500 |
| `GET /queries` | 100 | 1–500 |
| `GET /audit-logs` | 100 | 1–500 |

None of these support `offset`/`skip` — there is no true pagination, only a hard cap. If you expect more rows than the cap, treat `count == limit` as "there may be more" and communicate that in the UI (e.g. "showing first 500 results — refine your search").

### 1.4 Response Shape Conventions

- List endpoints return either a bare array (`GET /backend_teams`, `GET /events`, `GET /mess`) or an object with `count`/`{resource}` (`GET /participants`, `GET /issues`). Check each endpoint's documented shape below — don't assume one convention applies everywhere.
- Mongo `ObjectId` fields are always stringified before reaching you (e.g. `mess.mess_id`, `backend_teams.admin_id`) — you will never receive a raw `{"$oid": "..."}` shape.
- Every mutating endpoint that succeeds returns at minimum `{"message": "..."}`; some also return the affected id or the updated resource.

---

## 2. Authentication

### 2.1 Two Separate Login Portals, Two Token Types

This API has two completely separate identities that must not be conflated in your frontend:
- **Participants** log in via `POST /auth/login` and get `token_type: "participant"`.
- **Staff** (Super Admin, Domain Admin, Volunteer, "other") log in via `POST /auth/admin/login` and get `token_type: "staff"`.

Build **two separate login screens/routes** (e.g. `/login` vs `/admin/login`). Sending a participant token to a staff-only route gets you `403 "Staff credentials required. Use /auth/admin/login."`; sending a staff token to a participant-only route gets you `403 "Participant credentials required. Use /auth/login."`. These messages are precise enough to show directly to a confused user who bookmarked the wrong login page.

### 2.2 Bearer Header

```http
Authorization: Bearer <access_token>
```

Store the token in memory (not `localStorage`, to reduce XSS exposure). There is **no token refresh endpoint and no blacklist** — a token remains valid until it naturally expires; the only way to get a new one is to log in again, or call `POST /auth/password/change` (which happens to also return a fresh token as a side effect).

### 2.3 Public Routes (No Token Required)

| Method | Path | Why it's public |
|--------|------|------------------|
| GET | `/events/public` | Pre-login festival brochure |
| GET | `/workshops/public` | Pre-login workshop listing |
| GET | `/workshop-slots` | So a create-workshop admin form can populate a slot dropdown, and so public workshop listings can show times |
| GET | `/workshops/{id}/seats/stream` | Public live seat counter on the registration page |
| POST | `/auth/register` | Account creation, by definition pre-auth |
| POST | `/auth/login` | Participant login |
| POST | `/auth/admin/login` | Staff login |
| POST | `/auth/password/forgot` | Password recovery (currently a stub — see §21) |
| POST | `/auth/password/reset` | Password recovery (currently a stub — see §21) |

Every other endpoint in this API requires `Authorization: Bearer`.

### 2.4 Auth-Layer Errors (apply to every protected route)

These come from the shared dependency layer (`get_current_user` / `get_current_staff` / `get_current_participant`), before your endpoint-specific logic ever runs:

| Status | Detail | Cause |
|--------|--------|-------|
| 401 | `Invalid authentication credentials` | Missing/malformed/expired JWT |
| 403 | `Not authenticated` | No `Authorization` header at all (raised by the underlying HTTPBearer scheme) |
| 403 | `Staff credentials required. Use /auth/admin/login.` | A participant token hit a staff-only route |
| 403 | `Participant credentials required. Use /auth/login.` | A staff token hit a participant-only route |
| 401 | `User not found` / `Staff member not found` / `Participant not found` | Token is structurally valid but the account was deleted since it was issued |

Build one shared HTTP interceptor that catches all of these and forces a re-login — you don't need per-screen handling for them.

---

## 3. QR Code Handling

### 3.1 What the QR Encodes

Each participant has an RSA keypair generated at registration (`qr_secrets`, private key stored server-side, public key returned at login as `public_key`). The QR a participant shows at a gate is decrypted server-side into `{participant_id, data, timestamp}` — your scanning client just needs to capture the raw QR string and send it as `ScanQRRequest {participant_id, data, timestamp}` in the POST body of whichever scan endpoint applies. **You do not decrypt or validate the QR client-side** — the server does, via a shared `verify_qr` helper used by every scan endpoint (events, workshops, mess, hostels).

### 3.2 Freshness Window

QR codes expire **60 seconds** after the `timestamp` they were generated with (`QR_MAX_AGE`). This means:
- The device generating the QR (participant's app) and the device scanning it (volunteer's app) both need reasonably accurate clocks.
- If your participant-side QR display doesn't auto-refresh, a participant who stands in a slow queue for over a minute will get a spurious `400 "QR Code expired"` at the counter. **Auto-regenerate the displayed QR at least every 30–45 seconds** to stay safely inside the window.

### 3.3 Every QR-Related Error (identical across events/workshops/mess/hostels)

| Status | Detail | Cause |
|--------|--------|-------|
| 404 | `Scanned user not found` | `participant_id` in the payload doesn't match any participant |
| 400 | `User missing private key` | Server-side data issue — that participant's `qr_secrets` is missing (backend bug, not a user error) |
| 400 | `Invalid timestamp format` | `timestamp` field isn't parseable |
| 400 | `QR Code expired` | More than 60s has passed since `timestamp` |
| 400 | `Invalid or corrupted QR code` | Decryption/signature check failed — malformed payload, tampered code, or wrong keypair |

Show these as scanner-UI toasts distinct from the endpoint's own business-logic errors (window-not-open, already-scanned, etc.) — they mean "the code itself is bad," not "the code is fine but the action isn't allowed right now."

---

## 4. Roles & Permissions Matrix

| Actor | Token type | Typical exact guard string |
|-------|-----------|------------------------------|
| Super Admin | staff, `role: "super_admin"` | Varies by router: `"Only Super Admins can perform this action"` (events, workshop-slots), `"Not authorized"` (mess, hostels, participants), `"Only Super Admins can manage backend teams"` / `"...can view backend teams"` (backend_teams), `"Only Super Admins can view audit logs"` (audit), `"Only Super Admins can manage the query team"` (queries team roster) |
| Domain Admin / "admin" | staff, `role: "admin"` | Currently has no distinct route-level powers beyond what "other" staff have unless also on a specific team roster — role is mostly informational today |
| Event Head | staff, must be on `event.event_team` with `role: "event_head"` | `"Only Event Heads are authorized to allocate teams"`, `"Only the Event Head can post announcements for this event"`, `"Only Event Heads are authorized to modify participant teams"` |
| Event team member/volunteer | staff, on `event.event_team` (any role) | Can scan (`POST /events/{id}/scan`), view participation, read announcements |
| Workshop team member | staff, on `workshop.workshop_team`, with own `attendance` flag gating scanning | Can view participation always; can scan/correct attendance only if `attendance=True` |
| Mess/hostel team member | staff, in `mess_team`/`hostel_team`, with own `logging`/`attendance` flag gating scanning | Same pattern — being on the team ≠ being allowed to scan |
| Query team member | staff, row in `query_team_collection` | Can read/handle all queries (not scoped by category) |
| Participant | participant token | Can manage their own registrations, mess/hostel, queries, issues |

**Key UI implication:** "assigned to a team" and "allowed to scan" are two independent flags almost everywhere (`logging` for mess, `attendance` for hostels/workshops). Don't assume a volunteer on the roster can scan — check/display their toggle state, and build the toggle-scan UI as a distinct action from add/remove-from-team.

---

## 5. Time Windows & Scanning Logic

### 5.1 Workshop Attendance Windows

Keyed off `workshop.start_time` (denormalized from the workshop's slot at creation time):

| `scan_type` | Opens | Closes | Who can use it |
|-------------|-------|--------|-----------------|
| `pre-registered` | 30 min before start | 30 min after start | Scanner UI, default |
| `on-spot` | 15 min before start | 30 min after start | Scanner UI, walk-ins |
| `changes` | exactly at start | 30 min after start | Manual correction route only (`PATCH /workshops/{id}/participants/{id}`) — never accepted by the scan endpoint itself |

Outside the window:
- `403 "Scanning window not yet open. Opens {N} min before start (in ~{M} min)."`
- `403 "Scanning window closed. It closes 30 min after the workshop starts."`

This applies **even to Super Admins** making manual corrections — a correction made hours later must go through the audit trail, not this endpoint.

If `workshop.start_time` is missing or unparseable, the guard **fails open** (allows the scan) rather than locking out an entire session — this is a deliberate backward-compatibility trade-off for old/bad seed data, logged as an integrity warning server-side. You won't see this as a frontend error; just be aware scan windows can occasionally be bypassed by bad data.

### 5.2 Mess Scanning Window

`SCAN_WINDOW = ±15 minutes` around each meal slot's `start_time`/`end_time` on the hall's current menu:
- `403 "Scanning window not yet open for this slot"`
- `403 "Scanning window closed for this slot"`

### 5.3 Computed vs Stored "Is Registration Open"

- **Events**: `registration.is_open` is computed **fresh on every read**, never stored. It's `True` only if `registration.allowed` is `True` **AND** the current time is within `[start_time, end_time]`. Both conditions are ANDed — an admin's manual "allowed" toggle and the time window both have to hold. Never compute this client-side; always read the field.
- **Workshops**: `registration_open` is stored, but lazily auto-closed the first time anyone reads the workshop after `registration_end` has passed (there's no background scheduler in this system — everything is pull-based on read). An admin's own edit to `registration_open` is respected until the next natural deadline change.

---

## 6. Endpoint Reference — Auth & Profile

### `POST /auth/register`
**Purpose:** First step of the participant funnel — creates the account before profile completion, using the participant's IITM student email as identity.
**Auth:** Public.
**Body:**
```json
{ "email": "23f3001726@ds.study.iitm.ac.in", "password": "at least 8 chars" }
```
Email must match `^[^@]+@[a-z]+\.study\.iitm\.ac\.in$` (case-insensitive, checked after lowercasing).
**Success (200):**
```json
{ "message": "Registration successful", "participant_id": "DS23F3001726" }
```
`participant_id` is derived from the email (`<PROGRAM><ROLLNO>`, uppercased) — never client-supplied.
**Errors:**
| Status | Detail | Cause |
|---|---|---|
| 400 | `Must be an @*.study.iitm.ac.in email` | Email fails the IITM domain regex |
| 400 | `Email already registered` | Case-insensitive match already exists in participants OR backend_teams |
| 422 | (pydantic) | Malformed email / password < 8 chars |
**Side effects:** Inserts full participant doc with empty profile, unregistered mess/accommodation, a fresh RSA keypair for QR codes, `created_at`/`updated_at`. Audit row `REGISTER` (email redacted to local-part).
**Frontend usage:** Wire directly to your sign-up form submit handler. Show both 400s inline under the email field — they're actionable ("wrong domain" vs "go log in instead"), not generic toasts.

### `POST /auth/login`
**Purpose:** Participant sign-in.
**Auth:** Public.
**Body:** `{ "email": "...", "password": "..." }`
**Success (200):**
```json
{
  "id": "DS23F3001726", "email": "...",
  "access_token": "<JWT>", "token_type": "participant",
  "full_name": null, "dob": null, "house": null, "gender": null,
  "phone": null, "country": null, "state": null, "city": null,
  "address": null, "program": null, "course_stage": null,
  "photo": null, "public_key": "<PEM RSA public key>"
}
```
Profile fields are `null` until `PATCH /profile/complete` has been called — **use this to decide whether to route the user into the onboarding/profile-completion flow immediately after login.**
**Errors:** `401 "Invalid credentials"` — covers both "no such account" and "wrong password" with the **same message deliberately** (prevents account enumeration). Don't try to distinguish these in your UI; there is no way to.
**Side effects:** `LOGIN` audit row on success (records whether profile is complete); `LOGIN_FAILED` denial log on failure (server-side only distinguishes wrong-password vs unknown-account — never exposed to the client).
**Frontend usage:** Standard login form. After success, check `full_name === null` (or any core field) to decide "go to profile completion" vs "go to dashboard." Store `public_key` — you'll need it if you generate the participant's own QR client-side (see §3), though typically the QR display flow will call a dedicated generation helper using this key.

### `POST /auth/admin/login`
**Purpose:** Staff sign-in — a completely separate portal/token type.
**Auth:** Public.
**Body:** `{ "email": "...", "password": "..." }`
**Success (200):**
```json
{ "id": "SAUH1111", "email": "...", "access_token": "<JWT>", "token_type": "staff", "role": "super_admin", "department": "uhc", "designation": "..." }
```
**Errors:** `401 "Invalid credentials"` (same dual-cause message as participant login).
**Side effects:** `LOGIN` audit row (portal: staff); `LOGIN_FAILED` denial on failure.
**Frontend usage:** Separate admin login screen. Immediately after login, route to the right dashboard based on `role`/`department` (e.g. `role=="super_admin"` → full admin console; `department=="mess"` → mess team scanner UI).

### `POST /auth/password/forgot` — ⚠️ STUB
**Purpose (intended):** Request a password-reset email. **Purpose (actual, current implementation):** logs a warning and does nothing else — no email is sent, no real token is minted.
**Auth:** Public. **Body:** `{ "email": "..." }`
**Success (200) — always, regardless of whether the account exists:**
```json
{ "message": "If the account exists, a reset link has been sent.", "dev_reset_url": "http://localhost:5173/reset-password?token=mock_token_123" }
```
**Frontend usage:** Do not build a real "check your email" flow around this yet — see §21. If you must ship a forgot-password screen now, treat it as non-functional/demo-only and flag this clearly to your team lead.

### `POST /auth/password/reset` — ⚠️ STUB
**Purpose (actual):** Always reports success; changes nothing.
**Auth:** Public. **Body:** `{ "token": "...", "new_password": "min 8 chars" }`
**Success (200):** `{ "message": "Password reset successfully." }` — regardless of token validity.
**Frontend usage:** Same caveat as above — don't build a "your password has been reset, please log in" UX flow that depends on this actually working.

### `POST /auth/password/change`
**Purpose:** Lets an already-logged-in user (participant or staff) change their own password from a settings screen.
**Auth:** Any authenticated user, either token type.
**Body:** `{ "current_password": "...", "new_password": "min 8 chars" }`
**Success (200):** `{ "message": "Password changed successfully.", "access_token": "<new JWT>" }` — old tokens remain valid until they naturally expire (no blacklist).
**Errors:** `400 "Incorrect current password"` — verification against stored hash fails.
**Side effects:** Updates password hash + `updated_at`; `PASSWORD_CHANGED` audit row.
**Frontend usage:** Settings-page form. On 400, show the error inline on the "current password" field specifically. **Replace your stored token with the returned `access_token`** — otherwise subsequent requests keep using the old (still-valid, but semantically stale) token.

### `PATCH /profile/complete`
**Purpose:** Participant fills in their full profile after registering — the gate before most other participant actions feel "complete" (though nothing server-side actually blocks other actions until this is done).
**Auth:** Participant.
**Body (all optional, only sent fields are considered — but see note):**
```json
{
  "full_name": "Jane Doe", "dob": "2003-05-12", "house": "Kanha", "gender": "female",
  "phone": "9876543210", "mess_preference": "north_indian__veg",
  "country": "India", "state": "MP", "city": "Bhopal", "address": "Sector 10",
  "emergency_contact": { "name": "John Doe", "relation": "father", "phone": "9876543211" },
  "program": "DS", "course_stage": "foundational",
  "event_preferences": ["technical", "sports"], "photo": "base64_or_url"
}
```
`house`, `gender`, `program`, `course_stage`, `mess_preference` are all validated against their closed vocabularies (§22) — send exact values from those lists.
**Success (200):** the full resulting profile object (same field set as the body, reflecting merged state).
**Errors:** `422` if any enum field has an out-of-vocabulary value.
**Frontend usage:** Multi-step onboarding wizard maps naturally to this one endpoint — you can call it once at the end, or per-step with partial bodies (unset fields are left untouched server-side). Build your `house`/`gender`/`program`/`course_stage`/`mess_preference` inputs as selects bound to the vocab lists in §22, not free text, to avoid 422s.

---

## 7. Endpoint Reference — Backend Teams (Staff Management)

All four routes: Super Admin only. This is where Super Admins create/manage the *other* staff accounts (volunteers, guards, domain admins) that operate the rest of the system.

### `POST /backend_teams`
**Purpose:** Super Admin creates a new staff account so that person can log into the admin panel (e.g. onboarding a new mess volunteer or hostel guard before the fest).
**Body:**
```json
{ "email": "...", "password": "min 8", "role": "volunteer", "department": "mess", "designation": "Mess Counter Lead", "name": "optional override" }
```
`role` ∈ `{super_admin, admin, other, volunteer}`. `department` ∈ `{technical, sports, culturals, uhc, hostels, mess, workshops}`. If `name` omitted, falls back to the linked participant's `profile.full_name`.
**Success:** `{ "message": "Backend team member created", "paradox_id": "VLME1111" }` — id is auto-generated from role+department codes, never client-supplied.
**Errors:**
| Status | Detail | Cause |
|---|---|---|
| 400 | `Email already registered in backend teams` | Duplicate email (case-insensitive) |
| 400 | `role '<role>' requires a registered participant with this email; no matching participant record was found` | `role` is `super_admin`/`admin`/`volunteer` (not `other`) but no participant account exists with that email — **the person must register as a participant first** |
| 409 | `This participant is already linked to another backend_teams account` | That participant's record is already some other staff account's `admin_id` |
**Frontend usage:** "Add Staff Member" admin form. Surface the "requires a registered participant" error as an actionable instruction ("ask them to sign up as a participant first"), not a generic failure — it's a real workflow dependency. `role: "other"` is the only role exempt from needing a linked participant, useful for pure-staff accounts (e.g. external guards) with no student record.

### `GET /backend_teams`
**Purpose:** Staff roster for admin management/review.
**Success:** bare array (not wrapped):
```json
[{ "paradox_id": "SAUH1111", "email": "...", "name": "...", "role": "super_admin", "department": "uhc", "designation": "...", "admin_id": "64f...af2", "created_at": "...", "updated_at": "..." }]
```
`password_hash` never included. `admin_id` is a stringified ObjectId or absent.
**Errors:** `403 "Only Super Admins can view backend teams"` (note: different string from the create/update/delete guard).
**Frontend usage:** Staff management table. Remember this is a raw array, not `{staff: [...]}`.

### `PUT /backend_teams/{paradox_id}`
**Purpose:** Correct a staff member's designation/name (role and department are immutable after creation — changing those requires delete + recreate).
**Body:** `{ "designation": "optional", "name": "optional" }`
**Success:** `{ "message": "Backend team updated successfully" }` — no updated document returned, and an empty/no-op update returns the same success message.
**Errors:** `404 "Backend team member not found"`.
**Frontend usage:** Simple edit form limited to designation/name. Don't build UI expecting to see what changed from the response — just treat 200 as success and refetch the roster if you want to display the new value.

### `DELETE /backend_teams/{paradox_id}`
**Purpose:** Offboard a staff account (e.g. after the fest, or removing a mistaken entry).
**Success:** `{ "message": "Backend team deleted" }`.
**Errors:** `404 "Backend team member not found"`.
**Frontend usage:** Hard delete, irreversible, no soft-delete. The confirmation dialog should say "this cannot be undone" — after deletion, this person's id can still appear on team rosters/scan history elsewhere with no way to resolve who they were, so consider showing their name/role one more time in the confirmation.

---

## 8. Endpoint Reference — Participants (Admin Roster)

All three routes: Super Admin only (guard message here is the generic `403 "Not authorized"`, distinct from backend_teams' wording).

### `GET /participants/statistics`
**Purpose:** Fest-wide aggregate counts for an overview dashboard — deliberately roster-free (no names) so anyone who can see totals doesn't automatically see identities.
**Success:**
```json
{
  "total_registered": 500, "profile_complete": 420, "profile_incomplete": 80,
  "mess_registered": 300, "mess_allotted": 280,
  "hostel_registered": 350, "hostel_allotted": 340, "hostel_pending": 10,
  "currently_on_campus": 200, "with_event_registrations": 150, "with_workshop_registrations": 100,
  "by_house": {"Gir": 40}, "by_program": {"DS": 300}, "by_course_stage": {"degree": 250},
  "by_gender": {"male": 260, "female": 240}, "signups_by_day": {"2026-08-01": 5}
}
```
`hostel_pending = max(0, hostel_registered - hostel_allotted)`. `signups_by_day` keys are pre-sorted chronologically — don't re-sort.
**Errors:** `403 "Not authorized"`.
**Frontend usage:** Feed directly into dashboard charts/widgets. No audit log is written for this read (unlike the roster endpoint below) — safe to poll on a dashboard refresh interval.

### `GET /participants`
**Purpose:** The actual searchable roster — for looking someone up before editing their record, answering a support question, or auditing allocations.
**Query params:** `q` (free-text, matches `participant_id`/`email`/`profile.full_name`, case-insensitive), `house` (exact filter), `limit` (default 200, 1–500). No offset.
**Success:**
```json
{
  "count": 3,
  "participants": [{
    "participant_id": "DS23F3001726", "email": "...",
    "profile": {"full_name": "...", "house": "Gir", "...": "..."},
    "mess": {"registered": true, "mess_id": "651...ab2"},
    "accommodation": {"registered": true, "hostel_id": "...", "inside": true},
    "created_at": "...", "updated_at": "...",
    "event_count": 2, "workshop_count": 1
  }]
}
```
`password_hash`, `qr_secrets`, `photo`, `embedding` never included. `events`/`workshops` arrays are collapsed to counts — use the per-event/workshop participation endpoints to see specifics.
**Errors:** `403 "Not authorized"` only — an empty search returns `{"count": 0, "participants": []}`, not an error.
**Side effects:** **This read is itself audited** (`READ_PARTICIPANT_ROSTER`, recording the search terms and result count) — every lookup is traceable to who searched for what.
**Frontend usage:** One search box wired to `q` (searches name/email/id simultaneously), a house dropdown wired to `house`. Since there's no real pagination, show a "showing first N, refine your search" hint when `count === limit`.

### `PATCH /participants/{participant_id}`
**Purpose:** Admin corrects another participant's profile on their behalf (e.g. fixing a misspelled name spotted on the roster) without needing that participant to log in and do it themselves.
**Body (all optional):** `full_name, house, gender, phone, mess_preference, country, state, city, address, program, course_stage, emergency_contact`. `house`/`gender`/`program`/`course_stage` validated against closed vocabularies (§22); `mess_preference` here is **not** validated against the enum (unlike the participant's own `PATCH /profile/complete`) — be careful what you send.
**Cannot be changed here:** `email`, `participant_id`, credentials, or `mess`/`accommodation`/`events`/`workshops` (those are owned by allocation/registration flows that enforce capacity — writing them directly here would bypass those checks).
**Success:** `{ "message": "Participant updated", "profile": {...full current profile...} }` — full profile returned, not just changed fields.
**Errors:** `404 "Participant not found"`; `400 "Nothing to update"` (empty body); `422` for invalid enum values.
**Frontend usage:** "Edit Participant" form pre-populated from a roster row. Use selects (not free text) for the four validated fields. Treat "Nothing to update" as a no-op you should prevent client-side (disable submit if the form is unchanged) rather than surface as an error.

---

## 9. Endpoint Reference — Events

Registration bookings live on the participant's own document (`participants.events[]`), not the event — keep this in mind when deciding what to fetch and when.

### `POST /events`
**Purpose:** Super Admin publishes a new event with schedule, prize money, team rules, and a custom registration form.
**Body highlights:** `event_type` ∈ `{technical, culturals, sports, others}`; `team: {min, max, house_vs_house_event, allow_single_registration}`; `prize_money: [{position, amount}]`; `registration: {start_time, end_time, allowed}` (end > start); `schedule: [{name, description, start_time, end_time, venue}]` (each round end > start); `registration_fields: [{field_id, label, type, required}]` — this defines the custom form participants fill in when registering.
**Success:** `{ "message": "Event created", "event_id": "<generated>" }`.
**Side effects:** Generates a semantic embedding from `description` (used for matching/search elsewhere); `event_id` and every `round_id` are backend-generated.
**Frontend usage:** Admin-only creation form. `registration_fields` drives a dynamic form renderer on the participant registration screen later — design your field-type components (`text|number|email|phone|url|select|checkbox`) once, reuse for both events and understand they're rendered from server-defined schema, not hardcoded per event.

### `GET /events`
**Purpose:** Authenticated event listing (participants and staff both browse the programme).
**Success:** array of event docs with a computed `registration.is_open` attached (see §5.3) — always trust this field over any client-side date math.
**Frontend usage:** Safe to refetch on navigation; poll only if you want a live "just opened" banner.

### `GET /events/public`
**Purpose:** Unauthenticated brochure for the landing page.
**Success:** same as above through an allow-list projection (`event_team`, `registration_fields`, `announcements` excluded).
**Frontend usage:** Pre-login landing page; switch to `GET /events` post-login for the richer view.

### `PUT /events/{event_id}`
**Purpose:** Super Admin edits an event (partial).
**Errors:** `404 "Event not found"`; `422 "registration.start_time and end_time are required"` / `"registration.end_time must be after start_time"` if a partial `registration` patch would leave the window invalid.
**Side effects:** `registration` patch **merges** onto the stored window (so patching just `allowed` can't accidentally blank the dates); regenerates embedding if `description` changed.
**Frontend usage:** Build the edit form to send only changed fields — merging means you don't need to resend the whole `registration` object just to toggle `allowed`.

### `DELETE /events/{event_id}`
**Purpose:** Permanently cancel/remove an event.
**Errors:** `404 "Event not found"`.
**Side effects:** Cascades — removes every participant's registration for this event. **Irreversible.**
**Frontend usage:** Strong confirmation dialog naming the fact that all registrations for the event will be wiped.

### `POST /events/{event_id}/team`
**Purpose:** Staff the event with a head/member/volunteer.
**Body:** `{ "user_id": "<existing staff paradox_id>", "role": "event_head"|"member"|"volunteer" }`
**Errors:** `404 "Event not found"`; `404 "user_id must reference an existing backend_teams member"`; `409 "Already on this event's team; use PATCH to change their role"`; `409 "user_id is already on the team of event {other_event_id}; a person may be on only one event's team"` — **this rule is global across all events**, not just this one.
**Frontend usage:** Staff picker should warn/disable if a candidate is already on another event's team — check via a pre-fetch or just surface the 409 clearly ("already assigned to {other event}").

### `PATCH /events/{event_id}/team/{team_user_id}`
**Purpose:** Change an existing team member's role in place.
**Body:** `{ "role": "event_head"|"member"|"volunteer" }`
**Errors:** `404 "Event not found"`; `404 "user_id is not on this event's team"`.

### `DELETE /events/{event_id}/team/{team_user_id}`
**Purpose:** Stand down staff — also frees them to join a different event's team (since the 1-event rule is global).

### `POST /events/{event_id}/register`
**Purpose:** Participant signs up — solo, creating a team, or joining one.
**Body (all optional):** `team_name` (create, becomes leader) **XOR** `team_id` (join, becomes member) — sending both is a validation error; `registration_data` (answers to the event's custom `registration_fields`).
**Errors:**
| Status | Detail | Cause |
|---|---|---|
| 400 | `This event does not support team registration` | `team_name`/`team_id` given but `team.max <= 1` |
| 404 | `No team found with that team_id for this event` | Bad `team_id` |
| 400 | `This team is already full` | Team at `team.max` |
| 400 | `This event requires team registration; provide team_name to create a team or team_id to join one` | Solo attempt when `allow_single_registration=False` and `team.max > 1` |
| 404 | `Event not found` | bad `event_id` |
| 400 | `Registration is closed for this event` | `registration.is_open` false |
| 409 | `User is already registered for this event.` | duplicate registration |
| 403 | `Event team members cannot register as participants for their own event.` | caller is staff on this event's team (checked via their linked participant account) |
| 422 | `Missing required registration field(s): ...` | one or more `required: true` custom fields not answered |
**Success:** `{ "message": "Registered for event successfully.", "team_role": "leader"|"member", "team_id": "..." (if applicable) }`
**Frontend usage:** For solo registration, POST with an empty/omitted body. For team creation, show the returned `team_id` prominently so the user can share it with teammates. For joining, collect a `team_id` input (e.g. paste a code a teammate shared).

### `PUT /events/{event_id}/register`
**Purpose:** Edit answers to the custom registration form after the fact, without touching team membership.
**Body:** `{ "registration_data": {...} }`
**Errors:** `404 "Event not found"`; `400 "Registration is closed"`; `422` (missing required fields); `404 "Not registered for this event"`.
**Frontend usage:** "Edit my registration answers" form — pre-fill from `GET /events/my_registrations`.

### `DELETE /events/{event_id}/register`
**Purpose:** Cancel a registration.
**Errors:** `404 "Event not found"`; `400 "Registration is closed"` — **note:** you can only deregister while registration is still open; there's no self-service withdrawal after the window closes.
**Frontend usage:** Show/hide the "cancel registration" button based on `registration.is_open`, not just "am I registered."

### `GET /events/my_registrations`
**Purpose:** Participant reads back their own registrations (the register response only confirms success, not ongoing state).
**Success:** raw array from the participant's own `events[]` field — **no event name/venue joined in.** Cross-reference with `GET /events` client-side to enrich the display.

### `GET /events/{event_id}/capacity`
**Purpose:** Lightweight, PII-free "how full is this" check any authenticated user can call.
**Success:** `{ "event_id": "...", "registered": <count>, "attended_today": <distinct-participant count for today> }`
**Frontend usage:** Safe to poll every few seconds for a "seats filling up" widget — cheap query, no identity data.

### `GET /events/{event_id}/participation`
**Purpose:** Full roster with names/contact/team info — the organiser's working view.
**Auth:** Super Admin, event team member, UHC staff, or staff whose department matches the event's type.
**Success:** `{ "count", "participants": [...], "event_team": [...], "total_daily_scans": <int, omitted for UHC viewers> }` — UHC viewers additionally get results filtered to their own house only (server-side).
**Errors:** `403 "Not authorized to view participation details"`.
**Frontend usage:** Organiser dashboard roster — fetch on load/refresh, not a stream.

### `POST /events/{event_id}/allocate_teams`
**Purpose:** Once solo registration closes, randomly (or house-vs-house) group unteamed solo registrants into teams honoring `team.min`/`team.max`.
**Auth:** Event Head only (not even Super Admin).
**Errors:** `404 "Event not found"`; if `team.max <= 1`, returns 200 `{"message": "Not a team event"}` rather than erroring.
**Side effects:** Everyone allocated becomes `team_role: "member"` (allocation never assigns a leader — only self-created teams have a leader). Groups smaller than `team.min` are left unteamed and reported. Already-teamed participants are untouched — safe to call more than once; each call only processes the remaining unteamed pool.
**Success:** `{ "message": "Allocated {N} teams" }`
**Frontend usage:** Sequence: registration window closes → Event Head clicks "Allocate Teams" once → review `participation`/roster for anyone left unteamed → use `PUT .../participant_teams/{id}` to hand-fix stragglers.

### `POST /events/{event_id}/scan`
**Purpose:** Gate-scan admission at an event.
**Auth:** Any event team member (any role).
**Body:** `ScanQRRequest {participant_id, data, timestamp}`.
**Response:** **Always HTTP 200** (except for QR-decrypt-level failures and the auth guard) — `{ "name", "email", "is_participating": bool }`. A non-participant scan is not a 4xx; your gate UI must branch on `is_participating` in the body.
**Errors:** `403 "Not authorized to scan for this event"` (not on team); §3.3 QR errors.
**Side effects:** Same participant scanned twice by the *same* volunteer on the *same* day is a silent no-op (deduped); different volunteers scanning the same person are separate log entries.
**Frontend usage:** Build the scanner screen to show a big green "Admit" or red "Not Registered" state driven purely by `is_participating` — don't branch on status code for this particular business outcome.

### `GET /events/{event_id}/my_daily_scans`
**Purpose:** A volunteer's own personal admit tally for the day (motivational/workload display).
**Success:** `{ "daily_unique_scans": <int> }` — counts scan rows by this specific volunteer today (not distinct participants — different from `capacity`'s `attended_today`, which does dedupe by participant).
**Errors:** `403 "Not authorized"` if not on the team.

### `GET /events/{event_id}/logs`
**Purpose:** Super Admin's full historical scan audit trail for the event.
**Success:** `{ "logs": [...] }`, newest first.
**Errors:** `403`/`404` as elsewhere.

### `PUT /events/{event_id}/participant_teams/{participant_id}`
**Purpose:** Event Head hand-corrects a participant's team/role after allocation (fix stragglers, promote/demote leader, move between teams).
**Auth:** Event Head only.
**Body:** `{ "team_id": "optional, null clears it", "team_role": "leader"|"member" (optional) }` — at least one field must be present in the JSON (explicit `null` counts as present; omission does not).
**Errors:**
| Status | Detail | Cause |
|---|---|---|
| 400 | `Provide team_id or team_role to update` | Empty body |
| 400 | `A participant with no team cannot hold the team leader role` | Clearing/leaving `team_id` null while requesting `team_role: "leader"` |
| 400 | `This event does not support team registration` | `team.max <= 1` |
| 400 | `This team is already full` | Moving into a team already at `team.max` |
| 404 | `Event not found` / `Participant not registered for this event` | bad ids |
**Frontend usage:** Build this as the "fix" action in the post-allocation review screen — send only the field(s) actually being changed; to remove someone from a team send `{"team_id": null}` explicitly (this also auto-forces their role to `"member"` server-side).

### `POST /events/{event_id}/announcements`
**Purpose:** Broadcast a message to everyone registered (e.g. "Round 2 starting in Hall B").
**Auth:** Event Head or Super Admin only — ordinary team members/volunteers **cannot** post.
**Body:** `{ "message": "...", "priority": "low"|"mid"|"high" }` (priority defaults to `"mid"`).
**Errors:** `403 "Only the Event Head can post announcements for this event"`.
**Success:** `{ "message": "Announcement published", "announcement": {announcement_id, message, priority, created_by, created_at} }`

### `GET /events/{event_id}/announcements`
**Purpose:** Poll-based read of announcement history (alternative to the SSE stream, e.g. for the initial page load before you open the stream).
**Auth:** Super Admin, event team member, or a participant actually registered for the event.
**Success:** array, newest first.

### `GET /events/{event_id}/announcements/stream`
See §18 for full SSE guidance. **Requires Bearer auth** — cannot use the native `EventSource` API; use `fetch` + `ReadableStream` or a library like `@microsoft/fetch-event-source`.

---

## 10. Endpoint Reference — Workshop Slots

The day/shift time-blocks (`D1S1`, `D2S2`, ...) workshops schedule against. Editing a slot's start time cascades to every workshop in it.

### `POST /workshop-slots`
**Auth:** Super Admin. **Body:** `{ "slot_id": "D1S1" (regex ^D\d+S\d+$), "start_time", "end_time" }` (end > start).
**Errors:** `400 "A slot with this slot_id already exists"`.

### `GET /workshop-slots`
**Auth:** Public. **Success:** `[{slot_id, start_time, end_time, created_at, updated_at}]`. Use to populate slot dropdowns even on unauthenticated screens.

### `PUT /workshop-slots/{slot_id}`
**Auth:** Super Admin. **Errors:** `404 "Workshop slot not found"`; `400 "Nothing to update"`.
**Side effects:** ⚠️ If `start_time` changes, **every workshop in this slot has its `start_time` updated to match** — which shifts their scan windows immediately. **Frontend usage:** Warn the admin explicitly before submitting: "this will shift the scan window for every workshop in this slot; volunteers currently scanning may see window errors."
**Success:** `{ "message": "Workshop slot updated", "workshops_updated": <count> }`

### `DELETE /workshop-slots/{slot_id}`
**Auth:** Super Admin. **Errors:** `404 "Workshop slot not found"`.
**Side effects:** ⚠️ The single most destructive operation in this API — deletes the slot **and every workshop scheduled in it**, and pulls those workshops out of every participant's bookings. **Frontend usage:** Show a strong confirmation naming that this deletes workshops, not just a time block. There's no dry-run — the exact count is only known after the call returns (`workshops_deleted`).

---

## 11. Endpoint Reference — Workshops

`SCAN_TYPES = {"pre-registered", "on-spot"}` are the only values the attendance scan endpoint accepts as `scan_type`; `"changes"` is a third window that exists only for the manual-correction PATCH route.

### `POST /workshops`
**Auth:** Super Admin. **Body:** `{ slot_id (must exist), name, description, venue, capacity>0, instructions, registration_start, registration_end (end>start), registration_open=true }`
**Errors:** `404 "Workshop slot not found. Create it via POST /workshop-slots first."`
**Side effects:** `start_time` is copied from the slot at creation (never client-supplied); generates a semantic embedding from `description`.
**Success:** `{ "message": "Workshop created", "workshop_id": "<generated>" }`

### `GET /workshops`
**Auth:** Any authenticated user. Non-admins have `workshop_team` stripped from the response.

### `GET /workshops/public`
**Auth:** Public. Allow-list projection, never includes `workshop_team`.

### `GET /workshops/my_registrations`
**Auth:** Participant. **Success:** per booking, resolves workshop details plus `booking_type` (`"pre-registered"`|`"on-spot"`) and `attended`. If the workshop was later deleted, returns a stub with `null` details but preserves `slot_id`/`booking_type`/`attended` — so slot-clash logic in your UI can still reason about it.

### `PUT /workshops/{workshop_id}`
**Auth:** Super Admin. **Body (all optional):** `name, description, venue, capacity, instructions, registration_start, registration_end, registration_open`. **`slot_id` and `start_time` are not editable here** — only via the workshop-slots cascade.
**Errors:** `403 "Only Super Admins can edit workshops"`; `404 "Workshop not found"`.
**Side effects:** If `registration_end` changes, the system's lazy auto-close flag resets — so pushing the deadline later re-opens registration eligibility for the new date without you needing to also flip `registration_open` manually.

### `DELETE /workshops/{workshop_id}`
**Auth:** Super Admin. **Errors:** `404 "Workshop not found"`.
**Side effects:** Removes the workshop from every participant's bookings, including anyone marked `attended` (their attendance record is discarded from the participant doc, though the underlying `workshop_logs` rows survive).

### `POST /workshops/{workshop_id}/volunteers`
**Auth:** Super Admin. **Body:** `{ "user_id": "...", "role": "workshop_volunteer", "attendance": true }`
**Errors:** `404 "Workshop not found"`; `409 "Volunteer already assigned to this workshop"`.

### `PUT /workshops/{workshop_id}/volunteers/{user_id}/toggle_scan`
**Auth:** Super Admin. **Query param:** `attendance: bool` (required — the new scanning-enabled state, sent as a query string, not body).
**Errors:** `404 "Workshop not found"`; `404 "That member is not on this workshop's team"`.
**Frontend usage:** e.g. `PUT /workshops/WKSP111/volunteers/VLWK2222/toggle_scan?attendance=false`

### `GET /workshops/{workshop_id}/logs`
**Auth:** Super Admin. **Success:** `{ "logs": [...] }`.

### `POST /workshops/{workshop_id}/register`
**Purpose:** Pre-book a seat ahead of time.
**Auth:** Participant.
**Errors (checked in this order):**
| Status | Detail | Cause |
|---|---|---|
| 404 | `Workshop not found` | bad id |
| 400 | `Registration is closed for this workshop` | `registration_open` false (manually or auto-closed) |
| 400 | `Workshop is full` | `registration_count >= capacity` |
| 400 | `Already registered for this workshop` | exact duplicate |
| 400 | `Already registered for another workshop in this time slot` | same `slot_id`, different workshop — **a participant can only hold one booking per time slot** |
| 400 | `Failed to register. Workshop might have just filled up.` | lost a concurrent capacity race |
**Side effects:** Capacity is enforced with an atomic conditional update (`registration_count < capacity`) — safe under concurrent registration attempts, no overbooking.
**Success:** `{ "message": "Successfully registered for workshop" }`
**Frontend usage:** On the "slot clash" error, guide the user to their `my_registrations` to see what they're already booked into for that slot. On the capacity race error, refetch the live seat count from the SSE stream (§18) before letting them retry.

### `GET /workshops/{workshop_id}/seats/stream`
**Auth:** Public, no auth at all. See §18 — use native `EventSource`, polls every 2s, no heartbeat, no resumability.

### `POST /workshops/{workshop_id}/attendance?scan_type=pre-registered|on-spot`
**Purpose:** Door-scan a participant into a specific workshop session.
**Auth:** Workshop team member whose own `attendance` flag is `True`.
**Query param:** `scan_type` (default `"pre-registered"`) — validated **first**, before anything else; invalid values get a clean `400 "Invalid scan_type"` rather than a server error.
**Body:** `ScanQRRequest {participant_id, data, timestamp}`.
**Time window:** see §5.1.
**Errors:**
| Status | Detail | Cause |
|---|---|---|
| 400 | `Invalid scan_type` | not `pre-registered` or `on-spot` |
| 404 | `Workshop not found` | |
| 403 | `Not authorized to scan for this workshop` | not on team |
| 403 | `Scanning disabled for this volunteer` | on team but `attendance=False` |
| 403 | window errors (§5.1) | outside the time window |
| 400 | `Participant not pre-registered for this workshop` | (`pre-registered` branch) no matching booking, booking is for a different workshop in the slot, or booking type is `on-spot` |
| 400 | `Max on-spot capacity (10%) reached` | (`on-spot` branch) walk-in cap `capacity * 0.10` reached |
| 400 | `Participant already marked present for another workshop in this slot` | cross-workshop slot conflict |
| §3.3 QR errors | | |
**Success:** `{ "message": "Pre-registered attendee marked present" }` / `{ "message": "On-spot registration successful and marked present" }` / `{ "message": "Attendee already marked present" }` (idempotent re-scan).
**⚠️ Side effect to know:** an `on-spot` scan for someone who was pre-registered for a **different** workshop in the same time slot **releases their original booking and gives the seat back** — walking a participant in as an on-spot attendee for workshop B silently cancels their pre-registration for workshop A in the same slot. Make this consequence visible in the scanner UI before confirming an on-spot scan for someone who might be pre-registered elsewhere.
**Frontend usage:** Two distinct volunteer-facing buttons/modes ("Scan Pre-Registered" vs "Register Walk-in") rather than one generic scan button, since the failure semantics and recovery actions differ. On a window-closed error, tell the volunteer to use the manual-correction flow (below) instead of retrying.

### `GET /workshops/{workshop_id}/participation`
**Purpose:** Organiser roster with academic-level breakdown, to gauge interest by student level.
**Auth:** Super Admin, or any workshop team member (attendance toggle doesn't gate this read).
**Success:** includes `attended_count`, `absent_count`, `on_spot_count`, and per-participant `academic_level`/`degree`/`entry_year` derived fields alongside the basics.

### `PATCH /workshops/{workshop_id}/participants/{participant_id}`
**Purpose:** Manual correction for a mis-scan (dead phone battery, cracked QR, expired code while queued).
**Auth:** Super Admin, or a workshop team member with their own `attendance=True`.
**Body:** `{ "attended": bool (optional), "booking_type": "pre-registered"|"on-spot" (optional) }` — at least one required.
**Time window:** `"changes"` window — opens exactly at `start_time`, closes 30 min after, **applies even to Super Admins**.
**Errors:** `404 "Workshop not found"`; `403 "Not authorized to update this workshop's participants"`; `403 "Scanning disabled for this volunteer"`; `400 "Nothing to update"`; `400 "booking_type must be 'pre-registered' or 'on-spot'"`; `404 "Participant not found"`; `404 "Participant is not registered for this workshop"`.
**Idempotency:** If the requested values already match current state, returns `{ "message": "No change", "participant_id": ... }` with no write.
**Success (real change):** `{ "message": "Participant record updated", "participant_id": ..., "changes": {...} }`
**Frontend usage:** This is the "fix a scan" screen for the front desk — a searchable participant lookup within the workshop roster, with toggles for attended/booking_type, gated to only be usable inside the "changes" window.

### `DELETE /workshops/{workshop_id}/volunteers/{user_id}`
**Auth:** Super Admin. **Errors:** `404 "Workshop not found"`; `404 "That member is not on this workshop's team"`.

---

## 12. Endpoint Reference — Mess Halls

`MESS_FEE = ₹1200` (fixed, never client-supplied). `MEAL_SLOTS = (breakfast, lunch, dinner)`. `SCAN_WINDOW = ±15 min`.

### `POST /mess`
**Auth:** Super Admin. **Body:** `{ mess_id (caller-chosen, must be unique), name, capacity>0, type (∈ MESS_PREFERENCE_TYPES) }`
**Errors:** `409 "A mess with this mess_id already exists"`.
**Frontend usage:** Since `mess_id` is client-chosen, validate/suggest uniqueness client-side before submit.

### `GET /mess`
**Auth:** Any authenticated user. **Success:** array of hall docs.

### `POST /mess/register`
**Purpose:** Participant opts in to a meal plan (before allocation runs).
**Auth:** Participant. **Body:** none.
**Success:** `{ "message": "Meal plan requested" }` — idempotent, safe to call twice.
**Errors:** `400 "Only participants can request a meal plan"`; `400 "Mess already allotted"` (can't re-request after allocation).
**Frontend usage:** A toggle/button on the participant's onboarding or profile screen; disable once `GET /mess/my_mess` shows an `allotted_mess`.

### `DELETE /mess/register`
**Purpose:** Withdraw the request before allocation.
**Auth:** Participant. **Errors:** `400 "Only participants can cancel a meal plan"`; `400 "Mess already allotted"` (can't self-cancel post-allocation — that requires an admin).
**Success:** `{ "message": "Meal plan request withdrawn" }`

### `PUT /mess/{mess_id}`
**Auth:** Super Admin. **Body (all optional):** `name, capacity>0, type`.
**Errors:** `404 "Mess not found"`; `400 "Nothing to update"`.
**Side effects:** ⚠️ Reducing `capacity` below current occupancy is **allowed, not blocked** (only logged as a warning server-side) — the frontend should show its own confirmation if the admin is setting capacity below the currently-seated count. Changing `type` silently re-purposes the hall's diet for everyone already seated in it.

### `DELETE /mess/{mess_id}`
**Auth:** Super Admin. **Errors:** `404 "Mess not found"`.
**Side effects:** ⚠️ Highly destructive — releases every seated participant **and wipes their entire meal-scan history for that hall**. Strong confirmation dialog required.

### `PUT /mess/{mess_id}/menu`
**Purpose:** Publish/replace a hall's full day-by-day meal schedule (times + menu text), which is what scan windows are computed against.
**Auth:** Super Admin, or a member of that hall's `mess_team`.
**Body:** `{ "menu": { "day_1": { "breakfast": {start_time, end_time, menu}, "lunch": {...}, "dinner": {...} }, "day_2": {...} } }` — day keys must match `^day_[1-9]\d*$`; each slot needs `end_time > start_time` and non-blank `menu` text.
**Errors:** `403 "Not authorized to edit this menu"`; `404 "Mess not found"`; `422` for bad keys/times.
**Side effects:** This is a **full replacement**, not a patch — omitting a previously-defined slot removes it. If you remove a slot participants already have scan markers against, their `my_mess` view for that slot simply disappears (no error, but their history reference goes stale). ⚠️ **Always submit the complete day/slot map, not a partial one.**
**Frontend usage:** Menu editor screen should load the full current menu, let the admin edit, and PUT the whole thing back — never construct a partial payload.

### `POST /mess/{mess_id}/team`
**Auth:** Super Admin. **Body:** `{ user_id, role, name, phone }`. `role` ∈ `{"volunteer", "other"}` grants scanning rights (`logging=True`); any other value silently creates a non-scanning team member.
**Errors:** `404 "Mess not found"`; `409 "Team member already assigned to this mess"`.
**Frontend usage:** Constrain the `role` input to a dropdown of known values — free text risks silently creating a team member who can never scan, with no error to tell you.

### `PUT /mess/{mess_id}/team/{team_user_id}/toggle_scan?logging=<bool>`
**Auth:** Super Admin. **Errors:** `404 "Mess not found"`; `404 "user_id is not on this mess's team"`.
**Frontend usage:** Toggle switch on the team roster; `logging` is a query param, not a body field.

### `POST /mess/allocate`
**Purpose:** Bulk-seats every `registered && unplaced` participant into a hall matching their diet preference (defaults to `"veg"` if unset).
**Auth:** Super Admin. **Body:** none.
**Success:** `{ "message": "Allocated {N} participants to messes" }`
**Frontend usage:** "Run Allocation" button on the admin dashboard. Safe to re-run — only touches still-unplaced registrants. Follow up by checking `/mess/{id}/statistics` per hall to review placement, since the response gives only a total count, not a breakdown.

### `POST /mess/pay`
**Purpose:** Mock payment for the fixed mess fee (no real payment gateway).
**Auth:** Participant. **Body:** `{ "method": "upi"|"card"|"netbanking" (optional, defaults "upi") }` — amount is always the server-fixed `MESS_FEE`, never client-supplied.
**Success:** `{ "paid": true, "transaction_id": "PDX-MESS-XXXXXXXX", "amount": 1200, "method": "...", "paid_at": "..." }`
**Errors:** `400 "Only participants can pay the mess fee"`.
**⚠️ Not idempotent:** calling this twice **overwrites** the stored payment record — the previous transaction id is lost from the participant's document (only recoverable from logs). **Frontend usage:** After a successful payment, disable the "pay" button/hide the form by checking `my_mess`/profile for an existing payment record — the backend will not stop you from double-charging in the UI sense.

### `GET /mess/my_mess`
**Purpose:** The screen a participant checks for "what/when can I eat, and have I already scanned in."
**Auth:** Participant. **Success:** `{ "allotted_mess", "mess_details", "slots": [{day, slot, start_time, end_time, menu, scanned, scanned_at}] }` — `slots` is computed live by joining the participant's scan history onto the hall's **current** menu (a removed slot disappears; a newly added one appears unscanned).
**Frontend usage:** Refetch after allocation runs, after any scan, and after any menu update — all three change what this returns.

### `POST /mess/{mess_id}/scan`
**Purpose:** Volunteer-facing QR scan at the mess counter — marks "this person ate this meal, this day."
**Auth:** Staff on that hall's `mess_team` **and** `logging=True`.
**Query params:** `slot` (∈ `MEAL_SLOTS`), `day` (int ≥ 1). **Body:** `ScanQRRequest {participant_id, data, timestamp}`.
**Errors (exact, in likely check order):**
| Status | Detail | Cause |
|---|---|---|
| 400 | `slot must be one of ('breakfast', 'lunch', 'dinner')` | bad query param |
| 400 | `day must be a positive integer` | `day < 1` |
| 404 | `Mess not found` | |
| 403 | `Not authorized to scan for this mess` | not on team |
| 403 | `Scanning disabled for you` | on team but `logging=False` |
| 400 | `No {slot} scheduled for day {day}` | no such slot on current menu |
| 403 | `Scanning window not yet open for this slot` / `Scanning window closed for this slot` | outside ±15 min |
| §3.3 QR errors | | |
| 400 | `Participant not allotted to this mess` | wrong hall for this participant |
| 400 | `Already logged in for {slot} on day {day}` | duplicate scan |
**Frontend usage:** Present `slot`/`day` as fixed selectors set once per counter/shift (not re-picked per scan), then loop QR scans continuously. Show the exact returned error string to the volunteer — each maps to a distinct, actionable next step at the counter (wrong hall vs already scanned vs too early).

### `GET /mess/{mess_id}/statistics`
**Auth:** Super Admin. **Success:** `{ total_allocated, capacity, allotted_participants: [{participant_id, name, email, phone}] }`
**Errors:** `404 "Mess not found"`.
**Frontend usage:** Per-hall admin detail view; this read is itself audited, so poll on-demand rather than continuously.

### `GET /mess/{mess_id}`
**Auth:** Any authenticated user. **Success:** full hall document (menu, team, capacity, type). **Errors:** `404 "Mess not found"`.

---

## 13. Endpoint Reference — Hostels

`HOSTEL_FEE = ₹900` (fixed). `GENDERS = {male, female}`. `HOSTEL_ROLES = {hostel_volunteer, guard}`.

### `POST /hostels`
**Auth:** Super Admin. **Body:** `{ name, capacity>0, gender ∈ {male,female}, sharing>0 (max per room), num_rooms>0 }` — validated that `num_rooms * sharing >= capacity`.
**Success:** `{ "message": "Hostel created", "hostel_id": "<generated>" }`
**⚠️ Note:** `hostel_id` generation is in-memory (not DB-reconciled) — see §21 for the collision risk after a server restart.

### `GET /hostels`
**Auth:** Any authenticated user. **Success:** array of hostel docs.

### `POST /hostels/{hostel_id}/team`
**Auth:** Super Admin. **Body:** `{ user_id (must be an existing backend_teams member with role "other"), role ∈ {hostel_volunteer, guard}, attendance=true }`
**Errors:** `404 "Hostel not found"`; `404 "user_id must reference an existing backend_teams member with role 'other'"`; `409 "Team member already assigned to this hostel"`.
**Frontend usage:** Pre-filter the `user_id` picker to staff with `role: "other"` to avoid the 404 — other roles are rejected here even if they exist.

### `PUT /hostels/{hostel_id}/team/{team_user_id}/toggle_scan?attendance=<bool>`
**Auth:** Super Admin. **Errors:** `404 "Hostel not found"`; `404 "user_id is not on this hostel's team"`.

### `POST /hostels/allocate`
**Purpose:** Bulk-assign `registered && unplaced` participants to rooms, grouped strictly by gender.
**Auth:** Super Admin. **Success:** `{ "message": "Allocated {N} participants to hostels" }`
**Frontend usage:** Same pattern as mess allocation — "Run Allocation" button, re-runnable safely, review results via per-block statistics afterward.

### `POST /hostels/pay`
Same mock-payment pattern as mess (§12), fixed `HOSTEL_FEE=900`, transaction id prefixed `PDX-HOSTEL-...`. Same non-idempotent overwrite caveat applies — gate resubmission client-side.

### `POST /hostels/register` / `DELETE /hostels/register`
Same request-then-cancel pattern as mess register (§12): `400 "Only participants can request accommodation"` / `"...cancel accommodation"`; `400 "Accommodation already allotted"` blocks both after allocation.

### `GET /hostels/my_hostel`
**Purpose:** Participant's accommodation status screen — where they're staying, whether they're currently inside, and who to contact.
**Auth:** Participant. **Success:**
```json
{ "assigned_hostel": "...", "room": "101", "inside": true, "arrival": "...", "departure": null, "registered": true, "volunteers": [{"name","email","phone","role"}] }
```
**Frontend usage:** Refetch after allocation and after any entry/exit scan to keep `inside`/`arrival`/`departure` current. `volunteers` gives contact info for the block's duty team — surface this as "who to contact" on the screen.

### `POST /hostels/{hostel_id}/scan?action=entry|exit|permanent_exit`
**Purpose:** The safety-critical gate scan. `inside` answers "who is in this building right now" (evacuation-relevant); `arrival`/`departure` answer "was this student ever here."
**Auth:** Staff on that hostel's `hostel_team` with `attendance=True`.
**Body:** `ScanQRRequest {participant_id, data, timestamp}`.
**State machine (exact errors):**
| Status | Detail | Cause |
|---|---|---|
| 400 | `Invalid action. Must be 'entry', 'exit', or 'permanent_exit'` | bad query param |
| 404 | `Hostel not found` | |
| 403 | `Not authorized to scan for this hostel` | not on team |
| 403 | `Scanning disabled for you` | `attendance=False` |
| §3.3 QR errors | | |
| 400 | `Participant not allotted to this hostel` | wrong block |
| 400 | `Participant has permanently departed and cannot re-enter` | `entry` after `permanent_exit` |
| 400 | `Participant is already inside` | duplicate `entry` |
| 400 | `Participant is already outside` | duplicate `exit` |
| 400 | `Participant has already permanently departed` | duplicate `permanent_exit` |
| 400 | `Participant must be inside the hostel to mark a permanent exit` | `permanent_exit` while `inside=False` |
**Side effects:** `entry` stamps `arrival` only the **first time ever** (never overwritten on subsequent entries); `permanent_exit` is **terminal** — blocks all future entry.
**Frontend usage:** Present `action` as three explicit buttons (Entry / Exit / Permanent Exit), flagging "Permanent Exit" visibly as irreversible/final departure in the UI copy — not a free-text field. Show the exact error string so a guard can distinguish "double-scan" from "data/process issue requiring escalation."

### `DELETE /hostels/{hostel_id}`
**Auth:** Super Admin. **Success:** `{ "message": "Hostel deleted", "participants_reset": <count> }`
**Errors:** `404 "Hostel not found"`.
**Side effects:** ⚠️ Cascades — resets every resident's accommodation state to unplaced (but leaves `registered` intact so they're eligible for a future allocation run). This erases their arrival/departure history from the participant doc (only recoverable via audit logs). Deleting a block with residents still marked `inside` is specifically flagged as dangerous server-side — mirror that with a strong confirmation.

### `GET /hostels/{hostel_id}/statistics`
**Auth:** Super Admin. **Success:** `{ total_allocated, capacity, current_occupancy (lifetime, never decreases), currently_inside (live), allotted_participants: [{participant_id, name, email, room}] }`
**⚠️ Frontend usage:** Use `currently_inside`, **not** `current_occupancy`, for any "who's in the building right now" display (e.g. an evacuation headcount) — `current_occupancy` is a lifetime counter that never goes back down.

### `GET /hostels/{hostel_id}`
**Auth:** Any authenticated user. **Success:** full hostel doc (rooms, occupants, team). **Errors:** `404 "Hostel not found"`.

---

## 14. Endpoint Reference — Queries

Unlike Issues (§15), queries are **not scoped to a hostel/mess team** — any category routes to one flat query-resolution roster managed by Super Admins.

### `POST /queries`
**Purpose:** Participant asks a question or raises a concern about a hostel, mess, event, workshop, or something general.
**Auth:** Participant. **Body:** `{ category ∈ {hostel, mess, event, workshop, general}, subject, body, target_id (required unless category="general", forbidden if it is) }`
**Errors:** `400 "Invalid category. Must be one of: ..."`; `400 "A general query cannot name a target_id; choose the category that owns it instead"`; `400 "A {category} query must name a {category}"` (missing target_id for a non-general category); `404 "No {category} found with id {target_id}"`.
**Success:** `{ "message": "Query raised", "query_id": "QRY...", "query": {...full doc...} }`
**Frontend usage:** Generic "Ask a question / raise a concern" form. The category dropdown should drive whether a target picker (hostel/event/workshop/mess selector) appears — hide it entirely for "general."

### `GET /queries/mine`
**Auth:** Participant. **Success:** array of full query docs including `replies`, newest first.
**Frontend usage:** Render as a support-ticket thread; `replies[].author_type` (`"staff"`|`"participant"`) drives message bubble styling.

### `GET /queries`
**Purpose:** The shared staff dashboard of every query fest-wide.
**Auth:** Super Admin or query-team member — anyone else gets a flat 403 (no per-category fallback).
**Query params:** `status` (optional, ∈ `{open, assigned, resolved}`), `category` (optional filter), `limit` (default 100, 1–500).
**Errors:** `403 "Not authorized to access queries"`; `400 "Invalid status. Must be one of: assigned, open, resolved"`.
**Frontend usage:** There's no server-side "my assigned" filter — filter client-side on `assigned_to` if you want a personal queue view.

### `PATCH /queries/{query_id}`
**Purpose:** Claim, reassign, or resolve a query.
**Auth:** Super Admin or query-team member. **Body:** `{ status, assigned_team, assigned_to }` (all optional, but `assigned_to: null` explicitly clears it — must be present in the JSON, not omitted, to have that effect).
**Errors:** `404 "Query not found"`; `400 "Invalid status..."`; `400 "Nothing to update"`.
**Side effects:** Setting `assigned_to` to a non-null value auto-sets `status: "assigned"` unless you also explicitly send a `status` in the same call. Resolving stamps `resolved_at` (never cleared on reopen).
**Frontend usage:** "Claim" button → PATCH `{"assigned_to": "<my id>"}` only (status flips automatically). "Release" button → PATCH `{"assigned_to": null}` explicitly.

### `POST /queries/{query_id}/replies`
**Purpose:** The actual conversation thread between participant and staff.
**Auth:** Either token type — staff must be Super Admin/query-team member, participant must be the query's own author.
**Body:** `{ "body": "..." }`
**Errors:** `403 "Not authorized to handle this query"` (staff not on team); `404 "Query not found"` (used for **both** "doesn't exist" and "exists but isn't yours," deliberately indistinguishable to prevent enumeration).
**Success:** `{ "message": "Reply added", "reply": {author_id, author_type, author_name, body, timestamp} }` — staff `author_name` prefers designation, then name, then role, then falls back to `"Fest team"`.
**Frontend usage:** The compose box on both the participant's query-detail screen and the staff handling screen. Treat any 404 here as "unavailable to you" — don't try to distinguish causes in your copy.

### `POST /queries/team` / `GET /queries/team` / `DELETE /queries/team/{user_id}`
**Auth:** Super Admin only for all three (`403 "Only Super Admins can manage the query team"`). Add/list/remove staff from the query-resolution roster. Add requires an existing `backend_teams` `user_id` (`404` otherwise); duplicate add is `400 "This staff member is already on the query team"`; remove is `404 "user_id is not on the query team"` if absent.
**Frontend usage:** Super Admin settings screen for staffing the "query desk" — pick from existing staff, this doesn't create new accounts.

---

## 15. Endpoint Reference — Issues

Unlike Queries, Issues **are** scoped to a specific hostel/mess and its own duty team — this is specifically for physical fault reports ("the tap is broken"), not general questions.

### `POST /issues`
**Purpose:** Participant reports a broken facility in their own hostel or mess.
**Auth:** Participant. **Body:** `{ facility_type ∈ {hostel, mess}, facility_id (must be the participant's own facility), category (type-specific set — hostel: water/electricity/cleanliness/furniture/internet/safety/noise/other; mess: food_quality/hygiene/service/timing/dietary/other), subject (3–120 chars), body (3–2000 chars), room (optional, defaults to their allotted room) }`
**Errors:** `400 "facility_type must be 'hostel' or 'mess'"`; `400 "category must be one of: ..."`; `404 "Hostel not found"`/`"Mess not found"`; `403 "You are not allotted to this hostel"`/`"...mess"` (trying to file against a facility that isn't theirs); `400 "You already have 10 unresolved reports for this facility. Wait for one to be resolved before filing another."` (abuse cap, `MAX_OPEN_PER_FACILITY=10`).
**Success:** `{ "message": "Issue reported", "issue_id": "ISS...", "status": "open" }`
**Frontend usage:** "Report an issue" form on the participant's hostel/mess screen. Prefill `room` from their profile so most users never type it. Show remaining slots or disable submission as they approach the 10-open cap.

### `GET /issues/mine`
**Auth:** Participant. **Success:** `{ "count", "issues": [...] }` — each issue includes an `updates` timeline (`{at, status, note}`) but **deliberately omits who wrote each update** (no staff identity shown to the reporter).
**Frontend usage:** "My Issues" tracker — render `updates` as a status timeline.

### `GET /issues`
**Purpose:** The facility duty team's queue.
**Auth:** Staff — Super Admin sees everything; others see only facilities where they're on the `hostel_team`/`mess_team`. Staff on no duty team get an **empty list (200)**, not a 403.
**Query params:** `status` (∈ `{open, in_progress, resolved}`, or `400` if invalid), `facility_type`, `facility_id`, `limit` (default 100, 1–500).
**Success:** same as `/mine` but each issue additionally includes `reporter: {participant_id, name, phone, room}` and `updates[].by` (which staffer wrote it).
**Frontend usage:** Build the staff dashboard with status filter chips. An empty list means "you have no facility duty right now" — display that message, not an error state.

### `PATCH /issues/{issue_id}`
**Purpose:** Duty team resolves/annotates a report.
**Auth:** Staff on that facility's team, or Super Admin.
**Body:** `{ status (optional, ∈ STATUSES), note (optional, ≤2000 chars) }` — at least one required.
**Errors:** `404 "Issue not found"` (checked first); `403 "Not authorized to answer for this facility"`; `400 "Provide a status, a note, or both"`; `400 "status must be one of: ..."`.
**Success:** `{ "message": "Issue updated", "issue_id": ..., "status": <resulting status> }`
**Side effects:** Every update is **pushed** onto the history (never overwritten) — the full timeline is preserved.
**Frontend usage:** Support "add a note without changing status" as a distinct first-class action (e.g. "part ordered, will fix tomorrow") — don't force every update through a status change. Render the growing timeline identically to how `/mine` shows it to the reporter, minus the `by` field there.

---

## 16. Endpoint Reference — Audit Logs

Super Admin only, everywhere in this router (`403 "Only Super Admins can view audit logs"`). This is the trust/accountability layer over every audited action across the whole system.

### `GET /audit-logs/summary`
**Purpose:** Exact dashboard totals without the row cap the plain list endpoint has, plus a special meal-count derivation.
**Query params:** `target_id`, `action` (both optional exact filters), `since`/`until` (optional ISO 8601, half-open window — `since` inclusive, `until` exclusive).
**Success:** `{ total, by_action: {action: count}, distinct_actors, actor_ids, meals: <summary or null>, window: {since, until} }`. `meals` is populated **only** when `action` is unset or exactly `"MESS_SCAN"`; otherwise `null`. Meal summary: `{ scans, meals_served, duplicate_scans, unique_diners, unclassified, by_slot: {breakfast, lunch, dinner}, by_day: {...} }` — deduplicated by `(participant, day, slot)` so a double-scan doesn't inflate "meals served."
**Errors:** `422 "since/until must be an ISO 8601 datetime, e.g. 2026-08-21T00:00:00Z"`.
**Frontend usage:** **Use this endpoint, not the plain list, for any headline number/count widget** — the list endpoint's `limit` cap would silently understate totals if you tried to derive counts from it instead.

### `GET /audit-logs`
**Purpose:** Paginated, filterable, human-readable trail of every audited action.
**Query params:** `limit` (default 100, 1–500), `target_id`, `action`, `since`/`until` (same semantics as summary).
**Success:** array of log rows, newest first, each with a resolved `actor_name` and a `names` map (id → display name) covering every person id referenced anywhere in the entry — **use this map directly instead of resolving ids client-side.**
**Errors:** same 422 as summary.
**Frontend usage:** Both the per-entity "activity log" panel (filter by `target_id`) and the fest-wide trail view use this same endpoint.

---

## 17. Endpoint Reference — Embeddings

### `POST /embeddings`
**Purpose:** A general-purpose proxy to an OpenAI-compatible embeddings API (used for things like preference matching/semantic search elsewhere in the app) so no client needs its own provider credentials.
**Auth:** Any authenticated user (participant or staff), rate-limited.
**Body:** `{ input: str | str[], model (optional), encoding_format ("float"|"base64", optional), dimensions (optional), user (optional) }` — mirrors the OpenAI SDK's params exactly.
**Success:** the raw provider response — `{ data: [{embedding: [...], index, object}], model, object: "list", usage: {...} }`
**Errors:**
| Status | Detail | Cause |
|---|---|---|
| 429, header `Retry-After: <seconds>` | `Rate limit exceeded: at most 1 request per 60s.` | You (keyed by your own user id) already called this within the last 60 seconds — **in-memory per-process, so this can behave inconsistently across multiple backend instances** |
| 502 | `Could not reach the embeddings provider` | Provider connectivity issue (not your fault) |
| provider's own status | provider's own message | The *server's* configured provider API key is wrong — not yours |
**⚠️ Side effect:** the 60-second cooldown clock starts the moment you pass the auth/rate-limit check — **even a call that then fails still consumes your window.**
**Frontend usage:** Treat this strictly as a low-frequency background utility (e.g. compute an embedding once when a profile/preference is saved — never on every keystroke). On 429, read `Retry-After` and back off rather than retrying immediately. Surface 502/5xx as "matching temporarily unavailable," not as a form validation error.

---

## 18. Real-Time Streams (SSE) — Cross-Cutting Notes

This API has **two genuinely different SSE patterns** — don't share client code between them.

### 18.1 `GET /events/{event_id}/announcements/stream`
- **Requires** `Authorization: Bearer` — you **cannot** use the browser's native `EventSource` (it can't set headers). Use `fetch` + `ReadableStream`, or a helper library such as [`@microsoft/fetch-event-source`](https://github.com/Azure/fetch-event-source).
- Implemented as DB polling every 3s server-side (correct across multiple backend workers, not an in-memory pub/sub), with a heartbeat comment every 15s to keep the connection alive.
- **Resumable** via the standard `Last-Event-ID` header — reconnecting won't replay announcements you've already seen. If your last-seen id no longer exists (e.g. you're reconnecting against a different event), the server just resends the full current history rather than showing nothing.
- Guarded by the same `_may_read_announcements` check as the poll endpoint (Super Admin, event team member, or a participant actually registered for the event) — auth errors are ordinary JSON 403/404s returned *before* the stream opens, not stream-level errors.

```ts
// Example using fetch-event-source
import { fetchEventSource } from '@microsoft/fetch-event-source';

fetchEventSource(`${baseUrl}/events/${eventId}/announcements/stream`, {
  headers: { Authorization: `Bearer ${token}` },
  onmessage(ev) {
    const announcement = JSON.parse(ev.data);
    // append to UI
  },
  onerror(err) { /* backoff handled automatically by the library */ },
});
```

### 18.2 `GET /workshops/{workshop_id}/seats/stream`
- **No auth at all** — use the native `EventSource` directly.
- Polls the workshop doc every 2 seconds server-side; emits `{"remaining_seats": N, "capacity": N}` **only when the count actually changes**.
- **No heartbeat, no resumability.** If the workshop is deleted mid-stream, you'll receive `{"error": "Workshop not found"}` and the connection closes.
- ⚠️ Because it's unauthenticated and polls per-connection, be mindful of how many of these you open simultaneously (e.g. don't open one per card in a workshop list — only open it on the single workshop detail/registration page a user is actively viewing).

```ts
const es = new EventSource(`${baseUrl}/workshops/${workshopId}/seats/stream`);
es.onmessage = (ev) => {
  const data = JSON.parse(ev.data);
  if (data.error) { es.close(); return; }
  setSeatsRemaining(data.remaining_seats);
};
```

---

## 19. Role Journeys & Screen Flows

### 19.1 Participant Journey
1. `POST /auth/register` → `POST /auth/login` → check core profile fields are `null` → `PATCH /profile/complete`.
2. Browse `GET /events` / `GET /workshops` — trust `registration.is_open` / `registration_open` fields, never compute locally.
3. Register: `POST /events/{id}/register` (solo, or with `team_name`/`team_id`) and/or `POST /workshops/{id}/register`.
4. Track: `GET /events/my_registrations`, `GET /workshops/my_registrations` (cross-reference with the list endpoints for display details).
5. Mess: `POST /mess/register` → `POST /mess/pay` → wait for admin allocation → `GET /mess/my_mess` to see hall/menu/scan status.
6. Hostel: `POST /hostels/register` → `POST /hostels/pay` → wait for admin allocation → `GET /hostels/my_hostel`.
7. During the fest: show live QR (auto-refresh every 30–45s, §3.2) for gate/counter scans.
8. Support: `POST /queries` for questions, `POST /issues` for physical facility faults — these are two different systems, route the user to the right one based on intent (question vs broken thing).
9. Live updates: open the announcements SSE stream (§18.1) for any event they're registered for while its screen is mounted.

### 19.2 Volunteer/Scanner Journey (events, workshops, mess, hostels)
1. Staff logs in via `POST /auth/admin/login`.
2. Land on a role-appropriate scanner screen based on `department`/team membership.
3. Before scanning works, the volunteer's own `logging`/`attendance` flag must be `True` on the relevant roster — if a volunteer reports "I can't scan," check this flag first (it's a distinct toggle from team membership).
4. Scanner UI captures the raw QR string → decodes to `{participant_id, data, timestamp}` → POSTs to the domain-specific scan endpoint with the mode-specific query param (`slot`+`day` for mess, `action` for hostels, `scan_type` for workshops, none for events).
5. Always render the server's exact error `detail` string to the volunteer — the messages are specifically designed to tell them what to do next (retry, wait, escalate, tell the participant to see the desk).

### 19.3 Event/Workshop Organiser Journey
1. Super Admin creates the event/workshop-slot/workshop.
2. Super Admin staffs it: `POST /events/{id}/team` or `POST /workshops/{id}/volunteers`.
3. Registration window runs; organiser can poll `GET /events/{id}/capacity` for a live count.
4. Window closes → for team events, Event Head calls `POST /events/{id}/allocate_teams` once → reviews `GET /events/{id}/participation` for stragglers → fixes with `PUT .../participant_teams/{id}`.
5. Day-of: volunteers scan; Event Head/Super Admin can post live updates via `POST /events/{id}/announcements`.
6. Post-event: `GET /events/{id}/logs` for the full scan trail.

### 19.4 Super Admin Journey
1. `POST /auth/admin/login`.
2. Staff up the operation: `POST /backend_teams` for each new staff account, `POST /queries/team` for the query desk.
3. Stand up infrastructure: `POST /workshop-slots`, `POST /mess`, `POST /hostels`.
4. After registrations close: `POST /mess/allocate`, `POST /hostels/allocate`.
5. Monitor: `GET /participants/statistics` for the dashboard, `GET /audit-logs/summary` for headline audit numbers, `GET /audit-logs` for the detailed trail.
6. Handle escalations: `GET /issues` and `GET /queries` dashboards.

---

## 20. TypeScript Types & API Client Appendix

### 20.1 Core Types

```ts
interface AuthResponse {
  id: string;
  email: string;
  access_token: string;
  token_type: "participant" | "staff";
  full_name: string | null;
  dob: string | null;
  house: string | null;
  gender: "male" | "female" | null;
  phone: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  address: string | null;
  program: "DS" | "MS" | "AE" | "ES" | null;
  course_stage: "foundational" | "diploma" | "degree" | null;
  photo: string | null;
  public_key?: string;
}

interface StaffAuthResponse {
  id: string;
  email: string;
  access_token: string;
  token_type: "staff";
  role: "super_admin" | "admin" | "other" | "volunteer";
  department: "technical" | "sports" | "culturals" | "uhc" | "hostels" | "mess" | "workshops";
  designation: string;
}

interface Participant {
  participant_id: string;
  email: string;
  profile: Record<string, unknown>;
  mess: { registered: boolean; mess_id?: string };
  accommodation: { hostel_id?: string; room?: string; inside: boolean };
  created_at: string;
  updated_at: string;
  event_count: number;
  workshop_count: number;
}

interface EventRegistrationWindow {
  start_time: string;
  end_time: string;
  allowed: boolean;
  is_open: boolean; // computed server-side, never derive this yourself
}

interface Event {
  event_id: string;
  event_type: "technical" | "culturals" | "sports" | "others";
  name: string;
  description: string;
  registration: EventRegistrationWindow;
  team: { min: number; max: number; house_vs_house_event: boolean; allow_single_registration: boolean };
  schedule: { round_id: string; name: string; start_time: string; end_time: string; venue: string }[];
  registration_fields: { field_id: string; label: string; type: string; required: boolean }[];
}

interface Workshop {
  workshop_id: string;
  slot_id: string;
  name: string;
  venue: string;
  capacity: number;
  registration_count: number;
  registration_open: boolean;
  start_time: string;
  registration_start: string;
  registration_end: string;
}

interface Query {
  query_id: string;
  category: "hostel" | "mess" | "event" | "workshop" | "general";
  target_id: string | null;
  subject: string;
  body: string;
  status: "open" | "assigned" | "resolved";
  assigned_team: string | null;
  assigned_to: string | null;
  replies: QueryReply[];
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

interface QueryReply {
  author_id: string;
  author_type: "participant" | "staff";
  author_name: string;
  body: string;
  timestamp: string;
}

interface Issue {
  issue_id: string;
  facility_type: "hostel" | "mess";
  facility_id: string;
  category: string;
  subject: string;
  body: string;
  room?: string;
  status: "open" | "in_progress" | "resolved";
  created_at: string;
  updated_at: string;
  updates: { at: string; by?: string; status?: string; note?: string }[];
}
```

### 20.2 API Client Skeleton

```ts
class ApiError extends Error {
  constructor(public status: number, public detail: string, public retryAfter?: number) {
    super(detail);
  }
}

class ParadoxClient {
  private token?: string;
  constructor(private baseUrl: string) {}

  setToken(token: string) { this.token = token; }

  private async request<T>(method: string, path: string, opts: { body?: unknown; query?: Record<string, string | number | boolean> } = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (opts.query) for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, String(v));

    const headers: HeadersInit = { "Content-Type": "application/json" };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;

    const res = await fetch(url.toString(), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    if (!res.ok) {
      const retryAfter = res.headers.get("Retry-After");
      let detail = res.statusText;
      try { detail = (await res.json()).detail ?? detail; } catch { /* non-JSON error body */ }
      throw new ApiError(res.status, detail, retryAfter ? Number(retryAfter) : undefined);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  // Auth
  register(email: string, password: string) {
    return this.request<{ message: string; participant_id: string }>("POST", "/auth/register", { body: { email, password } });
  }
  login(email: string, password: string) {
    return this.request<AuthResponse>("POST", "/auth/login", { body: { email, password } });
  }
  adminLogin(email: string, password: string) {
    return this.request<StaffAuthResponse>("POST", "/auth/admin/login", { body: { email, password } });
  }
  completeProfile(data: Record<string, unknown>) {
    return this.request("PATCH", "/profile/complete", { body: data });
  }

  // Events
  listEvents() { return this.request<Event[]>("GET", "/events"); }
  listPublicEvents() { return this.request<Event[]>("GET", "/events/public"); }
  registerForEvent(eventId: string, body?: { team_name?: string; team_id?: string; registration_data?: Record<string, unknown> }) {
    return this.request<{ message: string; team_role: string; team_id?: string }>("POST", `/events/${eventId}/register`, { body });
  }
  myEventRegistrations() { return this.request("GET", "/events/my_registrations"); }

  // Workshops
  listWorkshops() { return this.request<Workshop[]>("GET", "/workshops"); }
  registerForWorkshop(workshopId: string) {
    return this.request<{ message: string }>("POST", `/workshops/${workshopId}/register`);
  }

  // Mess / Hostels
  requestMess() { return this.request<{ message: string }>("POST", "/mess/register"); }
  myMess() { return this.request("GET", "/mess/my_mess"); }
  payMess(method: "upi" | "card" | "netbanking" = "upi") {
    return this.request("POST", "/mess/pay", { body: { method } });
  }

  // Queries / Issues
  raiseQuery(body: { category: string; subject: string; body: string; target_id?: string }) {
    return this.request<{ message: string; query_id: string; query: Query }>("POST", "/queries", { body });
  }
  reportIssue(body: { facility_type: string; facility_id: string; category: string; subject: string; body: string; room?: string }) {
    return this.request<{ message: string; issue_id: string; status: string }>("POST", "/issues", { body });
  }
}
```

### 20.3 Handling Rate Limits (Embeddings)

```ts
async function getEmbeddingWithBackoff(client: ParadoxClient, input: string) {
  try {
    return await client.request("POST", "/embeddings", { body: { input } });
  } catch (e) {
    if (e instanceof ApiError && e.status === 429 && e.retryAfter) {
      await new Promise((r) => setTimeout(r, e.retryAfter! * 1000));
      return client.request("POST", "/embeddings", { body: { input } });
    }
    throw e;
  }
}
```

### 20.4 QR Display (Participant Side)

The backend hands you a `public_key` at login and decrypts whatever the client shows — this repo does not include a specific client-side QR-payload encoding scheme in the routers read for this guide. **Confirm the exact QR payload encoding/library with the backend author before building the participant-facing QR display** (this is different from generating a fake payload yourself) — what matters for your UI is only that:
- the displayed code must encode fresh data at least every 30–45 seconds (§3.2), and
- your scanning client just forwards whatever it reads as `{participant_id, data, timestamp}` without attempting to interpret it.

---

## 21. Known Gaps & Things To Flag To Users

These are real, current behaviors in the backend that affect what you can promise in the UI. Documented as-is, not silently worked around.

| Area | Gap | Frontend implication |
|---|---|---|
| `POST /auth/password/forgot` | Stub — sends no email, issues no real token | Do not ship a real "forgot password" flow yet; if you must show the screen, label it clearly as unavailable or hide it |
| `POST /auth/password/reset` | Stub — always reports success, changes nothing | Same as above |
| Profile read | There is no `GET /profile` — the participant's own profile is only returned inline from `POST /auth/login` (with nulls if incomplete) | Cache the login response, or re-login, to refresh profile display; there's no dedicated refetch endpoint |
| `hostel_id` generation | In-memory sequential counter, not reconciled against the DB — a backend process restart can re-issue an id already in use | Not directly frontend-actionable, but if you ever see a duplicate-id-looking bug in hostel data, this is why |
| `backend_teams.paradox_id` generation | Same in-memory counter risk as above | Same caveat |
| Payments (`/mess/pay`, `/hostels/pay`) | Mock only, not idempotent — a second call overwrites the stored transaction, previous one is lost from the document | Frontend must gate resubmission (disable button once a payment exists) — the backend will not stop a double charge |
| Embeddings rate limit | In-memory, per-process — behavior may be inconsistent if the backend runs multiple worker processes/instances | Don't rely on the 60s window being perfectly enforced across all requests; still back off on 429 |
| Mess/hostel capacity edits | Reducing capacity below current occupancy is allowed, not blocked (only logged server-side) | Add your own confirmation step before letting an admin do this |
| Event deregistration | Only allowed while `registration.is_open` — no self-service withdrawal after the window closes | Hide/disable the cancel button once the window closes, and don't promise users they can always back out |
| Workshop on-spot scan | Scanning someone in as `on-spot` for one workshop silently releases their pre-registered booking for a *different* workshop in the same time slot | Surface this consequence in the scanner UI before confirming |
| `GET /backend_teams` | No audit log written on read (unlike `GET /participants`, which is audited) | Not a frontend concern directly, but don't assume all reads are equally traceable if asked |

---

## 22. Full Vocabularies

| Field | Values |
|-------|--------|
| `houses` | Bandipur, Corbett, Gir, Kanha, Kaziranga, Nallamala, Namdapha, Nilgiri, Pichavaram, Saranda, Sundarbans, Wayanad |
| `genders` | male, female |
| `programs` | DS, MS, AE, ES |
| `course_stages` | foundational, diploma, degree |
| `event_types` | technical, culturals, sports, others |
| `event_team_roles` | event_head, member, volunteer |
| `participant_team_roles` | leader, member |
| `announcement_priorities` | low, mid, high |
| `mess_preference_types` | jain, north_indian__non_veg, north_indian__veg, south_indian__non_veg, south_indian__veg |
| `payment_methods` | upi, card, netbanking |
| `backend_team_roles` | super_admin, admin, other, volunteer |
| `backend_team_departments` | technical, sports, culturals, uhc, hostels, mess, workshops |
| `hostel_roles` | hostel_volunteer, guard |
| `workshop_scan_types` | pre-registered, on-spot (scan endpoint) / changes (manual-correction endpoint only) |
| `issue_facility_types` | hostel, mess |
| `issue_categories.hostel` | water, electricity, cleanliness, furniture, internet, safety, noise, other |
| `issue_categories.mess` | food_quality, hygiene, service, timing, dietary, other |
| `issue_statuses` | open, in_progress, resolved |
| `query_categories` | hostel, mess, event, workshop, general |
| `query_statuses` | open, assigned, resolved |
| `mess_meal_slots` | breakfast, lunch, dinner |
| `hostel_scan_actions` | entry, exit, permanent_exit |

---

**End of Guide**
