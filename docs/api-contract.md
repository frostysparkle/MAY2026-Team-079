# Paradox Connect — Frontend ↔ Backend API Contract

**Status:** Sprint 1 integration · **Branch:** `feature/frontend-backend-integration`

This is the single source of truth for the wire format between the React frontend
and the FastAPI backend. It reflects the **hybrid** integration decision:

- The **backend** speaks `snake_case` JSON and uses a **`roles` array** internally.
- The **frontend** keeps its existing `camelCase` types (`src/api/types.ts`) and a
  **single `role`**. A thin adapter in `frontend/src/api/realApi.ts` maps between
  the two, so no React component or the mock API changes.

## Conventions

- **Base URL:** `VITE_API_BASE_URL` must include the API version prefix, e.g.
  `http://localhost:8000/api/v1`. All paths below are relative to that base.
- **Auth:** authenticated requests send `Authorization: Bearer <access_token>`.
  The token is the JWT returned by `POST /auth/register` or `POST /auth/login`.
- **Roles (5-tier, low → high):** `participant` < `organizer` < `staff` < `admin` < `super_admin`.
  The backend stores a `roles` array; the frontend displays the **highest-ranked** role.
- **Operational scopes:** Admin and Super Admin roles are global. Organizer and
  staff capabilities require an active `staff_assignments` record for the
  concrete event/checkpoint scope; `scope_id: "*"` is an explicit wildcard.
- **Errors:** non-2xx responses use `{ "code": string, "message": string, "details": any }`.
  The frontend throws `ApiClientError { status, code, message }`.

## Field mapping (backend → frontend)

The adapter converts each backend user/participant object into the frontend
`Participant` type:

| Backend (`snake_case`)            | Frontend (`camelCase`)      | Notes                                    |
|-----------------------------------|-----------------------------|------------------------------------------|
| `id`                              | `id`                        |                                          |
| `email`                           | `email`                     |                                          |
| `roles: string[]`                 | `role: Role`                | highest-ranked role in the array         |
| `profile.full_name`               | `fullName`                  | `""` when unset                          |
| `profile.age`                     | `age`                       | `null` when unset                        |
| `profile.gender`                  | `gender`                    |                                          |
| `profile.phone`                   | `phone`                     |                                          |
| `profile.country/state/city`      | `country/state/city`        |                                          |
| `profile.program`                 | `program`                   |                                          |
| `profile.course_stage`            | `courseStage`               |                                          |
| `profile.course_stage_other`      | `courseStageOther`          |                                          |
| `photo_url`                       | `photoUrl`                  | resolved from the `photos` collection    |
| `profile_complete`                | `profileComplete`           |                                          |
| `created_at`                      | `createdAt`                 | ISO 8601                                 |

## Endpoints

### 1a. `POST /auth/register`
Create a participant account and return a session. The request cannot choose an
elevated role.

**Request:**
```json
{
  "email": "student@example.com",
  "password": "at-least-eight-characters",
  "full_name": "Student Name"
}
```

**Response `201`:**
```json
{
  "access_token": "<jwt>",
  "token_type": "bearer",
  "expires_in": 1800,
  "is_new_user": true,
  "user": { "...serialized participant (snake_case)..." }
}
```
Adapter returns to the app: `{ session: { token, participant }, isNewUser }`.

**Errors:** `409 email_already_registered`, `422 validation error`,
`503 authentication_not_configured|database_unavailable`.

### 1b. `POST /auth/login`
Authenticate an existing account and return the same session response.

**Request:**
```json
{ "email": "student@example.com", "password": "account-password" }
```

**Response `200`:** same shape as registration, with `is_new_user: false`.

**Errors:** `401 invalid_credentials`, `403 account_unavailable`,
`422 validation error`, `503 authentication_not_configured|database_unavailable`.

### 2. `POST /profile/complete`  *(auth required)*
Save the one-time profile and store the photo in the `photos` collection.

**Request (adapter sends snake_case):**
```json
{
  "full_name": "…", "age": 21, "gender": "male", "phone": "9876543210",
  "country": "India", "state": "TN", "city": "Chennai",
  "program": "standalone_degree", "course_stage": "degree",
  "course_stage_other": null,
  "photo_data_url": "data:image/png;base64,…"
}
```
Photo limits: JPG/PNG, ≤ 750 KB (enforced server-side).

**Response `200`:** `{ "participant": { "...serialized participant..." } }`

### 3. `GET /admin/users`  *(admin+ required)*
**Response `200`:**
```json
{ "users": [ { "id": "…", "full_name": "…", "email": "…", "roles": ["participant"], "created_at": "…" } ] }
```
Adapter maps each item to `{ id, fullName, email, role, createdAt }`.

### 4. `PATCH /admin/participants/{id}/role`  *(super_admin only)*
**Request:** `{ "role": "organizer" }`
**Response `200`:** `{ "participant_id": "…", "role": "organizer" }`
Sets the user's `roles` to `[role]`.

### Scoped staff assignments  *(admin+ required)*

- `GET /admin/staff-assignments` lists assignments.
- `POST /admin/staff-assignments` grants or reactivates an assignment:
  `{ user_id, role: "organizer"|"staff", scope_type: "event"|"checkpoint", scope_id }`.
- `PATCH /admin/staff-assignments/{id}` with `{ active: false }` revokes access
  without deleting the audit record.

Event scopes use an event ID (or `*`). Checkpoint scopes use
`mess|hostel|workshop` (or `*`).

### 5. `POST /qr/provision`  *(auth required)*
Issue a scope-specific TOTP secret **once**. Re-provisioning rotates the secret.
The secret is returned only here and never re-exposed by any later call.

For an event checkpoint, `event_id` is required and the participant must have
an active registration for that published event. Non-event checkpoints reject
`event_id`.

**Request:** `{ "checkpoint_context": "event", "event_id": "…" }`
(`event|mess|hostel|workshop`)
**Response `200`:**
```json
{
  "participant_id": "…",
  "checkpoint_context": "event",
  "event_id": "…",
  "secret_base32": "…"
}
```

### 6. `POST /scan/verify`  *(active organizer/staff scope required)*
Verify a scanned QR against the per-checkpoint secret. The QR carries only
`{ participant_id, current_code }`; the organizer app supplies
`checkpoint_context` and the concrete `event_id` for event scans.

The scanner sends its stable browser identifier in
`X-Scanner-Device-ID`. The backend combines that identifier with participant ID
and source IP for Redis-backed rate limiting. Used TOTP steps are claimed
atomically in Redis with an expiry matching the validation window, so replay is
rejected consistently across API instances.

**Request:**
```json
{
  "participant_id": "…",
  "current_code": "123456",
  "checkpoint_context": "event",
  "event_id": "…"
}
```

**Response `200`:**
```json
{
  "result": "valid",
  "participant": { "id": "…", "full_name": "…", "photo_url": null },
  "detail": "optional human-readable note"
}
```
`result` is one of: `valid`, `expired`, `unknown_participant`, `duplicate`,
`wrong_checkpoint`, `not_eligible`, `payment_pending`.

`429 scan_rate_limited` is returned when the composite scan-attempt limit is
exceeded. `503 verification_state_unavailable` fails closed when Redis is not
available.

## Events (Epic 1)

Event objects map `event_date`/`start_time`/`end_time` → `eventDate`/`startTime`/`endTime`.
`event_date` is `YYYY-MM-DD`; times are 24h `HH:MM`. `status` ∈ `draft|published|cancelled`.

### 7. `GET /events`  *(auth required)*
Returns published events for everyone. Assigned organizers additionally receive
draft/cancelled events in their exact event scopes; global/wildcard operators
receive all events. `{ "events": [ EventOut, … ] }`.

### 8. `GET /events/{id}`  *(auth required)*
Single event. Unpublished events require an active organizer assignment for
that event, wildcard event access, or a global admin role.

### 9. `POST /events`  *(global admin or wildcard event organizer)*
Create an event. Body (snake_case): `title, venue, event_date, start_time, end_time, capacity, instructions, status?`. Returns `201` + `EventOut`.

### 10. `PATCH /events/{id}`  *(assigned event organizer or global admin)*
Partial update — send only changed fields. Returns `EventOut`. `400 no_changes` if empty.

`EventOut`: `{ id, title, venue, event_date, start_time, end_time, capacity, instructions, status, created_at }`.

## Queries & Contacts (Epic 6)

Query objects map `participant_id`→`participantId`, `assigned_team`→`assignedTeam`.
`category` ∈ `event|hostel|mess|workshop|lost_item|other`; `status` ∈
`open|assigned|in_progress|resolved`; team ∈ `event|hostel|mess|workshop|general`.
Contacts map `is_emergency`→`isEmergency`; `category` ∈ `hostel|mess|event|security|general`.

### 11. `POST /queries` *(auth)* — raise a query `{ category, description }` → `201` QueryOut.
### 12. `GET /queries` *(auth)* — the caller's own queries `{ queries: [...] }`.
### 13. `GET /queries/manage` *(admin+)* — all queries for triage; optional `?status_filter=`.
### 14. `PATCH /queries/{id}` *(admin+)* — `{ status?, assigned_team? }` → QueryOut.

`QueryOut`: `{ id, participant_id, category, description, status, assigned_team, created_at, updated_at }`.

### 15. `GET /contacts` *(auth)* — directory; `?emergency_only=true` for the Help section.
### 16. `POST /contacts` *(admin+)* — `{ name, role, category, phone, email?, is_emergency? }` → `201` ContactOut.
### 17. `PATCH /contacts/{id}` *(admin+)* — partial update → ContactOut.
### 18. `DELETE /contacts/{id}` *(admin+)* — `204`.

`ContactOut`: `{ id, name, role, category, phone, email, is_emergency }`.

## Mess (Epic 4)

Menu items map `start_time`/`end_time` → `startTime`/`endTime`. `meal` ∈
`breakfast|lunch|snacks|dinner`. A digital mess pass requires **explicit**
eligibility: an unset participant is not eligible, and the mess scan checkpoint
returns `not_eligible` for them.

### 19. `GET /mess/menu` *(auth)* — `{ items: [MenuItemOut] }`.
### 20. `POST /mess/menu` *(assigned mess organizer or global admin)* — `{ location, meal, items, start_time, end_time }` → `201`. `409 menu_conflict` on duplicate (location, meal).
### 21. `PATCH /mess/menu/{id}` *(assigned mess organizer or global admin)* — partial update.
### 22. `DELETE /mess/menu/{id}` *(assigned mess organizer or global admin)* — `204`.
### 23. `GET /mess/pass` *(auth)* — the caller's own pass `{ participant_id, eligible }`.
### 24. `GET /mess/eligibility` *(admin+)* — `{ participants: [{ id, full_name, email, eligible }] }`.
### 25. `PATCH /mess/eligibility/{participant_id}` *(admin+)* — `{ eligible: bool }` → the updated item.
### 26. `GET /mess/stats` *(assigned mess organizer or global admin)* — `{ eligible_count }` (FR-4.4 opt-in count).

`MenuItemOut`: `{ id, location, meal, items, start_time, end_time }`.

## Hostel (Epic 5)

Allocations map `hostel_block`→`hostelBlock`, `checked_in`→`checkedIn`,
`checked_in_at`→`checkedInAt`, `participant_id`→`participantId`. One allocation
per participant. The hostel scan checkpoint records check-in: no allocation →
`not_eligible`; otherwise `valid` with `detail` "Block · Room" and `checked_in`
is set.

### 27. `GET /hostel/allocation` *(auth)* — the caller's own `{ allocation | null }` (FR-5.1).
### 28. `GET /hostel/allocations` *(admin+)* — all allocations, each enriched with `full_name`/`email`.
### 29. `POST /hostel/allocations` *(admin+)* — `{ participant_id, hostel_block, room, instructions?, coordinator? }` → `201`. `409 allocation_conflict` if already allocated.
### 30. `PATCH /hostel/allocations/{id}` *(admin+)* — partial update.
### 31. `DELETE /hostel/allocations/{id}` *(admin+)* — `204`.

`AllocationOut`: `{ id, participant_id, hostel_block, room, instructions, coordinator, checked_in, checked_in_at }`.

## Attendance & Crowd (Epic 3)

Event scans require an `event_id` (organizer app supplies it). The backend
requires a published event, an active participant account, and an active event
registration before accepting the event-scoped TOTP. Attendance is counted
**per event** as distinct valid-scanning participants — re-entry within the
window does not double-count. Crowd status: `available`
(<70%), `filling_fast` (70–99%), `full` (≥100%).

- `POST /scan/verify` requires `event_id` for event checkpoints.
- `GET /attendance/events/{event_id}` *(assigned event organizer or global admin)* → `{ event_id, capacity, attendance, remaining, at_capacity }` (FR-3.1/3.2).
- `GET /attendance/events/{event_id}/crowd` *(auth)* → `{ event_id, status }` (FR-3.3).
- `GET /attendance/dashboard` *(admin+)* → `{ events: [{ event_id, title, venue, capacity, attendance, remaining, at_capacity, status }] }` (FR-3.4).

## Announcements (Epic 8)

Audience ∈ `all_participants | event_registrants | hostel_residents | pors`.
The feed is filtered server-side per caller: `all` → everyone; `hostel_residents`
→ callers with an allocation; `pors` → organizer+; `event_registrants` requires
an `event_id` and (no registration model in the MVP) is shown to all with the
event referenced. Every announcement logs sender + timestamp.

- `POST /announcements` *(admin+)* — `{ title, body, audience, event_id? }` → `201`. `422` if `event_registrants` without `event_id`.
- `GET /announcements` *(auth)* — the caller's audience-filtered feed.
- `GET /announcements/manage` *(admin+)* — full log (accountability).
- `DELETE /announcements/{id}` *(admin+)* — `204`.

`AnnouncementOut`: `{ id, title, body, audience, event_id, sender_name, created_at }`.

## Operational Overview (Epic 9)

`GET /admin/overview` *(admin+)* returns one consolidated snapshot (FR-9.1),
aggregated from the shared data stores (FR-9.3 — no parallel copies):

```json
{
  "events": { "active": 0, "total_checked_in": 0, "at_capacity": 0 },
  "queries": { "open": 0, "assigned": 0, "in_progress": 0, "resolved": 0, "unresolved": 0 },
  "hostel": { "allocations": 0, "checked_in": 0 },
  "mess": { "eligible": 0 }
}
```

## Payments (Epic 10)

Hosted-checkout model: our server never receives card data (PRD §7.2). A checkout
returns a gateway `checkout_url`; the outcome arrives via a **signature-verified
webhook**. Only status + a transaction reference are stored. The gateway is
swappable (`PAYMENT_GATEWAY`); a `MockGateway` ships for local/dev, where
`/payments/mock/settle` simulates the provider emitting a signed webhook.
Status: `created` (pending) → `paid` | `failed`. On `paid`, hostel sets
`access.hostel_paid`; mess sets `access.mess_eligible` (grants the mess pass).

- `GET /payments/plans` *(auth)* — active meal plans; `POST/PATCH/DELETE /payments/plans[/id]` *(admin+)*.
- `POST /payments/hostel/checkout` *(auth)* — requires a hostel allocation → `{ payment_id, checkout_url }` (FR-10.1).
- `POST /payments/mess/checkout` *(auth)* — `{ plan_id }` → `{ payment_id, checkout_url }` (FR-10.2).
- `POST /payments/webhook` *(public, `X-Signature` HMAC-SHA256 verified)* — settles a payment.
- `POST /payments/mock/settle` *(auth, mock gateway only)* — `{ session_id, outcome }` dev simulation.
- `GET /payments/me` *(auth)* — `{ hostel, mess }` status + receipt (amount, date, txn_ref) (FR-10.3).
- `GET /payments/reconciliation` *(admin+)* — per-participant hostel/mess status (FR-10.4).

## Onboarding journey (student-experience-redesign)

The journey is **derived server-side** — a pure function of profile, hostel
allocation, payment/access flags, event-registration count, and the small
`users.onboarding` intent (`accommodation_choice`, `mess_choice`, `mess_plan_id`).
Nothing is a parallel copy of module state.

- `GET /me/journey` *(auth)* — the resolved journey:

```json
{
  "profile_complete": true,
  "accommodation": { "choice": "yes", "allocated": false, "paid": false },
  "mess": { "choice": "no", "plan_id": null, "paid": false },
  "payment_due": true,
  "events_registered": 0,
  "steps": [ { "key": "profile", "state": "done" }, { "key": "accommodation", "state": "current" } ],
  "next_step": "payment",
  "complete": false
}
```

- `state` ∈ `done | current | upcoming | skipped`; `next_step` ∈
  `profile | accommodation | mess | payment | events | done`.
- `POST /me/onboarding/accommodation` *(auth)* — `{ "choice": "yes"|"no" }`;
  records intent (room stays admin-allocated). Returns the updated journey.
- `POST /me/onboarding/mess` *(auth)* — `{ "choice": "yes"|"no", "plan_id": "..." }`;
  `plan_id` required (and must be active) when `choice=yes`. Returns the journey.
- `GET /me/payments/pending` *(auth)* — bookings chosen but not yet paid:
  `{ items: [{ kind, label, amount, currency }], total, currency }`.

## Event registration — participant side (student-experience-redesign)

Activates `event_registrations` (unique on `(user_id, event_id)`). Registrations
are soft-cancellable (a cancelled row is re-activated, never duplicated) and
capacity is reserved with an atomic conditional counter on the event document,
so concurrent registrations cannot oversubscribe an event. Cancellation
releases one reservation only when an active registration actually changes.

- `POST /events/{id}/register` *(auth)* — idempotent; `404 event_not_found`
  (unknown/unpublished), `409 event_full` (at capacity). Returns
  `{ event_id, registered, registration_count, spots_left }`.
- `DELETE /events/{id}/register` *(auth)* — soft cancel; `204`, idempotent.
- `GET /me/registrations` *(auth)* — active registrations joined with event
  details: `{ registrations: [{ event_id, title, venue, event_date, start_time,
  end_time, status, registered_at }] }`.
- Events list/detail additionally annotate `registered`, `registration_count`,
  and `spots_left` for the calling participant.

## Dev-only test harness (student-experience-redesign)

Hard-gated behind `enable_dev_login` (`APP_ENV != "production"` **and**
`ENABLE_DEV_LOGIN=true`). Both endpoints return `404` when disabled and only
ever operate on seeded `is_test` accounts. **Never enabled in production.**

- `POST /auth/dev-login` *(gated)* — `{ "email": "..." }` → `{ access_token,
  is_new_user, user }` for a seeded active user (same shape as normal login).
- `GET /auth/test-accounts` *(gated)* — `{ accounts: [{ email, full_name, role,
  label }] }` for the account-switcher.
- Seed/reset the account matrix with `python -m scripts.seed_test_data`.
- Frontend mirror: the mock API seeds the same matrix and a dev-only
  `AccountSwitcher` (`VITE_ENABLE_DEV_SWITCHER`, dev builds only) swaps identities.

## TOTP parameters (must match on both sides)

| Param      | Value  |
|------------|--------|
| Algorithm  | SHA1   |
| Digits     | 6      |
| Period     | 30 s   |
| Window     | ±1 step |
| Secret     | Base32, 160-bit |

Frontend: `otpauth` (`src/lib/totp.ts`, `src/config/constants.ts`).
Backend: `pyotp` with `valid_window=1`.
