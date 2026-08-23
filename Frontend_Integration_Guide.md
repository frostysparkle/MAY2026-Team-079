# Paradox Connect Frontend Integration Guide v2

---

## Table of Contents

1. [Core Concepts & Conventions](#1-core-concepts--conventions)
   - 1.1 URL Structure & Base
   - 1.2 HTTP Status Codes
   - 1.3 Pagination (limit & offset)
   - 1.4 Request & Response Format
2. [Authentication](#2-authentication)
   - 2.1 Bearer Tokens
   - 2.2 Public Routes (No Auth)
   - 2.3 Staff vs Participant Credentials
   - 2.4 Token Refresh & Password Change
3. [QR Code Handling](#3-qr-code-handling)
   - 3.1 QR Generation (Backend)
   - 3.2 QR Scanning (Frontend)
   - 3.3 Error Handling (400/404)
   - 3.4 Example QR Payload
4. [Roles & Permissions Matrix](#4-roles--permissions-matrix)
   - 4.1 Super Admins (Staff)
   - 4.2 Participant Roles (team_leader, team_member, volunteer)
5. [Time Windows & Scanning Logic](#5-time-windows--scanning-logic)
   - 5.1 Workshop Scanning Windows
   - 5.2 Mess Hall Scanning Window
   - 5.3 Computed `is_open` Field
6. [Domain-Specific Endpoints Reference](#6-domain-specific-endpoints-reference)
   - 6.1 Auth & Profile
   - 6.2 Participants & Statistics
   - 6.3 Events
   - 6.4 Workshops & Slots
   - 6.5 Mess Halls
   - 6.6 Hostels
   - 6.7 Queries
   - 6.8 Issues
   - 6.9 Audit Logs
   - 6.10 Embeddings
7. [Real-Time Streams & SSE](#7-real-time-streams--sse)
   - 7.1 Announcements Stream
   - 7.2 Workshop Seats Stream
8. [Role Journeys & Screen Flows](#8-role-journeys--screen-flows)
   - 8.1 Participant Journey
   - 8.2 Workshop Volunteer Journey
   - 8.3 Staff Admin Journey
9. [TypeScript Types & Appendix](#9-typescript-types--appendix)
   - 9.1 Core Types
   - 9.2 API Client Skeleton
   - 9.3 SSE Helpers
   - 9.4 QR Generation Sample

---

## 1. Core Concepts & Conventions

### 1.1 URL Structure & Base

All endpoints are prefixed with `/api/v1`. Your frontend should construct full URLs as:

```
https://your-backend-domain.com/api/v1{path}
```

Example:  
`GET /participants/statistics` → `https://backend.example.com/api/v1/participants/statistics`

### 1.2 HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success (body contains data) |
| 201 | Resource created (for POST) |
| 400 | Invalid request body, missing required fields, business rule violation |
| 401 | Invalid or expired token, or user not found |
| 403 | Insufficient permissions (wrong token type, role, or guard check) |
| 404 | Entity not found |
| 422 | Validation error (e.g., `limit` out of range 1–500) |
| 429 | Rate limit exceeded (embeddings, embeddings endpoint only) |
| 500 | Internal server error (defensive handler fallback) |

### 1.3 Pagination (limit & offset)

| Endpoint | Default | Min | Max |
|----------|---------|-----|-----|
| `/participants` | 200 | 1 | 500 |
| `/issues` | 100 | 1 | 500 |
| `/queries` | 100 | 1 | 500 |
| `/audit-logs` | 100 | 1 | 500 |

All paginated endpoints return:

```json
{
  "count": 200,
  "participants": [ ... ]
}
```

If `limit > 500`, the server returns `422 Unprocessable Entity`.

### 1.4 Request & Response Format

All requests (except QR scanning) expect `Content-Type: application/json`.  
Responses are JSON unless documented otherwise (e.g., SSE streams).

---

## 2. Authentication

### 2.1 Bearer Tokens

Use the `Authorization` header:

```http
Authorization: Bearer <access_token>
```

Tokens are JWTs issued by:
- `POST /auth/login` (participant token, `token_type: "participant"`)
- `POST /auth/admin/login` (staff token, `token_type: "staff"`)

Store tokens in memory or secure storage; avoid `localStorage`.

### 2.2 Public Routes (No Auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/events/public` | Public event list |
| GET | `/workshops/public` | Public workshop list |
| GET | `/workshop-slots` | List all time slots |
| GET | `/workshops/{id}/seats/stream` | Unauthenticated SSE for seats |
| POST | `/auth/register` | Participant registration |
| POST | `/auth/login` | Participant login |
| POST | `/auth/admin/login` | Staff login |
| POST | `/auth/password/forgot` | Request password reset (stub) |
| POST | `/auth/password/reset` | Reset password with token (stub) |

All other routes require `Authorization: Bearer`.

### 2.3 Staff vs Participant Credentials

The backend distinguishes staff (`token_type: "staff"`) from participant (`token_type: "participant"`) at the dependency layer.

If a participant token hits a staff-only route, you receive:

```
403 "Participant credentials required. Use /auth/login."
```

If a staff token hits a participant route, you receive:

```
403 "Staff credentials required. Use /auth/admin/login."
```

### 2.4 Token Refresh & Password Change

- **Refresh**: Re-login (`POST /auth/login`) to obtain a new token.  
- **Password Change**: `POST /auth/password/change` (Bearer required). Returns new token.

---

## 3. QR Code Handling

### 3.1 QR Generation (Backend)

Each participant is assigned a QR code upon registration. The code contains:

```json
{
  "uid": "DS23F1001726",
  "ts": 1723456789,
  "sig": "<base64_hmac_sha256>"
}
```

- `uid`: Participant ID
- `ts`: Unix timestamp (seconds)
- `sig`: HMAC-SHA256 signature of `(uid + ts)` using backend secret

### 3.2 QR Scanning (Frontend)

Send a POST to the relevant scan endpoint with JSON body:

```json
{
  "qr_code": "base64_encoded_qr_payload",
  "q": { ... }  // domain-specific query param as `q`
}
```

Example for workshop attendance scan:

```bash
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"qr_code": "ey...==", "q": {"scan_type": "pre-registered"}}' \
  https://backend.example.com/api/v1/workshops/WKSP111/attendance
```

### 3.3 Error Handling (400/404)

| Status | Detail | Fix |
|--------|--------|-----|
| 404 | `"Scanned user not found"` | Participant ID doesn't exist |
| 400 | `"User missing private key"` | Backend misconfiguration (rare) |
| 400 | `"QR Code expired"` | QR is older than 60 seconds (`QR_MAX_AGE=60`) |
| 400 | `"Invalid timestamp format"` | Backend couldn't parse timestamp |
| 400 | `"Invalid or corrupted QR code"` | Malformed JSON or signature mismatch |

### 3.4 Example QR Payload

```json
{
  "uid": "DS23F1001726",
  "ts": 1723456789,
  "sig": "abc123..."
}
```

Decode from base64 on the frontend to show debug info (do not verify signature on frontend).

---

## 4. Roles & Permissions Matrix

### 4.1 Super Admins (Staff)

Staff (token_type = "staff") can access:

| Endpoint Group | Permission String |
|----------------|-------------------|
| `/backend_teams/*` | `"Only Super Admins can manage backend teams"` |
| `/audit-logs/*` | `"Only Super Admins can view audit logs"` |
| `/queries/team/*` | `"Only Super Admins can manage the query team"` |
| `/events/*` (create/edit/delete) | `"Only Super Admins can perform this action"` |
| `/workshop-slots/*` | `"Only Super Admins can perform this action"` |
| `/mess/*` (admin create/edit) | `"Only Super Admins can perform this action"` |
| `/hostels/*` (admin create/edit) | `"Only Super Admins can perform this action"` |
| `/participants/*` (admin edit) | `"Not authorized"` (general staff guard) |

### 4.2 Participant Roles

Participants can hold `team_role` in events: `leader` or `member`.  
These are set via `PUT /events/{id}/participant_teams/{pid}`.

- `leader`: Can view team members, update team info.
- `member`: Read-only access to team data.

---

## 5. Time Windows & Scanning Logic

### 5.1 Workshop Scanning Windows

Workshop attendance scanning is time-gated. The backend computes the window:

| Scenario | Opens | Closes |
|----------|-------|--------|
| Pre-registered | 30 min before start | 30 min after start |
| On-spot | 15 min before start | 30 min after start |
| Changes (team_member update) | 0 min | 30 min after start |

If scanned outside the window:

```
403 "Scanning window not yet open. Opens N min before start (in ~M min)."
403 "Scanning window closed. It closes 30 min after the workshop starts."
```

### 5.2 Mess Hall Scanning Window

Each mess has a `SCAN_WINDOW=15` minutes centered on the slot start time.

```
403 "Scanning window not yet open for this slot"
403 "Scanning window closed for this slot"
```

### 5.3 Computed `is_open` Field

Events expose `registration.is_open` (computed at query time), combining:

- `registration.allowed`
- Current time within the event's registration window

Do not store this field — always fetch from `/events` or `/events/{id}`.

---

## 6. Domain-Specific Endpoints Reference

### 6.1 Auth & Profile

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | none | Create participant account |
| POST | `/auth/login` | none | Login as participant |
| POST | `/auth/admin/login` | none | Login as staff |
| POST | `/auth/password/forgot` | none | Request reset link (stub) |
| POST | `/auth/password/reset` | none | Reset password (stub) |
| POST | `/auth/password/change` | Bearer | Change password |
| PATCH | `/profile/complete` | Bearer | Complete participant profile |

#### Profile Complete Request

```json
{
  "full_name": "Jane Doe",
  "dob": "2003-05-12",
  "house": "Kanha",
  "gender": "female",
  "phone": "9876543210",
  "mess_preference": "north_indian__veg",
  "country": "India",
  "state": "MP",
  "city": "Bhopal",
  "address": "Sector 10",
  "emergency_contact": {
    "name": "John Doe",
    "phone": "9876543211",
    "relation": "father"
  },
  "program": "DS",
  "course_stage": "foundational",
  "event_preferences": ["technical", "sports"],
  "photo": "base64_image_or_url"
}
```

#### Login Response

```json
{
  "id": "DS23F1001726",
  "email": "ds23f1001726@iiti.ac.in",
  "access_token": "eyJ...",
  "token_type": "participant",
  "full_name": "Jane Doe",
  "dob": "2003-05-12",
  "house": "Kanha",
  "gender": "female",
  "phone": "9876543210",
  "country": "India",
  "state": "MP",
  "city": "Bhopal",
  "address": "Sector 10",
  "program": "DS",
  "course_stage": "foundational",
  "photo": "https://...",
  "public_key": "base64_public_key"
}
```

### 6.2 Participants & Statistics

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/participants/statistics` | Bearer | Overall participant stats |
| GET | `/participants` | Bearer | Paginated participant list |
| PATCH | `/participants/{participant_id}` | Bearer | Admin edit participant |

#### Participant Statistics Response

```json
{
  "total_registered": 1234,
  "profile_complete": 1100,
  "profile_incomplete": 134,
  "mess_registered": 800,
  "mess_allotted": 750,
  "hostel_registered": 600,
  "hostel_allotted": 550,
  "hostel_pending": 50,
  "currently_on_campus": 520,
  "with_event_registrations": 900,
  "with_workshop_registrations": 600,
  "by_house": {"Kanha": 120, "Saranda": 98, ...},
  "by_program": {"DS": 600, "MS": 400, "AE": 150, "ES": 84},
  "by_course_stage": {"foundational": 700, "diploma": 300, "degree": 234},
  "by_gender": {"male": 800, "female": 434},
  "signups_by_day": {"2026-08-01": 23, "2026-08-02": 45, ...}
}
```

### 6.3 Events

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/events` | Bearer | Create event (staff only) |
| GET | `/events` | Bearer | List events |
| GET | `/events/public` | none | Public event list |
| PUT | `/events/{event_id}` | Bearer | Update event |
| DELETE | `/events/{event_id}` | Bearer | Delete event |
| POST | `/events/{event_id}/team` | Bearer | Assign team member |
| PATCH | `/events/{event_id}/team/{team_user_id}` | Bearer | Update team member role |
| DELETE | `/events/{event_id}/team/{team_user_id}` | Bearer | Remove team member |
| POST | `/events/{event_id}/register` | Bearer | Register participant |
| PUT | `/events/{event_id}/register` | Bearer | Update registration |
| DELETE | `/events/{event_id}/register` | Bearer | Deregister |
| GET | `/events/my_registrations` | Bearer | My registrations |
| GET | `/events/{event_id}/capacity` | Bearer | Current registration count |
| GET | `/events/{event_id}/participation` | Bearer | Full participation data |
| POST | `/events/{event_id}/allocate_teams` | Bearer | Auto-allocate teams |
| POST | `/events/{event_id}/scan` | Bearer | Scan participant QR |
| GET | `/events/{event_id}/my_daily_scans` | Bearer | My daily unique scans |
| GET | `/events/{event_id}/logs` | Bearer | Event logs |
| PUT | `/events/{event_id}/participant_teams/{participant_id}` | Bearer | Update participant team |
| POST | `/events/{event_id}/announcements` | Bearer | Publish announcement |
| GET | `/events/{event_id}/announcements` | Bearer | List announcements |
| GET | `/events/{event_id}/announcements/stream` | Bearer | SSE stream |

#### Event Registration Response

```json
{
  "message": "Registered for event successfully.",
  "team_role": "leader",
  "team_id": "TM001"
}
```

#### Event Participation Response

```json
{
  "count": 120,
  "participants": [
    {
      "participant_id": "DS23F1001726",
      "name": "Jane Doe",
      "email": "ds23f1001726@iiti.ac.in",
      "phone": "9876543210",
      "house": "Kanha",
      "team_id": "TM001",
      "team_role": "leader"
    }
  ],
  "event_team": [
    {
      "user_id": "SA001",
      "role": "event_head",
      "name": "Admin User",
      "phone": "9999999999"
    }
  ],
  "total_daily_scans": 145
}
```

### 6.4 Workshops & Slots

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/workshop-slots` | Bearer | Create slot (super admin only) |
| GET | `/workshop-slots` | Bearer | List slots |
| PUT | `/workshop-slots/{slot_id}` | Bearer | Update slot |
| DELETE | `/workshop-slots/{slot_id}` | Bearer | Delete slot |
| POST | `/workshops` | Bearer | Create workshop |
| GET | `/workshops` | Bearer | List workshops |
| GET | `/workshops/public` | none | Public workshops |
| GET | `/workshops/my_registrations` | Bearer | My workshop registrations |
| PUT | `/workshops/{workshop_id}` | Bearer | Update workshop |
| DELETE | `/workshops/{workshop_id}` | Bearer | Delete workshop |
| POST | `/workshops/{workshop_id}/volunteers` | Bearer | Assign volunteer |
| PUT | `/workshops/{workshop_id}/volunteers/{user_id}/toggle_scan` | Bearer | Toggle volunteer scan flag |
| GET | `/workshops/{workshop_id}/logs` | Bearer | Workshop logs |
| POST | `/workshops/{workshop_id}/register` | Bearer | Register participant |
| GET | `/workshops/{workshop_id}/seats/stream` | none | SSE seats stream |
| POST | `/workshops/{workshop_id}/attendance` | Bearer | Scan attendance |
| GET | `/workshops/{workshop_id}/participation` | Bearer | Full participation |
| PATCH | `/workshops/{workshop_id}/participants/{participant_id}` | Bearer | Update participant record |
| DELETE | `/workshops/{workshop_id}/volunteers/{user_id}` | Bearer | Remove volunteer |

#### Workshop Attendance Request

```json
{
  "qr_code": "base64...",
  "q": {"scan_type": "pre-registered"}
}
```

Valid `scan_type` values: `"pre-registered"`, `"on-spot"`, `"changes"`.  
Validation order: `scan_type` first → then window.

#### Workshop Participation Response

```json
{
  "workshop_id": "WKSP111",
  "name": "React Advanced",
  "venue": "Lab 3",
  "slot_id": "S001",
  "start_time": "2026-08-30T10:00:00",
  "registration_start": "2026-08-20T00:00:00",
  "registration_end": "2026-08-29T23:59:59",
  "registration_open": true,
  "capacity": 100,
  "registration_count": 95,
  "participant_count": 87,
  "count": 95,
  "attended_count": 87,
  "absent_count": 8,
  "on_spot_count": 8,
  "workshop_team": [...],
  "participants": [...]
}
```

### 6.5 Mess Halls

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/mess` | Bearer | Create mess (staff only) |
| GET | `/mess` | Bearer | List messes |
| POST | `/mess/register` | Bearer | Request meal plan |
| DELETE | `/mess/register` | Bearer | Cancel meal plan |
| PUT | `/mess/{mess_id}` | Bearer | Update mess |
| DELETE | `/mess/{mess_id}` | Bearer | Delete mess |
| PUT | `/mess/{mess_id}/menu` | Bearer | Update menu |
| POST | `/mess/{mess_id}/team` | Bearer | Assign mess team |
| PUT | `/mess/{mess_id}/team/{team_user_id}/toggle_scan` | Bearer | Toggle mess team scan |
| POST | `/mess/allocate` | Bearer | Allocate participants |
| POST | `/mess/pay` | Bearer | Pay mess fee |
| GET | `/mess/my_mess` | Bearer | My mess details |
| POST | `/mess/{mess_id}/scan` | Bearer | Scan attendance |
| GET | `/mess/{mess_id}/statistics` | Bearer | Mess statistics |
| GET | `/mess/{mess_id}` | Bearer | Get mess by ID |

#### Mess Register Response

```json
{
  "message": "Meal plan requested"
}
```

### 6.6 Hostels

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/hostels` | Bearer | Create hostel |
| GET | `/hostels` | Bearer | List hostels |
| POST | `/hostels/{hostel_id}/team` | Bearer | Assign hostel team |
| PUT | `/hostels/{hostel_id}/team/{team_user_id}/toggle_scan` | Bearer | Toggle scan |
| POST | `/hostels/allocate` | Bearer | Allocate participants |
| POST | `/hostels/pay` | Bearer | Pay hostel fee |
| POST | `/hostels/register` | Bearer | Request accommodation |
| DELETE | `/hostels/register` | Bearer | Withdraw request |
| GET | `/hostels/my_hostel` | Bearer | My hostel details |
| POST | `/hostels/{hostel_id}/scan` | Bearer | Scan entry/exit |
| DELETE | `/hostels/{hostel_id}` | Bearer | Delete hostel |
| GET | `/hostels/{hostel_id}/statistics` | Bearer | Hostel statistics |
| GET | `/hostels/{hostel_id}` | Bearer | Get hostel |

#### Hostel Scan Request

```json
{
  "qr_code": "base64...",
  "q": {"action": "entry"}
}
```

Valid `q.action` values: `"entry"`, `"exit"`, `"permanent_exit"`.

### 6.7 Queries

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/queries` | Bearer | Raise a query |
| GET | `/queries/mine` | Bearer | My queries |
| GET | `/queries` | Bearer | List all queries (staff) |
| PATCH | `/queries/{query_id}` | Bearer | Update query |
| POST | `/queries/{query_id}/replies` | Bearer | Add reply |
| POST | `/queries/team` | Bearer | Add to query team (admin only) |
| GET | `/queries/team` | Bearer | Query team roster |
| DELETE | `/queries/team/{user_id}` | Bearer | Remove from team |

#### Query Creation

```json
{
  "title": "Hostel maintenance",
  "body": "Room 101 leak",
  "category": "hostel",
  "target_id": "HSTL111"
}
```

**Validation**: General queries (`category: "general"`) cannot specify `target_id`.

### 6.8 Issues

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/issues` | Bearer | Report an issue |
| GET | `/issues/mine` | Bearer | My issues |
| GET | `/issues` | Bearer | List all (staff) |
| PATCH | `/issues/{issue_id}` | Bearer | Update issue |

#### Issue Request

```json
{
  "title": "Leaking pipe",
  "description": "Kitchen pipe leaking",
  "type": "maintenance",
  "hostel_id": "HSTL111",
  "mess_id": "MESS01"
}
```

### 6.9 Audit Logs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/audit-logs/summary` | Bearer | Audit summary |
| GET | `/audit-logs` | Bearer | Paginated log rows |

#### Audit Summary Response

```json
{
  "total": 1234,
  "by_action": {"login": 456, "register": 321, ...},
  "distinct_actors": 15,
  "actor_ids": ["SA001", "SA002", ...],
  "meals": {"total_meals_served": 12000, "by_mess": {...}, "by_day": {...}},
  "window": {"since": "2026-08-01T00:00:00", "until": "2026-08-23T23:59:59"}
}
```

### 6.10 Embeddings

| Method | Path | Auth | Description |
|--------|------|-------------|
| POST | `/embeddings` | Bearer | Generate OpenAI-compatible embeddings |

Returns:

```json
{
  "object": "list",
  "data": [
    {
      "object": "embedding",
      "embedding": [0.123, -0.456, ...],
      "index": 0
    }
  ],
  "model": "text-embedding-3-small",
  "usage": {"prompt_tokens": 8, "total_tokens": 8}
}
```

Rate limit: `429` with `Retry-After` header.

---

## 7. Real-Time Streams & SSE

### 7.1 Announcements Stream

Open an SSE connection:

```http
GET /events/{event_id}/announcements/stream
Authorization: Bearer <token>
Accept: text/event-stream
```

Server sends:

```text
data: {"announcement_id": "ANN001", "message": "Event starts in 10 min", "priority": "high", "created_by": "SA001", "created_at": "2026-08-30T09:50:00"}

data: {"announcement_id": "ANN002", "message": "Entry closed", "priority": "high", "created_by": "SA001", "created_at": "2026-08-30T10:05:00"}
```

### 7.2 Workshop Seats Stream

Open unauthenticated SSE:

```http
GET /workshops/{workshop_id}/seats/stream
Accept: text/event-stream
```

Server sends seat count updates:

```text
data: {"seats_remaining": 87, "timestamp": "2026-08-30T09:55:00"}
```

---

## 8. Role Journeys & Screen Flows

### 8.1 Participant Journey

1. **Register** → `POST /auth/register`
2. **Login** → `POST /auth/login`
3. **Complete profile** → `PATCH /profile/complete`
4. **Register for events** → `POST /events/{id}/register`
5. **Check my registrations** → `GET /events/my_registrations`
6. **Register for workshops** → `POST /workshops/{id}/register`
7. **My workshop registrations** → `GET /workshops/my_registrations`
8. **Request mess** → `POST /mess/register`
9. **Check mess** → `GET /mess/my_mess`
10. **Request hostel** → `POST /hostels/register`
11. **Check hostel** → `GET /hostels/my_hostel`
12. **Raise query** → `POST /queries`
13. **Report issue** → `POST /issues`
14. **Scan at events/workshops/mess/hostel** → `POST /events/{id}/scan`, `POST /workshops/{id}/attendance`, `POST /mess/{id}/scan`, `POST /hostels/{id}/scan`

### 8.2 Workshop Volunteer Journey

1. **Login as staff** → `POST /auth/admin/login`
2. **Assign volunteers to workshop** → `POST /workshops/{id}/volunteers`
3. **Toggle volunteer scanning** → `PUT /workshops/{id}/volunteers/{user_id}/toggle_scan`
4. **View workshop participation** → `GET /workshops/{id}/participation`

### 8.3 Staff Admin Journey

1. **Login** → `POST /auth/admin/login`
2. **Create event** → `POST /events`
3. **Assign event teams** → `POST /events/{id}/team`
4. **Allocate event teams** → `POST /events/{id}/allocate_teams`
5. **Create workshop slot** → `POST /workshop-slots`
6. **Create workshop** → `POST /workshops`
7. **Create mess** → `POST /mess`
8. **Create hostel** → `POST /hostels`
9. **Allocate mess/hostel** → `POST /mess/allocate`, `POST /hostels/allocate`
10. **View audit logs** → `GET /audit-logs/summary`
11. **Manage backend teams** → `POST /backend_teams`
12. **Manage query team** → `POST /queries/team`

---

## 9. TypeScript Types & Appendix

### 9.1 Core Types

```ts
// Auth
interface AuthResponse {
  id: string;
  email: string;
  access_token: string;
  token_type: "participant" | "staff";
  full_name: string;
  dob: string;  // YYYY-MM-DD
  house: string;
  gender: "male" | "female";
  phone: string;
  country: string;
  state: string;
  city: string;
  address: string;
  program: "DS" | "MS" | "AE" | "ES";
  course_stage: "foundational" | "diploma" | "degree";
  photo: string;
  public_key?: string;
}

// Participant
interface Participant {
  participant_id: string;
  email: string;
  profile: Profile;
  mess: { registered: boolean; mess_id?: string };
  accommodation: { hostel_id?: string; room?: string; inside: boolean };
  created_at: string;
  updated_at: string;
  event_count: number;
  workshop_count: number;
}

// Event
interface Event {
  event_id: string;
  name: string;
  type: "technical" | "culturals" | "sports" | "others";
  date: string;
  venue: string;
  registration: {
    is_open: boolean;
    allowed: boolean;
    start: string;
    end: string;
  };
  capacity: number;
  registered: number;
  attended_today: number;
}

// Workshop
interface Workshop {
  workshop_id: string;
  name: string;
  venue: string;
  slot_id: string;
  start_time: string;
  registration_start: string;
  registration_end: string;
  registration_open: boolean;
  capacity: number;
  registration_count: number;
}

// Query
interface Query {
  query_id: string;
  title: string;
  body: string;
  category: "mess" | "hostel" | "technical" | "workshops" | "sports" | "culturals" | "uhc" | "general";
  target_id?: string;
  status: "open" | "in_progress" | "resolved";
  created_at: string;
  replies: QueryReply[];
}

interface QueryReply {
  author_id: string;
  author_type: "participant" | "staff";
  author_name: string;
  body: string;
  timestamp: string;
}

// Audit Log
interface AuditLog {
  log_id: string;
  action: string;
  actor_id: string;
  entity_type: string;
  entity_id: string;
  details: Record<string, unknown>;
  timestamp: string;
}
```

### 9.2 API Client Skeleton

```ts
class ParadoxClient {
  private baseUrl: string;
  private token?: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  setToken(token: string) {
    this.token = token;
  }

  private async request<T>(method: string, path: string, body?: any, isSSE = false): Promise<T | ReadableStream> {
    const url = `${this.baseUrl}${path}`;
    const headers: HeadersInit = { "Content-Type": "application/json" };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 429) {
      const retry = res.headers.get("Retry-After");
      throw new Error(`Rate limited. Retry after ${retry}s.`);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    if (isSSE) return res.body as ReadableStream;

    return res.json() as Promise<T>;
  }

  // Auth
  async register(data: RegisterRequest) { return this.request<PostResponse>("/auth/register", "POST", data); }
  async login(data: LoginRequest) { return this.request<AuthResponse>("/auth/login", "POST", data); }
  async adminLogin(data: AdminLoginRequest) { return this.request<AuthResponse>("/auth/admin/login", "POST", data); }

  // Events
  async getEvents() { return this.request<Event[]>("/events", "GET"); }
  async registerForEvent(eventId: string) { return this.request<RegisterResponse>(`/events/${eventId}/register`, "POST"); }
  async getMyEvents() { return this.request<MyRegistration[]>("/events/my_registrations", "GET"); }

  // Workshops
  async getWorkshops() { return this.request<Workshop[]>("/workshops", "GET"); }
  async registerForWorkshop(id: string) { return this.request<WorkshopRegistrationResponse>(`/workshops/${id}/register`, "POST"); }

  // SSE
  async listenToAnnouncements(eventId: string): Promise<ReadableStream> {
    return this.request(`/events/${eventId}/announcements/stream`, "GET", undefined, true);
  }
}
```

### 9.3 SSE Helpers

```ts
function parseSSE(stream: ReadableStream): AsyncGenerator<{ event: string; data: any }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return (async function* () {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = JSON.parse(line.slice(6));
          yield { event: "message", data };
        }
      }
    }
  })();
}
```

### 9.4 QR Generation Sample

```ts
import CryptoJS from "crypto-js";

const SECRET = process.env.QR_SECRET!;

function generateQR(uid: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ uid, ts });
  const sig = CryptoJS.HmacSHA256(payload, SECRET).toString(CryptoJS.enc.Base64);
  return btoa(JSON.stringify({ uid, ts, sig }));
}

function decodeQR(encoded: string): { uid: string; ts: number; sig: string } {
  const json = atob(encoded);
  return JSON.parse(json);
}

// Frontend usage
function scanQR(scanned: string) {
  const { uid, ts, sig } = decodeQR(scanned);
  const now = Math.floor(Date.now() / 1000);
  if (now - ts > 60) {
    alert("QR expired");
    return;
  }
  // Submit to backend
  fetch("/api/v1/workshops/WKSP111/attendance", {
    method: "POST",
    headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` },
    body: JSON.stringify({ qr_code: scanned, q: { scan_type: "pre-registered" } }),
  });
}
```

---

## Known Gaps & Stub Endpoints

### Currently Unimplemented (Stubs)

| Endpoint | Status | Reason |
|----------|--------|--------|
| `POST /auth/password/forgot` | Stub | Email service pending |
| `POST /auth/password/reset` | Stub | Email service pending |
| `GET /profile` | Missing | Profile read-only route not yet implemented |

### Pending Fixes

None — all known backend changes are reflected in this guide as of August 2026.

---

## Appendix A: Full Vocabularies

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
| `mess_preferences` | jain, north_indian__non_veg, north_indian__veg, south_indian__non_veg, south_indian__veg |
| `payment_methods` | card, netbanking, upi |
| `backend_team_roles` | admin, other, super_admin, volunteer |
| `backend_team_departments` | hostels, mess, technical, workshops, sports, culturals, uhc |

---

## Appendix B: Query Params Reference

| Endpoint | Param | Required | Description |
|----------|-------|----------|-------------|
| `/participants` | limit | no | 1–500, default 200 |
| `/participants` | offset | no | Pagination offset |
| `/issues` | limit | no | 1–500, default 100 |
| `/queries` | limit | no | 1–500, default 100 |
| `/audit-logs` | limit | no | 1–500, default 100 |
| `/mess/scan` | q:slot | yes | Mess slot ID |
| `/mess/scan` | q:day | yes | Day identifier |
| `/hostel/scan` | q:action | yes | entry, exit, permanent_exit |
| `/workshops/attendance` | q:scan_type | no | pre-registered, on-spot, changes |
| `/workshops/toggle_scan` | q:attendance | yes | attendance boolean |

---

**End of Guide**
