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
| Total documented API operations | 31 endpoints across 5 primary domains (Events, Workshops, Mess, Hostels, Audit) |
| Total assertions executed (pytest) | ~45 independent endpoint assertions |
| Bugs found during Sprint 2 testing | Pre-existing race condition and state logic bugs fixed and closed |

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