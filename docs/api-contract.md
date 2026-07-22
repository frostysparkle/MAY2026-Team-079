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
  The token is the JWT returned by `POST /auth/google`.
- **Roles (5-tier, low → high):** `participant` < `organizer` < `staff` < `admin` < `super_admin`.
  The backend stores a `roles` array; the frontend displays the **highest-ranked** role.
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

### 1. `POST /auth/google`
Verify a Google Identity Services credential, upsert the user, return a session.

**Request (frontend sends `{ idToken }`; adapter sends):**
```json
{ "credential": "<google-id-token>" }
```

**Response `200`:**
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

**Errors:** `403 google_account_not_allowed` (bad/again-unverified domain),
`401 invalid_google_credential`, `409 identity_conflict`, `503 database_unavailable`.

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

### 5. `POST /qr/provision`  *(auth required)*
Issue the per-checkpoint TOTP secret **once**. Re-provisioning rotates the secret.
The secret is returned only here and never re-exposed by any later call.

**Request:** `{ "checkpoint_context": "event" }`  (`event|mess|hostel|workshop`)
**Response `200`:**
```json
{ "participant_id": "…", "checkpoint_context": "event", "secret_base32": "…" }
```

### 6. `POST /scan/verify`  *(organizer+ required)*
Verify a scanned QR against the per-checkpoint secret. The QR carries only
`{ participant_id, current_code }`; the organizer app supplies `checkpoint_context`.

**Request:**
```json
{ "participant_id": "…", "current_code": "123456", "checkpoint_context": "event" }
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

## Events (Epic 1)

Event objects map `event_date`/`start_time`/`end_time` → `eventDate`/`startTime`/`endTime`.
`event_date` is `YYYY-MM-DD`; times are 24h `HH:MM`. `status` ∈ `draft|published|cancelled`.

### 7. `GET /events`  *(auth required)*
Returns published events for participants; organizers and above also receive
`draft`/`cancelled`. `{ "events": [ EventOut, … ] }`.

### 8. `GET /events/{id}`  *(auth required)*
Single event. Participants can only fetch `published`; organizers+ any. `404 event_not_found` otherwise.

### 9. `POST /events`  *(organizer+)*
Create an event. Body (snake_case): `title, venue, event_date, start_time, end_time, capacity, instructions, status?`. Returns `201` + `EventOut`.

### 10. `PATCH /events/{id}`  *(organizer+)*
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
### 20. `POST /mess/menu` *(organizer+)* — `{ location, meal, items, start_time, end_time }` → `201`. `409 menu_conflict` on duplicate (location, meal).
### 21. `PATCH /mess/menu/{id}` *(organizer+)* — partial update.
### 22. `DELETE /mess/menu/{id}` *(organizer+)* — `204`.
### 23. `GET /mess/pass` *(auth)* — the caller's own pass `{ participant_id, eligible }`.
### 24. `GET /mess/eligibility` *(admin+)* — `{ participants: [{ id, full_name, email, eligible }] }`.
### 25. `PATCH /mess/eligibility/{participant_id}` *(admin+)* — `{ eligible: bool }` → the updated item.
### 26. `GET /mess/stats` *(organizer+)* — `{ eligible_count }` (FR-4.4 opt-in count).

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
