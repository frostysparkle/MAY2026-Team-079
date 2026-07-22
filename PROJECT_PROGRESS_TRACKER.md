# Paradox Connect — Project Progress Tracker

**Team:** blastoi-SE · **Team Code:** MAY2026-Team-079
**Purpose:** Single source of truth for project status. Anyone on the team should be able to read this and know what's done, what's pending, and what to work on next.

_Last updated: 11 Jul 2026_

---

## 1. Snapshot

| Area | Status |
|------|--------|
| Product & Requirements (PRD v1.2) | ✅ Complete |
| QR/TOTP + Security Architecture | ✅ Complete |
| Sprint 1 Planning & Review | ✅ Complete |
| **Frontend — Sprint 1** | ✅ Complete (mock-API backed, 35 tests passing) |
| **Backend — Sprint 1** | ✅ Auth complete; all 6 contract endpoints implemented |
| Frontend ↔ Backend integration | � Code complete on `feature/frontend-backend-integration`; pending live end-to-end run |

The frontend is fully built and runs today against an in-memory **mock API**. All six contract endpoints now exist on the backend, and the frontend has a real-API adapter that maps the backend's snake_case / `roles[]` shapes to its camelCase / single-`role` types. What remains is a **live end-to-end run** against a real MongoDB instance and real Google OAuth credentials (config only — no code blockers).

---

## 2. Completed Work

### Product & Documentation
- **PRD v1.2** — full scope, functional requirements, NFRs, risks, release plan (`docs/Paradox_Connect_PRD.md`).
- **QR/TOTP & Security Architecture** — digital ID design, offline model, revocation path (`docs/Paradox_Connect_QRTOTP_Architecture.md`).
- **Sprint 1 Frontend Plan + Review** — locked decisions, inconsistencies resolved, edge cases, assumptions (`docs/sprint1-frontend-review.md`).

### Frontend — Sprint 1 (all 10 plan sections)
- Project scaffold: Vite + React 19 + TypeScript (strict), Tailwind v4, Vitest.
- Typed **API contract** (`src/api/types.ts`) + swappable `ApiClient` (mock + real implementations).
- **Mock API** with real TOTP verification, replay protection, seed accounts per role.
- Reusable **UI component library** (Button, TextInput, ResultBanner, Spinner, Skeleton, Empty/Error states, Card, Nav Shell).
- **Splash / role landing**, **Google Sign-in** (IITM domain check, distinct error states).
- **Complete Your Profile** (single page, cascading Country→State→City, photo upload with validation + preview).
- **Home dashboard** + **Profile** view.
- **My QR ID** — on-device TOTP generation, works offline, per-checkpoint secret.
- **QR Scanner** (camera + manual fallback) and **Scan Result** (all 7 outcomes).
- **Admin User Management** with Super-Admin-only role assignment.
- **RBAC route guards** + **Access Denied** page.
- **PWA** manifest + offline service worker; encrypted IndexedDB secret store.
- Quality: 35 tests passing, clean typecheck, lint, and production build.

---

## 3. Pending Work

### Backend (Ashwin) — Sprint 1 priority
The frontend already defines the exact request/response shapes in `frontend/src/api/types.ts` and the expected endpoint paths in `frontend/src/api/realApi.ts`. These are the contract to implement.

- 🔲 **Google OAuth verification** server-side (replaces the old email+password `POST /register`).
- 🔲 **4-tier role model**: Participant → Organizer → Admin → Super Admin.
- 🔲 **One-time first Super Admin seed** (script or direct DB insert) before anyone logs in.
- 🔲 **`photos` collection** in MongoDB, separate from `participants`, linked by participant ID.
- 🔲 Core endpoints matching the frontend contract:
  - `POST /auth/google` — verify token, return session + `isNewUser`.
  - `POST /profile/complete` — save profile, store photo in `photos`.
  - `GET /admin/users` — list users (admin+).
  - `PATCH /admin/participants/{id}/role` — **Super Admin only**.
  - `POST /qr/provision` — issue per-checkpoint TOTP secret **once**.
  - `POST /scan/verify` — verify a scan against `checkpoint_context`, return one of the 7 result codes.
- 🔲 TOTP config must match frontend exactly: **SHA1, 6 digits, 30s period, ±1 window** (see `frontend/src/config/constants.ts`).

### Frontend — remaining / deferred
- 🔲 **Integration pass**: flip `VITE_USE_MOCK_API=false`, point at the real backend, resolve any contract drift.
- 🔲 (Deferred to Sprint 2) Animated QR countdown ring — basic numeric countdown ships now.
- 🔲 (Deferred to Sprint 2) Remember last selected role on the splash screen.

### Shared / Cross-cutting
- 🔲 Deployment: Vercel (frontend) + Render (backend) wiring.
- 🔲 Payments gateway integration (hostel/mess fees) — later sprint.
- 🔲 End-to-end test pass once backend is live.

---

## 4. Next Steps

### Ashwin (Backend) — start here, in order
1. **Stand up the FastAPI project** + MongoDB connection and the `participants` + `photos` collections.
2. **Implement `POST /auth/google`** (Google token verification + JWT session) — this unblocks the whole login flow.
3. **Add the 4-tier role field** and the **first Super Admin seed** step.
4. **Implement `POST /profile/complete`** (with photo → `photos` collection).
5. Then the QR endpoints (`/qr/provision`, `/scan/verify`) using the shared TOTP params, and finally the admin endpoints.

> Read `frontend/src/api/types.ts` (request/response shapes) and `frontend/src/api/realApi.ts` (paths, methods, auth header) first — they are the exact contract.

### Ravi (Frontend) — currently
- Frontend Sprint 1 is complete and committed. Now **available to support backend integration**: confirm the contract with Ashwin, then run the integration pass (mock → real) endpoint by endpoint as each backend route lands.

---

## 5. Dependencies & Blockers

| Item | Waiting on | Impact |
|------|-----------|--------|
| Frontend ↔ backend integration | Backend endpoints (Ashwin) | Frontend runs on mock today; real data blocked until endpoints exist |
| Scan verification end-to-end | `POST /scan/verify` + matching TOTP config | Cannot validate real scans until backend TOTP matches frontend params |
| Role assignment (live) | `PATCH /admin/participants/{id}/role` + Super Admin seed | Admin UI works on mock; real role changes blocked |
| Photo persistence | `photos` collection + `POST /profile/complete` | Profile photo stored as data URL in mock only |
| Deployment | Backend service on Render | Full staging environment blocked |

**Action item:** quick Ravi ↔ Ashwin sync to confirm the API contract before backend build begins — Registration (Story 7.1) now differs from the original email/password plan.

---

## 6. Key Technical Decisions (finalized — everyone follow these)

- **Auth:** Google Sign-in only, no passwords. Email domain must be one of the four IITM suffixes (`@ds`, `@es`, `@ee`, `@mg` `.study.iitm.ac.in`).
- **RBAC:** 4 tiers — Participant → Organizer → Admin → Super Admin. Role is **always resolved server-side**; the splash role buttons carry no permission. Route guards are UI-only; the backend is the real security boundary.
- **First Super Admin:** seeded once directly in the DB (backend task) — never created through the app UI.
- **Profile:** one full page. Photo stored in a **separate `photos` collection**, linked by participant ID — never embedded in the profile document. Photo limits: JPG/PNG, ≤ 750 KB.
- **Digital ID (QR):** per-participant, per-checkpoint **TOTP** secret. QR is generated **on-device** and works **offline** after first provisioning. The QR encodes only `{ participant_id, current_code }` — never the secret, never the checkpoint context.
- **Checkpoint context** is supplied by the **organizer app at scan time**, sent as `checkpoint_context` on the verify request.
- **TOTP params (must match on both sides):** SHA1, 6 digits, 30s period, ±1 window.
- **Scan outcomes (7):** Valid, Expired QR, Unknown Participant, Duplicate Scan, Wrong Checkpoint, Not Eligible, Payment Pending.
- **Stack:** React PWA (frontend) · FastAPI (backend) · MongoDB · JWT sessions · Vercel + Render hosting.
- **API boundary:** all frontend network access goes through one typed `ApiClient`; the mock and real backend are swappable via `VITE_USE_MOCK_API` with zero component changes.

---

## 7. Progress Status Checklist

**Legend:** ✅ Done · 🔄 In progress · 🔲 Pending

### Documentation & Planning
- [x] ✅ PRD v1.2
- [x] ✅ QR/TOTP & security architecture
- [x] ✅ Sprint 1 plan + frontend review
- [x] ✅ API contract defined (types + endpoint paths)

### Frontend (Sprint 1)
- [x] ✅ Scaffold, tooling, config
- [x] ✅ Reusable UI components + nav shell
- [x] ✅ Splash / role landing
- [x] ✅ Google Sign-in + domain check
- [x] ✅ Complete Your Profile
- [x] ✅ Home + Profile
- [x] ✅ My QR (offline TOTP)
- [x] ✅ Scanner + Scan Result (7 states)
- [x] ✅ Admin User Management + RBAC guards + Access Denied
- [x] ✅ PWA + encrypted secret store
- [x] ✅ Tests / lint / build green
- [x] ✅ Real-API adapter (snake_case→camelCase, `roles[]`→`role`), `/api/v1` base URL
- [ ] � Backend integration pass (mock → real) — code done, pending live run

### Backend (Sprint 1)
- [x] ✅ FastAPI project + MongoDB setup
- [x] ✅ `POST /auth/google` (OAuth verify + JWT)
- [x] ✅ 5-tier roles (+ `staff`) + first Super Admin seed
- [x] ✅ `POST /profile/complete` + `photos` collection
- [x] ✅ `GET /admin/users`
- [x] ✅ `PATCH /admin/participants/{id}/role` (Super Admin only, server-enforced)
- [x] ✅ `POST /qr/provision` (once-per-context secret, rotates on re-provision)
- [x] ✅ `POST /scan/verify` (7 result codes, `pyotp` SHA1/6/30/±1, replay protection)

### Epic 1 — Events (P0)
- [x] ✅ Backend: `GET /events`, `GET /events/{id}`, `POST /events`, `PATCH /events/{id}` (+ `events` collection/indexes, role-gated management)
- [x] ✅ Frontend: Events schedule, event detail + entry instructions, organizer/admin create & edit; nav + home link; mock seed data
- [x] ✅ Verified live against Atlas (create/publish/list/get) + build/lint/tests green

### Epic 6 — Query & Contact Management (P0)
- [x] ✅ Backend: `POST/GET /queries`, `GET /queries/manage` (admin+), `PATCH /queries/{id}` (admin+); `GET/POST /contacts`, `PATCH/DELETE /contacts/{id}` (admin+); collections + indexes
- [x] ✅ Frontend: Help & Support (raise query, track own queries, emergency + directory contacts), admin Query Triage, admin Contact Directory; nav + role-gated home hub
- [x] ✅ Verified live against Atlas incl. RBAC (participant triage → 403); build/lint/tests green

### Epic 4 — Mess (P0 + FR-4.4)
- [x] ✅ Backend: mess menu CRUD (organizer+), digital mess pass (`GET /mess/pass`), eligibility grant/revoke + listing (admin+), opt-in count (`GET /mess/stats`); mess scan now requires an explicit pass
- [x] ✅ Frontend: Mess screen (pass + menu + report issue), admin Mess management (menu CRUD, eligibility toggles, opt-in count); nav + hub links
- [x] ✅ Live-verified on Atlas (menu CRUD incl. 409 conflict, pass grant, scan not_eligible→valid); re-ran init_db to add events/queries/contacts/mess indexes

### Epic 5 — Hostel (P0 + FR-5.3/5.4)
- [x] ✅ Backend: `GET /hostel/allocation` (own), allocation CRUD (admin+, one per participant); hostel scan now checks allocation → records check-in (no allocation = not_eligible)
- [x] ✅ Frontend: Hostel screen (allocation, instructions, coordinator, check-in status, report-issue prefill), admin Hostel Allocations page; nav + hub links
- [x] ✅ Live-verified on Atlas (not_eligible→valid+checked_in, 409 dup guard, list/update/delete)

### Epic 3 — Attendance & Crowd (P1)
- [x] ✅ Backend: optional `event_id` on scan/verify; per-event attendance (distinct participants), remaining capacity, crowd status, and admin live dashboard
- [x] ✅ Frontend: scanner event selector, attendance/remaining on event detail (organizer+), crowd badge (participants), live-crowd dashboard (admin+, auto-refresh)
- [x] ✅ Live-verified on Atlas (scan→attendance 1, at_capacity, crowd full, dashboard)

### Epic 8 — Announcements (P1)
- [x] ✅ Backend: audience-scoped announcements (all/event/hostel/pors), server-side feed filtering, accountability log, admin-only send/delete
- [x] ✅ Frontend: participant Announcements feed + admin compose/log/delete; Home card + hub link
- [x] ✅ Live-verified on Atlas (RBAC 403, audience validation 422, filtered feed, log)
- Note: FR-8.2 registrant-only targeting is partial — no event-registration model in the MVP, so event announcements are event-tagged and shown to all.

### Shared
- [x] ✅ Ravi ↔ Ashwin API contract sync (`docs/api-contract.md`)
- [ ] 🔲 Deployment (Vercel + Render)
- [ ] 🔲 End-to-end test pass against live MongoDB + real Google OAuth
- [ ] 🔲 Payments integration (later sprint)
