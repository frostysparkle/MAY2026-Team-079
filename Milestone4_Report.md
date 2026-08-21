<div align="center">

# Software Engineering Project 
T2-2026
## Milestone 4 
### Sprint 2

**Submitted By**
**Team Name:** blastoi-SE  
**Team Code:** MAY2026-Team-079  

<br/><br/>

**IITM Online BS Degree Program,**  
**Indian Institute of Technology, Madras**

</div>

<div style="page-break-after: always;"></div>

## Paradox Connect Fest Management Platform

### Project Details
- **Software Name:** Paradox Connect
- **System Type:** Web Application & REST APIs
- **Sprint:** Sprint 2 (Milestone 4), 03 August 2026 to 12 August 2026
- **Date of Submission:** 12-08-2026

### Team Details
- **Team Name:** blastoi-SE
- **Team Code:** MAY2026-Team-079

| Name | Role |
| :--- | :--- |
| Anshuman Pandey | Product Manager / Backend Developer |
| Tanisha Agrawal | Scrum Master / Tester |
| Ashwin Devi S. | Backend Developer |
| Ravi Kumar K | Frontend Developer |
| Veer Shah | Code Reviewer |

### Sprint 2 Responsibilities
| Member / Role | Responsibility in Sprint 2 |
| :--- | :--- |
| Anshuman Pandey, PM / Backend | Implementation of feedback-driven endpoints, Event Management workflows, Audit Logging, and updates to the OpenAPI (Swagger) YAML |
| Tanisha Agrawal, Scrum Master / Tester | Extension of the pytest suites to the new endpoints (mess, hostels, events), regression of the Sprint 1 suite, compilation of this report |
| Ashwin Devi S., Backend | Implementation of dynamic mess slots enforcement and hostel state logic |
| Ravi Kumar K, Frontend | Integration of the Milestone 2 screens with the live backend APIs |
| Veer Shah, Reviewer | Review of every merge request before merge, security evaluation |

<div style="page-break-after: always;"></div>

### 1. Sprint 2 Overview

| Item | Details |
| :--- | :--- |
| Sprint window | 03-08-2026 to 12-08-2026 |
| Feedback items implemented | 3 of 3 — none deferred |
| Total documented API operations | 73 operations across 12 route groups (see §3 and §8) |
| Total assertions executed (pytest) | ~45 independent endpoint assertions |
| Bugs found during Sprint 2 testing | Pre-existing race condition and state logic bugs fixed and closed |

> **Post-sprint addendum, 20-08-2026.** Sections 1–7 record Sprint 2 as it was
> submitted. Section 8 records the work done after it, closing the last four
> epics of the requirements document. The operation count above is the current
> figure and supersedes the "31 endpoints" originally written here, which
> undercounted its own §3 tables.

### 2. Implementation of Sprint 1 User Feedback

**FB-01 — Full Portal Event Management**
- **Feedback:** Expand event endpoints beyond simple registration. Build workflows for team creation, scanning, and live dashboards.
- **Implemented Change:** Built a fully encrypted QR scanning pipeline via `POST /events/{event_id}/scan`. Implemented `GET /events/{event_id}/participation` for Event Heads and Super Admins. Upper House Council (UHC) members receive a filtered payload with `total_daily_scans` stripped. Added deterministic team allocation via `POST /events/{event_id}/allocate_teams` (House-based or Mixed-random).
- **Final Status:** Implemented — verified end-to-end.

**FB-02 — Robust Hostel Exit Logging**
- **Feedback:** Enforce state logic on hostel scan endpoints to eliminate ID sharing.
- **Implemented Change:** Implemented boolean tracking (`accommodation.logged_in`) in the participant document. `POST /hostels/{hostel_id}/scan?action=entry` throws `400 "Participant is already inside"` if `logged_in=True`. `action=exit` throws `400 "Participant is already outside"` if `logged_in=False`. Audit hooks (`HOSTEL_ENTRY` / `HOSTEL_EXIT`) log every successful scan to `system_logs`.
- **Final Status:** Implemented — verified stateful toggling in test suite.

**FB-03 — Dynamic Mess Slots Enforcements**
- **Feedback:** Calculate specific time-based slots (Breakfast, Lunch, Dinner) per day; prevent double-consuming.
- **Implemented Change:** `POST /mess/{mess_id}/scan?slot=breakfast&day=1` checks the participant's `mess.entries[day].slots[slot].logged` flag. A duplicate scan returns `400 "Already logged in for breakfast on day 1"`. Successful scans are written to `system_logs` via `MESS_SCAN` audit hook.
- **Final Status:** Implemented — verified duplicate scan returns 400 in test suite.

<div style="page-break-after: always;"></div>

### 3. Complete API Inventory

#### 3.1 All Implemented Endpoints

**Events** (`/events`)
| Method | Path | Description | Auth |
| :--- | :--- | :--- | :--- |
| POST | /events | Create event | Super Admin |
| GET | /events | List events | Authenticated |
| PUT | /events/{event_id} | Update event | Super Admin |
| DELETE | /events/{event_id} | Delete event | Super Admin |
| POST | /events/{event_id}/team | Assign team member | Super Admin |
| POST | /events/{event_id}/register | Register for event | Participant |
| PUT | /events/{event_id}/register | Edit registration | Participant |
| DELETE | /events/{event_id}/register | Deregister | Participant |
| GET | /events/my_registrations | View own registrations | Participant |
| GET | /events/{event_id}/participation | Participation data & stats | Admin / Event Team |
| POST | /events/{event_id}/allocate_teams | Auto-allocate teams | Super Admin |
| POST | /events/{event_id}/scan | Scan QR for participation | Event Team / Super Admin |
| GET | /events/{event_id}/my_daily_scans | Daily unique scan count | Event Team / Super Admin |

**Workshops** (`/workshops`)
| Method | Path | Description | Auth |
| :--- | :--- | :--- | :--- |
| POST | /workshops | Create workshop | Super Admin |
| GET | /workshops | List workshops | Authenticated |
| PUT | /workshops/{workshop_id} | Update workshop | Super Admin |
| DELETE | /workshops/{workshop_id} | Delete workshop | Super Admin |
| POST | /workshops/{workshop_id}/volunteers | Assign volunteer | Super Admin |
| PUT | /workshops/{workshop_id}/volunteers/{user_id}/toggle_scan | Toggle scan access | Super Admin |
| POST | /workshops/{workshop_id}/register | Register for workshop | Participant |
| POST | /workshops/{workshop_id}/attendance | Scan attendance (pre-reg / on-spot) | Volunteer / Super Admin |
| GET | /workshops/{workshop_id}/seats/stream | Real-time seat count (SSE) | Authenticated |
| GET | /workshops/{workshop_id}/logs | View full logs | Super Admin |

**Mess** (`/mess`)
| Method | Path | Description | Auth |
| :--- | :--- | :--- | :--- |
| POST | /mess | Create mess | Super Admin |
| GET | /mess | List messes | Authenticated |
| POST | /mess/{mess_id}/team | Assign team member | Super Admin |
| PUT | /mess/{mess_id}/team/{user_id}/toggle_scan | Toggle scan access | Super Admin |
| POST | /mess/allocate | Trigger auto-allocation | Super Admin |
| GET | /mess/my_mess | View own mess assignment | Participant |
| POST | /mess/{mess_id}/scan | Scan QR for meal slot | Mess Team / Super Admin |
| GET | /mess/{mess_id}/statistics | View statistics | Super Admin |

**Hostels** (`/hostels`)
| Method | Path | Description | Auth |
| :--- | :--- | :--- | :--- |
| POST | /hostels | Create hostel | Super Admin |
| GET | /hostels | List hostels | Authenticated |
| POST | /hostels/{hostel_id}/team | Assign team member | Super Admin |
| PUT | /hostels/{hostel_id}/team/{user_id}/toggle_scan | Toggle scan access | Super Admin |
| POST | /hostels/allocate | Trigger auto-allocation | Super Admin |
| GET | /hostels/my_hostel | View own hostel assignment | Participant |
| POST | /hostels/{hostel_id}/scan | Scan QR for entry/exit | Hostel Team / Super Admin |
| GET | /hostels/{hostel_id}/statistics | View statistics | Super Admin |

**Audit** (`/audit-logs`)
| Method | Path | Description | Auth |
| :--- | :--- | :--- | :--- |
| GET | /audit-logs | View system audit log | Super Admin only |

> The tables above are the Sprint 2 surface. Nine operations added afterwards —
> the `/queries` and `/issues` domains and the two participant-record routes —
> are tabulated in §8.2.

#### 3.2 External Libraries Used
- **FastAPI** — High performance REST framework
- **PyMongo** — MongoDB interaction and aggregation pipelines
- **Cryptography (Hazmat)** — RSA-OAEP QR payload encryption/decryption
- **Pytest 9.1.1** — Automated unit and integration test execution

<div style="page-break-after: always;"></div>

### 4. Frontend–Backend Integration
The role-based screens were connected to the live backend in this sprint:
- **Participant Flows:** Registration, Profile Completion, Workshop Registration, Event Dashboard, and dynamic QR Code generation using RSA-2048 keypair.
- **Volunteer Flows:** Scanning QR codes at Workshops, Events, Hostels, and Messes utilizing native device cameras.
- **Super Admin Flows:** Triggering algorithmic allocations (Hostels, Messes, Event Teams), and viewing the global Audit Log at `GET /audit-logs`.

### 5. API Testing Execution Report

#### 5.1 Testing Summary
| Metric | Result |
| :--- | :--- |
| Test files executed | 7 (`test_main.py`, `test_api.py`, `test_domain.py`, `testing/events/test_events.py`, `testing/hostels/test_hostels.py`, `testing/mess/test_mess.py`, `testing/workshops/test_workshops.py`) |
| Total assertions executed (pytest) | Over 200 independent endpoint assertions across 54 distinct test cases |
| Passed / Failed (final run) | 54 passed / 0 failed |
| Automated testing tool | pytest 9.1.1 |

#### 5.2 Detailed Test Cases
| TC ID | Test Function | API Tested | Method | Key Input | Expected Output | Result |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| TC101 | `test_mess_scanning` | `/mess/{id}/scan` | POST | Encrypted QR, slot="breakfast", day=1, **duplicate** | 400: `"Already logged in for breakfast on day 1"` | **Pass** |
| TC102 | `test_hostel_scanning` | `/hostels/{id}/scan` | POST | Encrypted QR, action="entry", **duplicate** | 400: `"Participant is already inside"` | **Pass** |
| TC103 | `test_uhc_stats_exclusion` | `/events/{id}/participation` | GET | UHC Member token | 200 OK, `"total_daily_scans"` key absent from payload | **Pass** |
| TC104 | `test_api_auth_register_invalid_email` | `/auth/register` | POST | `"bad_email@gmail.com"` | 400: `"Must be an @*.study.iitm.ac.in email"` | **Pass** |
| TC105 | `test_api_events_create_forbidden` | `/events` | POST | Standard participant token | 403: `"Only Super Admins can create events"` | **Pass** |
| TC106 | `test_workshop_pre_registration` | `/workshops/{id}/register` | POST | Participant token | 200: `"Successfully registered for workshop"`, log entry created in DB | **Pass** |
| TC107 | `test_workshop_attendance_pre_registered` | `/workshops/{id}/attendance` | POST | Encrypted QR, scan_type="pre-registered" | 200: `"Pre-registered attendee marked present"`, attendance log created in DB | **Pass** |
| TC108 | `test_daily_unique_scans_and_qr` | `/events/{id}/scan` → `/events/{id}/my_daily_scans` | POST → GET | Two scans of same QR | `daily_unique_scans == 1` (dedup enforced) | **Pass** |
| TC109 | `test_hostel_crud_and_allocation` | `/hostels/allocate` + `/hostels/my_hostel` | POST + GET | SA token, male participant | Room number `>= 100` | **Pass** |
| TC110 | `test_hostel_scanning` (exit) | `/hostels/{id}/scan?action=exit` | POST | Encrypted QR, action="exit" after entry | 200 OK; statistics shows `currently_inside == 0` | **Pass** |

#### 5.3 Showcased Fixed Bug (TC-FIX-01)
| Field | Details |
| :--- | :--- |
| **Test Case ID** | TC-FIX-01 |
| **API Tested** | `POST /workshops/{workshop_id}/attendance` |
| **Input** | Cryptographically valid QR payload with a timestamp backdated by 2 minutes (`datetime.utcnow() - timedelta(minutes=2)`) |
| **Expected** | 400 Bad Request: `"QR Code expired"` |
| **Actual (Initial)** | 200 OK — attendance marked incorrectly |
| **Root Cause** | The `verify_qr` dependency was not performing a UTC-aware delta comparison |
| **Fix Applied** | Added strict 60-second UTC-aware validation block in `dependencies.py` |
| **Result After Fix** | **Pass** — 400 correctly thrown for all expired payloads |

### 6. Bug Tracking Summary
- **Issue #43 (Fixed):** Missing automated test coverage for Mess/Hostel/Event scan endpoints and missing Milestone 4 edge cases. Built comprehensive `test_mess.py`, `test_hostels.py`, `test_events.py` suites and a new root `test_domain.py` suite covering all TCs and security edge cases (e.g., UHC stats exclusion).
- **Issue #44 (Fixed):** Missing security audit trail on key state-changing endpoints. Resolved by adding `log_audit()` hooks to the following routes: `CREATE_EVENT`, `UPDATE_EVENT`, `DELETE_EVENT`, `ASSIGN_EVENT_TEAM`, `EVENT_REGISTER`, `EVENT_DEREGISTER`, `ALLOCATE_EVENT_TEAMS`, `CREATE_WORKSHOP`, `UPDATE_WORKSHOP`, `DELETE_WORKSHOP`, `CREATE_MESS`, `ASSIGN_MESS_TEAM`, `ALLOCATE_MESSES`, `MESS_SCAN`, `CREATE_HOSTEL`, `ASSIGN_HOSTEL_TEAM`, `ALLOCATE_HOSTELS`, `HOSTEL_ENTRY`, `HOSTEL_EXIT`. All logs are persisted to the `system_logs` collection and accessible via `GET /audit-logs` (Super Admin only).
- **Issue #45 (Fixed):** Testing environment instability due to cross-test state leaks and mongomock incompatibilities. Fixed by implementing rigorous test cleanup fixtures (`delete_many({})`) across all suites, adding root `conftest.py` files to guarantee `TESTING=1`, rewriting `array_filters` MongoDB updates in `routers/mess.py` for mongomock compatibility, and correcting test seed schemas.
- **Issue #46 (Fixed):** Pydantic V2 `.dict()` deprecation warnings flooding test outputs and causing future upgrade risk. Found and replaced all `.dict()` calls with `.model_dump()` across `main.py` and `events.py`.

### 7. Plan for Milestone 5 (Final Sprint, 13–23 August 2026)
- Full end-to-end demo of the running application.
- Final pytest run with captured output statistics.
- AI features implementation (discussion pending)

<div style="page-break-after: always;"></div>

### 8. Post-Sprint Addendum — Closing the Remaining Epics (20 August 2026)

This section records work done after the Sprint 2 submission above. It exists
because a delivery audit against the requirements document (`Delivery_Audit.md`)
found that **6 of the 31 user stories were still open**, all of them behind one
missing capability. They are now closed.

### 8.1 What was open, and why

The audit's own finding was that everything remaining sat behind a single gap:
**the API had no channel by which a participant could write text that a
different user could read back.** Every participant-writable field failed one
half or the other — `events[].registration_data` is returned only to its own
author, `team_id` is the event's team data that `allocate_teams` reads,
`profile.*` is the identity every roster prints. So five stories could not be
built at all, and a sixth was half-built.

| Story | Epic | Status before | Status now |
| :--- | :--- | :--- | :--- |
| 6.1 Raise a query | 6 — Query & Contact Management | Not built | **Shipped** |
| 6.2 Track its status | 6 | Not built | **Shipped** |
| 6.3 Assign it to a team | 6 | Not built | **Shipped** |
| 6.4 Help participants as POR / POC | 6 | Not built | **Shipped** |
| 5.4 Report a hostel or mess issue | 5 — Hostel & Accommodation | Not built | **Shipped** |
| 7.3 Manage participant records from one dashboard | 7 — Integrated Profile | Partial — view only | **Shipped** |
| 9.1 Operational dashboard | 9 — Admin Visibility | Partial — two panels missing | **Shipped** |

**All 9 epics and all 31 user stories are now delivered.**

Two new backend domains were added, on the project owner's explicit
authorisation, since `CLAUDE.md` freezes `backend/`:

- **`/queries`** — the general question-and-answer channel Epic 6 needed. A
  query is about anything at the fest: an event's rules, a workshop's
  prerequisites, a hall's timings, or nothing in particular.
- **`/issues`** — the maintenance record Story 5.4 needed. An issue is a *fault*
  in a facility the reporter is actually placed in, with a room number and a
  repair.

They are deliberately two domains rather than one, because their guards
genuinely differ: filing an issue requires being allotted to the facility, while
asking a question about an event only requires being at the fest.

Both changes are **additive**. No existing route, HTTP verb, query parameter,
request or response field name, status code, or error `detail` string was
altered, and no existing backend test needed editing.

### 8.2 New API operations

**Queries** (`/queries`) — Epic 6
| Method | Path | Description | Auth |
| :--- | :--- | :--- | :--- |
| POST | /queries | Raise a query (6.1) | Participant |
| GET | /queries/mine | Track own queries, with replies (6.2) | Participant |
| GET | /queries | The staff queue, scoped to the caller's teams (6.3) | Staff |
| PATCH | /queries/{query_id} | Set status and assignment (6.3) | Owning team / Super Admin |
| POST | /queries/{query_id}/replies | The conversation (6.4) | Author or owning team |

**Issues** (`/issues`) — Story 5.4
| Method | Path | Description | Auth |
| :--- | :--- | :--- | :--- |
| POST | /issues | File a hostel or mess fault | Participant, placed in that facility |
| GET | /issues/mine | Own reports with their status history | Participant |
| GET | /issues | The duty queue, scoped to the caller's blocks and halls | Staff |
| PATCH | /issues/{issue_id} | Move a report along, and answer the reporter | Facility team / Super Admin |

**Participants** (`/participants`) — Story 7.3
| Method | Path | Description | Auth |
| :--- | :--- | :--- | :--- |
| GET | /participants | Fest-wide roster, searchable by name / email / ID | Super Admin only |
| PATCH | /participants/{participant_id} | Correct another person's profile | Super Admin only |

`backend/openapi.json` was regenerated (60 paths, 73 operations; nothing
removed) and `api_documentation.yaml` gained the matching hand-written entries
and request schemas.

### 8.3 Design decisions worth recording

**Epic 6.4 needed no new role.** The obvious reading of "help participants as
POR / POC" was to add a `por` / `poc` value to `backend_teams.role`. It was not
done. A query is routed from its own `category` + `target_id` to that entity's
existing team array — `hostel_team`, `mess_team`, `event_team`,
`workshop_team` — which is the same membership test the scanners already
authorise against. The people already named on those teams *are* the points of
contact, so 6.4 ships with no schema change and no existing guard moved.

**A query row carries no email and no phone.** A block's `hostel_team` cannot
read `GET /hostels/{id}/statistics` — that is Super Admin only — so
denormalising contact details onto a row any team member can fetch would have
widened disclosure well past what answering a question needs. The row carries
the asker's name and house; the reply thread is the channel back.

**A staff member on no team gets an empty queue, not a 403.** Having no duty is
a real state, and a console that errors at a volunteer between postings reads as
a bug.

**Story 7.3's write path is deliberately narrow.** Only `profile` fields are
editable. `email` and `participant_id` are identity — the id is derived from the
email and is the key every roster, log row, and QR payload joins on.
`password_hash` and `qr_secrets` are credentials. Mess, accommodation, event and
workshop state belongs to the allocation and registration routes, which enforce
capacity and scan state; an admin writing them directly could seat somebody in a
full hall or mark them inside a block the scanner thinks they left.

**The dashboard reads only what it can prove.** Story 9.1's new panel shows a
dash and names the failed read rather than a confident zero. A partial total that
looks complete is the one failure mode a monitoring board must not have.

### 8.4 New screens

| Screen | Route | Stories |
| :--- | :--- | :--- |
| My Queries — ask, and read the answer | `/app/queries` | 6.1, 6.2 |
| Report an Issue — file a fault, track the repair | `/app/report-issue` | 5.4 |
| Query desk — the queue a team answers from | `/staff/queries` | 6.3, 6.4 |
| Issues desk — the duty queue for reported faults | `/staff/issues` | 5.4 |
| Participants — the fest-wide roster, and the one place a record can be corrected | `/staff/admin/participants` | 7.3 |
| Support panel on the Fest Control Board — open queries and open faults | `/staff/admin/overview` | 9.1 |

The two staff consoles are **duty** routes rather than admin ones: `GET /queries`
and `GET /issues` both admit anybody named on a block's, hall's, event's or
workshop's team, and hand a Super Admin the whole fest through the same screen.
The participants screen is admin-only, because both routes behind it are.

### 8.5 Verification

Every figure below was produced by an actual run, not read off the source.

| Check | Command | Result |
| :--- | :--- | :--- |
| Backend suite | `python3 -m pytest -q` from `backend/` | **227 passed**, 0 failed (282s) |
| Type check | `npx tsc -b --noEmit` from `frontend/` | clean |
| Frontend suite | `npx vitest run` | **742 passed** across 52 files, 0 failed |
| Lint | `npx eslint .` | **0 errors** (28 warnings, all pre-existing classes) |
| Format | `npx prettier --check .` | clean |
| Production build | `npm run build` | passing |

The backend suite went from 128 to 227 tests. The 99 new ones are 42 in
`backend/testing/queries/test_queries.py`, 36 in
`backend/testing/issues/test_issues.py`, and 21 in
`backend/testing/participants/test_participant_admin.py`. **Every one of the 128
that existed before still passes unchanged.** Most of the new assertions are
about who is *refused* rather than what works — a volunteer on one block must
not read another block's queries, a participant must not read a thread they did
not raise, and an admin's edit must not reach a field the allocation routes own.

The frontend suite gained **113 tests across 6 new files**: the two pure
resolvers (`features/queries/queries.test.ts`,
`features/participants/participantAdmin.test.ts`), the two screens a user
actually opens (`pages/QueriesPage.test.tsx`,
`pages/staff/QueryConsolePage.test.tsx`), the staff desk
(`pages/staff/admin/AdminParticipantsPage.test.tsx`), and the dashboard panel
(`features/overview/panels/SupportPanel.test.tsx`).

**The contract was checked end to end, not just on both sides of a mock.** The
frontend tests mock the API and the backend tests use hand-written bodies, so a
shape mismatch would have passed both. The exact request bodies and query strings
the frontend builds were therefore serialised and sent at the real routes against
a real participant, a real volunteer, and a real Super Admin — 19 checks, all
passing, covering the `POST /queries` body for both a targeted and a `general`
query, the `PATCH` bodies for a status change and a claim, replies in both
directions, and the roster's JSON-serialisability (a naive projection returns raw
ObjectIds and 500s, so that one is a real risk rather than a formality).

#### Two things stated plainly

- **Delivery is on next open, not push.** A reply to a query, like an
  announcement and like a schedule-change alert, appears the next time the
  participant opens the app. There is still no subscription store and no send
  route, so true push remains an improvement to shipped stories rather than a
  blocker on unbuilt ones.
- **`api_documentation.yaml` is behind on two operations that are not part of
  this work.** `GET /workshops/public` and `PUT /mess/{mess_id}/menu` are in
  `openapi.json` and have no hand-written YAML entry. Both belong to other
  in-flight changes and were left alone rather than folded into this diff. They
  are named here so the gap is recorded rather than discovered later.

### 8.6 Requirements coverage — final position

| Epic | Stories | Delivered |
| :--- | :---: | :---: |
| 1 — Centralized Event Information and Updates | 4 | 4 |
| 2 — Easy Identification and Entry Management | 2 | 2 |
| 3 — Event Attendance and Crowd Information | 4 | 4 |
| 4 — Mess Information and Mess Entry | 4 | 4 |
| 5 — Hostel and Accommodation Management | 4 | 4 |
| 6 — Query and Contact Management | 5 | 5 |
| 7 — Integrated Participant Profile | 3 | 3 |
| 8 — Communication Between Teams | 2 | 2 |
| 9 — Admin Visibility and Coordination | 3 | 3 |
| **Total** | **31** | **31** |

`Delivery_Audit.md` carries the story-by-story detail, the judgement calls, and
the limitations each story shipped with.