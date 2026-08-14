# Paradox Connect: Frontend Integration & Architecture Guide

This is the **absolute source of truth** for the Frontend Developer. Every endpoint, access rule, and behaviour documented here is derived **directly from the backend source code**.

---

## 1. Global Concepts & Security

### 1.1 Authentication

All protected routes require: `Authorization: Bearer <token>`

There are **two separate login endpoints** — the JWT embeds a `type` claim that the backend enforces. A participant token will be rejected when used to access a staff-only resource and vice versa:

| Population | Login Endpoint | Token `type` Claim | Email Constraint | Who Creates |
|---|---|---|---|---|
| Participants | `POST /auth/login` | `"participant"` | Must match `@*.study.iitm.ac.in` | Self-register via `/auth/register` |
| Backend Staff | `POST /auth/admin/login` | `"staff"` | Any email | Super Admin via `POST /backend_teams` |

> **Frontend must have two separate login pages/routes:** e.g. `/login` for participants and `/admin/login` for all backend staff (hostel guards, mess employees, volunteers, event heads, domain admins, UHC, super admins).

### 1.2 Login Responses

**`POST /auth/login` (Participants only)** returns:
```json
{
  "id": "DS23F1000001",
  "email": "...",
  "access_token": "...",
  "token_type": "participant",
  "full_name": "...", "dob": "...", "house": "...", "gender": "...", "phone": "...",
  "country": "...", "state": "...", "city": "...", "address": "...",
  "program": "...", "course_stage": "...",
  "photo": "...",
  "public_key": "<RSA PEM public key>"
}
```

**`POST /auth/admin/login` (Backend Staff only)** returns:
```json
{
  "id": "BT1234567890",
  "email": "...",
  "access_token": "...",
  "token_type": "staff",
  "role": "super_admin | event_head | ...",
  "department": "technical | uhc | ...",
  "designation": "..."
}
```

> Staff tokens do **not** include a `public_key`. Staff never generate QR codes. The frontend uses `token_type` to route the user to the correct dashboard after login.

### 1.3 Dynamic QR Code (Participants Only)

- **Payload:** `{ "id": "<participant_id>", "timestamp": "<ISO8601 UTC>" }`
- **Encryption:** Encrypt the JSON string using **RSA-OAEP** with the `public_key` from login. Render Base64 ciphertext as a QR code.
- **Auto-Refresh:** Silently regenerate every **30–60 seconds**. Backend rejects any QR with a timestamp older than 60 seconds → `400 "QR Code expired"`.
- **UI:** Show a visible countdown timer.

### 1.4 Role Hierarchy

| Role | How to identify | Notes |
|---|---|---|
| Participant | `token_type: "participant"` in login response | IITM email; `id` is a roll-number format |
| Backend Staff (general) | `token_type: "staff"` in login response | `id` is a `BT...` paradox_id |
| Volunteer / External Staff | In `event_team`/`mess_team`/`hostel_team`/`workshop_team` | Has scanning privilege for that entity |
| Event Head | In `event.event_team` with `role: "event_head"` | Exclusive team allocation authority |
| Domain Admin | `backend_teams.department` matches an `event.event_type` | Oversight of matching events |
| UHC | `backend_teams.department == "uhc"` | House-scoped visibility |
| Super Admin | `backend_teams.role == "super_admin"` | Global CRUD; **cannot** run `allocate_teams` or CRUD participant teams |

---

## 2. User Journeys & Screen Workflows

### Journey A: Participant

1. **Register:** `POST /auth/register` — IITM email enforced. Returns `{ "message": "Registration successful", "participant_id": "..." }`.
2. **Login:** `POST /auth/login` — Receive and persist JWT + `public_key`.
3. **Profile Completion (mandatory gate):** Redirect new users to profile completion before any other action. `PATCH /profile/complete` with: `full_name`, `dob`, `house`, `gender`, `phone`, `mess_preference`, `country`, `state`, `city`, `address`, `emergency_contact`, `program`, `course_stage`, optional `photo`.
4. **Dashboard:**
   - QR code (auto-refreshing every 30–60s with countdown).
   - Mess widget: `GET /mess/my_mess` → returns `allotted_mess`, `mess_details`, `slots` (entries per day).
   - Hostel widget: `GET /hostels/my_hostel` → returns `assigned_hostel`, `room`, `logged_in` status, and masked `volunteers` list (name + phone only).
5. **Browse Events:** `GET /events` (auth required, all users). Events have `open` boolean — if `open: false` show **"Registration Closed"** badge.
6. **Register for Event:** `POST /events/{event_id}/register` with optional body `{ "team_name": "...", "registration_data": {} }`.
   - **If already registered** → `409 "User is already registered for this event."`
   - **If registration closed** → `400 "Registration is closed for this event"`
   - **If user is on event_team** → `403 "Event team members cannot register as participants for their own event."` — frontend must pre-check and **disable the Register button** with helper text.
7. **Edit Registration:** `PUT /events/{event_id}/register` — Updates `registration_data`. Blocked if `open: false`.
8. **Cancel Registration:** `DELETE /events/{event_id}/register` — Blocked if `open: false`.
9. **My Registrations:** `GET /events/my_registrations`.
10. **Browse Workshops:** `GET /workshops` — Non-admins receive list **without** `workshop_team` field. Shows `registration_count`, `capacity`. Display live remaining seats badge via SSE.
11. **Live Workshop Seats:** Connect to `GET /workshops/{workshop_id}/seats/stream` using `EventSource` (no auth header — unauthenticated SSE). Emits `{ "remaining_seats": N, "capacity": M }` on change.
12. **Register for Workshop:** `POST /workshops/{workshop_id}/register` (participants only).
    - Full → `400 "Workshop is full"`
    - Already registered → `400 "Already registered for this workshop"`
    - Slot conflict → `400 "Already registered for another workshop in this time slot"` — **grey-out conflicting slot workshops** in the catalog.
    - Race condition → `400 "Failed to register. Workshop might have just filled up."`
    - Frontend must parse `slot_id` on each workshop and disable registration for any other workshop sharing the same `slot_id`.

---

### Journey B: Volunteer / External Staff (Scanning)

All scanning staff log in via **`/auth/admin/login`** (staff token required). Scanning permission is granted by being in the entity's team array (`mess_team`, `hostel_team`, `event_team`, `workshop_team`). Additionally, each team member has a `logging` flag (mess/hostel) or `attendance` flag (workshop) — if disabled by Super Admin, the backend returns `403 "Scanning disabled for you"`.

#### B.1 Mess Scanner
- **Slot auto-detection:** The frontend reads the device clock and compares it against the mess's slot time boundaries (from the mess `slots` config — `start_time`/`end_time` per slot). **Do not show a manual slot dropdown** — automatically pass the active slot.
- Scan: `POST /mess/{mess_id}/scan?slot={auto_slot}&day={auto_day}` + encrypted QR in body.
- Scanners: **mess team members only** (`logging: true`)
- Error responses to handle in UI:
  - `403 "Not authorized to scan for this mess"`
  - `403 "Scanning disabled for you"`
  - `400 "Participant not allotted to this mess"`
  - `400 "Day entry not found"`
  - `400 "Slot not found"`
  - `400 "Already logged in for {slot} on day {day}"` → show **"Already Consumed"** toast

#### B.2 Hostel Scanner
- UI: Single **Entry / Exit** toggle.
- Scan: `POST /hostels/{hostel_id}/scan?action=entry|exit` + QR in body.
- Scanners: **hostel team members only** (`logging: true`)
- After scan, display participant's updated inside/outside state.
- Error responses:
  - `403 "Not authorized to scan for this hostel"`
  - `403 "Scanning disabled for you"`
  - `400 "Participant not allotted to this hostel"`
  - `400 "Participant is already inside"` (entry attempted when already inside)
  - `400 "Participant is already outside"` (exit attempted when already outside)
  - `400 "Invalid action. Must be 'entry' or 'exit'"`

#### B.3 Event Scanner
- Scan: `POST /events/{event_id}/scan` + QR in body.
- Scanners: **event team members only** (any role in `event_team`)
- Response: `{ "name": "...", "email": "...", "is_participating": true|false }` — display this to scanner.
- Own daily scan count: `GET /events/{event_id}/my_daily_scans` → `{ "daily_unique_scans": N }`.
- Error: `403 "Not authorized to scan for this event"`

#### B.4 Workshop Scanner
- UI: **Pre-registered / On-spot** toggle.
- Scan: `POST /workshops/{workshop_id}/attendance?scan_type=pre-registered|on-spot` + QR in body.
- Scanners: **workshop team members only** (with `attendance: true`)
- On-spot hard cap = **10% of capacity**. Show `400 "Max on-spot capacity (10%) reached"` as a blocking UI error.
- Error responses:
  - `403 "Not authorized to scan for this workshop"`
  - `403 "Scanning disabled for this volunteer"`
  - `400 "Participant not pre-registered for this workshop"`
  - `400 "Participant already marked present for another workshop in this slot"`
  - `400 "Max on-spot capacity (10%) reached"`
  - `400 "Invalid scan_type"`

---

### Journey C: Event Head

Identified by: `paradox_id` in `event.event_team` with `role: "event_head"`.

1. **View Participation:** `GET /events/{event_id}/participation`
   - Returns: `{ "count": N, "participants": [...], "event_team": [...], "total_daily_scans": N }`
   - Each participant entry: `participant_id`, `name`, `email`, `phone`, `house`, `team_id`, `team_role`.
2. **Trigger Team Allocation Algorithm:** `POST /events/{event_id}/allocate_teams`
   - **Event Head exclusive** — Super Admins and Domain Admins cannot call this.
   - If `event.team.max <= 1` → returns `{ "message": "Not a team event" }` (not an error).
   - If `event.team.house: true` → groups participants within same `house`. Otherwise random mixed.
   - Only unassigned solo players (no `team_id`) are grouped. Returns `{ "message": "Allocated N teams" }`.
3. **Manual Participant Team CRUD (post-allocation):** `PUT /events/{event_id}/participant_teams/{participant_id}` with body `{ "team_id": "...", "team_role": "..." }`
   - **Event Head exclusive** — Super Admins cannot call this.
   - Frontend: provide drag-and-drop or edit UI to move participants between teams.
4. **CSV Export (frontend-only):** Export from `GET /events/{event_id}/participation` response client-side.

---

### Journey D: Domain Admin

Identified by: `backend_teams.department` matching `event.event_type`.

1. **View Participation:** `GET /events/{event_id}/participation` — Granted for events where `event_type == their department`. Gets full participant list + `event_team` + `total_daily_scans`.
2. **Cannot:** trigger `allocate_teams`, modify participant teams, create/delete events.
3. **CSV Export (frontend-only):** Export participation for events in their domain.

---

### Journey E: Super Admin

Identified by: `backend_teams.role == "super_admin"`.

1. **Staff Management (CRUD):** `POST/GET/PUT/DELETE /backend_teams`
   - Create creates a `paradox_id` like `BT<timestamp>` and optionally links to a participant document via `admin_id`.
2. **Event CRUD:** `POST/PUT/DELETE /events` + `POST /events/{id}/team` (assigns any staff member to event_team with a role).
3. **Workshop CRUD:** `POST/PUT/DELETE /workshops` + `POST /workshops/{id}/volunteers`.
4. **Mess & Hostel Setup:** `POST /mess` + `POST /mess/{id}/team`, `POST /hostels` + `POST /hostels/{id}/team`.
5. **Toggle Scanning:**
   - `PUT /mess/{id}/team/{uid}/toggle_scan?logging=true|false`
   - `PUT /hostels/{id}/team/{uid}/toggle_scan?logging=true|false` *(note: takes `logging` query param)*
   - `PUT /workshops/{id}/volunteers/{uid}/toggle_scan?attendance=true|false`
6. **Global Allocations:** `POST /mess/allocate` (by mess_preference), `POST /hostels/allocate` (by gender, only participants with `accommodation.registered: true`).
7. **Statistics:** `GET /mess/{id}/statistics`, `GET /hostels/{id}/statistics`, `GET /workshops/{id}/logs`.
8. **Audit Logs:** `GET /audit-logs?limit=100` (optional limit param).
9. **Cannot:** trigger `POST /events/{id}/allocate_teams` or `PUT /events/{id}/participant_teams/{pid}`.
10. **CSV Export (frontend-only):** All unfiltered analytics views.

---

### Journey F: UHC

Identified by: `backend_teams.department == "uhc"`. House is parsed from their email by taking the part **before the first hyphen**, case-insensitively: `wayanad-sec@ds.study.iitm.ac.in` → house = `"wayanad"`. This is compared against `profile.house` (lowercase) of each participant.

1. **View Participation:** `GET /events/{event_id}/participation`
   - Backend **automatically filters** response to only include participants whose `profile.house` matches the UHC member's house.
   - `total_daily_scans` field is **omitted** from UHC responses.
   - `event_team` details **are included** — use this to surface a contact directory for Event Head & volunteers.
2. **Cannot:** trigger allocations, modify teams, view cross-house data.
3. **CSV Export (frontend-only):** Binds to filtered API response — CSV only contains the UHC member's house participants.

---

## 3. Complete API Reference

### Auth & Profile
| Method | Path | Auth | Access | Notes |
|---|---|---|---|---|
| POST | `/auth/register` | No | Public | IITM email only; returns `participant_id` |
| POST | `/auth/login` | No | **Participants only** | Returns JWT (`type:"participant"`) + profile + `public_key` |
| POST | `/auth/admin/login` | No | **Backend Staff only** | Returns JWT (`type:"staff"`) + role/department/designation |
| POST | `/auth/password/forgot` | No | Public | Always returns success message + dev reset URL |
| POST | `/auth/password/reset` | No | Public | Token-based reset |
| POST | `/auth/password/change` | Yes | Any | Returns new `access_token` preserving same `type` claim |
| PATCH | `/profile/complete` | Yes | Participant only | Full profile fields |

### Events
| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/events` | All authenticated | Non-staff see same list; admins too |
| POST | `/events` | Super Admin | Create event |
| PUT | `/events/{id}` | Super Admin | Update event |
| DELETE | `/events/{id}` | Super Admin | Also removes participant registrations |
| POST | `/events/{id}/team` | Super Admin only | Add member to event_team (role: event_head \| event_member \| volunteer) |
| POST | `/events/{id}/register` | Participant only | Optional body; event_team members blocked |
| PUT | `/events/{id}/register` | Participant only | Update registration_data |
| DELETE | `/events/{id}/register` | Participant only | Cancel |
| GET | `/events/my_registrations` | Participant only | Returns empty list for non-participants |
| GET | `/events/{id}/participation` | Super Admin, Event Team, UHC, Domain Admin | Payload varies by role |
| POST | `/events/{id}/allocate_teams` | **Event Head only** | Blocked for Super Admin |
| PUT | `/events/{id}/participant_teams/{pid}` | **Event Head only** | Blocked for Super Admin |
| POST | `/events/{id}/scan` | **Event Team member only** | Returns name + email + is_participating |
| GET | `/events/{id}/my_daily_scans` | **Event Team member only** | Own scan count today |

### Workshops
| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/workshops` | All authenticated | Admins see `workshop_team`; others don't |
| POST | `/workshops` | Super Admin | |
| PUT | `/workshops/{id}` | Super Admin | |
| DELETE | `/workshops/{id}` | Super Admin | Also removes participant registrations |
| POST | `/workshops/{id}/volunteers` | Super Admin | role + user_id + attendance fields |
| PUT | `/workshops/{id}/volunteers/{uid}/toggle_scan` | Super Admin | `?attendance=true\|false` |
| GET | `/workshops/{id}/logs` | Super Admin | |
| POST | `/workshops/{id}/register` | Participant only | Slot conflict check |
| GET | `/workshops/{id}/seats/stream` | **No auth required** | SSE — use `EventSource` |
| POST | `/workshops/{id}/attendance` | **Workshop team member only** (with `attendance: true`) | `?scan_type=pre-registered\|on-spot` |

### Mess
| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/mess` | All authenticated | Lists all messes |
| POST | `/mess` | Super Admin | Create mess |
| POST | `/mess/{id}/team` | Super Admin | role: volunteer \| other; `other` gets `logging: true` by default |
| PUT | `/mess/{id}/team/{uid}/toggle_scan` | Super Admin | `?logging=true\|false` query param |
| POST | `/mess/allocate` | Super Admin | Allocates unassigned participants by `mess_preference` |
| GET | `/mess/my_mess` | Participant only | Returns `allotted_mess`, `mess_details`, `slots` |
| POST | `/mess/{id}/scan` | **Mess team member only** (`logging=true`) | `?slot=breakfast\|lunch\|dinner&day=1-5` |
| GET | `/mess/{id}/statistics` | Super Admin | Returns allocated participants + counts |

### Hostels
| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/hostels` | All authenticated | Lists all hostels |
| POST | `/hostels` | Super Admin | Fields: hostel_id, name, capacity, gender, coordinator |
| POST | `/hostels/{id}/team` | Super Admin | role: volunteer \| other; `other` gets `logging: true` |
| PUT | `/hostels/{id}/team/{uid}/toggle_scan` | Super Admin | `?logging=true\|false` query param |
| POST | `/hostels/allocate` | Super Admin | Allocates by gender; only participants with `accommodation.registered: true` |
| GET | `/hostels/my_hostel` | Participant only | Returns hostel + room + logged_in + masked volunteers |
| POST | `/hostels/{id}/scan` | **Hostel team member only** (`logging=true`) | `?action=entry\|exit` |
| GET | `/hostels/{id}/statistics` | Super Admin | Returns inside count + allocated participants |

### Backend Teams & Audit
| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/backend_teams` | Super Admin | Creates staff; optionally links to participant via email lookup |
| GET | `/backend_teams` | Super Admin | Excludes `_id` and `password_hash` |
| PUT | `/backend_teams/{paradox_id}` | Super Admin | Partial update |
| DELETE | `/backend_teams/{paradox_id}` | Super Admin | |
| GET | `/audit-logs` | Super Admin | `?limit=100` (default 100), sorted newest first |

---

## 4. Key Inferred UI Requirements

| Requirement | Source (backend behaviour) |
|---|---|
| QR auto-refresh every 30–60s with countdown | Backend rejects QR with timestamp > 60s old |
| **Two separate login pages** (`/login` and `/admin/login`) | Two endpoints with different JWT `type` claims; tokens are not interchangeable |
| Use `token_type` from login response to route to correct dashboard | `"participant"` → participant dashboard; `"staff"` → admin/scanner dashboard based on `role` |
| No manual slot dropdown for mess scanner | Slot/day auto-detected from clock by frontend |
| Grey-out conflicting workshop slots | Backend rejects duplicate `slot_id` registrations |
| Show "Registration Closed" badge when `open: false` | `open` flag blocks register/edit/delete |
| Disable event Register button for event_team members | Backend returns `403` with specific message |
| Show `is_participating` result after event scan | Scan endpoint returns this field |
| Live seat counter via SSE (`EventSource`) | `/workshops/{id}/seats/stream` — no auth needed |
| Inside/Outside state display after hostel scan | `accommodation.logged_in` updated per scan |
| On-spot scan block at 10% capacity | `400 "Max on-spot capacity (10%) reached"` |
| Workshop listing hides `workshop_team` for non-admins | Backend strips it for non-super-admins |
| Mess `my_mess` shows per-slot consumption history | Returns `slots` array with `logged` per slot per day |
| Hostel `my_hostel` shows masked team (name+phone only) | Backend explicitly masks volunteer details |
| CSV export — role-scoped | UHC sees only their house; others see their permitted data |
| Profile completion gate | `profile` is `{}` at register; frontend detects and gates |

---

## 5. Error Handling Reference

| HTTP Code | Meaning | Frontend Action |
|---|---|---|
| 400 | Logic/validation block | Display exact `detail` string in Toast |
| 401 | Invalid credentials or bad token | Redirect to `/login` (participants) or `/admin/login` (staff) based on which page the user was on |
| 403 | Insufficient role/permissions | Show "Access Denied" toast; hide/disable triggering UI element |
| 404 | Entity not found | Show appropriate empty/error state |
| 409 | Duplicate / already registered | Show conflict message from `detail` |
| 422 | Request schema invalid | Show field-level validation errors |
