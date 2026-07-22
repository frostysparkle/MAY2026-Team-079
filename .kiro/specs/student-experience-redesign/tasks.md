# Implementation Plan

## Overview

Incremental, test-verified tasks that build the student-first journey, event
registration, and the test harness on top of the existing modules. Each task is
scoped to a few files, ends green (frontend typecheck + lint + vitest + build;
backend pytest), and cites the requirements it fulfills. Backend and frontend of
each slice ship together so the mock and real paths stay in sync.

## Tasks

- [x] 1. Backend: onboarding intent + derived journey
  - [x] 1.1 Add `users.onboarding` intent fields and a settings flag scaffold
    - Read/write `onboarding.{accommodation_choice, mess_choice, mess_plan_id}` (additive; default absent → null).
    - Add `enable_dev_login` to `Settings`/`get_settings` (`APP_ENV != "production"` AND `ENABLE_DEV_LOGIN == "true"`); update `.env.example` and the test `make_settings`.
    - _Requirements: 3.1, 10.4, 13.2_
  - [x] 1.2 Build the journey service (pure `next_step`/`complete` resolver)
    - `app/journey/service.py`: compute journey from user + hostel allocation + latest hostel/mess payments + `access.mess_eligible` + registration count.
    - Unit-test the resolver across the state matrix (Property 1, 2, 3).
    - _Requirements: 2.1, 2.2, 2.7, 2.8, 3.1_
  - [x] 1.3 Expose `GET /me/journey` + onboarding intent endpoints
    - `app/journey/routes.py`: `GET /me/journey`; `POST /me/onboarding/accommodation`; `POST /me/onboarding/mess`; `GET /me/payments/pending`.
    - Accommodation "yes" ensures a `created` hostel payment; mess "yes" stores plan id. Wire router into `app/main.py`.
    - _Requirements: 2.3, 2.4, 2.5, 3.2, 3.3, 4.1, 4.3, 5.1, 5.2, 6.1_

- [x] 2. Backend: participant-side event registration
  - [x] 2.1 Registration service + capacity/duplicate rules
    - `app/registrations/service.py`: register (published + not-full + idempotent), cancel (soft), list-with-event-details, count active per event.
    - Unit-test capacity, duplicate/idempotent, cancel/re-activate (Property 4, 5).
    - _Requirements: 7.2, 7.4, 7.5_
  - [x] 2.2 Registration routes + event read-field annotations
    - `POST/DELETE /events/{id}/register`, `GET /me/registrations`.
    - Add `registered`, `registration_count`, `spots_left` to events list/detail responses (per caller).
    - _Requirements: 7.1, 7.3, 7.4, 7.6_

- [x] 3. Backend: test harness (seed + gated dev login)
  - [x] 3.1 Dev-login + test-accounts endpoints (gated)
    - `app/auth/dev_login.py`: `POST /auth/dev-login {email}` issues a JWT for a seeded active user; `GET /auth/test-accounts` lists them. Both 404 when `enable_dev_login` is false.
    - Unit-test gating (404 disabled; token + 200 enabled) — Property 8.
    - _Requirements: 10.3, 10.4, 10.5_
  - [x] 3.2 Idempotent seed script for the Req-10 account matrix
    - `scripts/seed_test_data.py`: upsert accounts (newbie, profileonly, hosteler, hostelunpaid, messie, fullstack, eventfan, paidpending, volunteer, warden) with consistent supporting rows (allocations, payments, mess eligibility, registrations, onboarding intent) + a few seed events/meal plans.
    - Print how to re-seed/reset; document in `backend/README.md`.
    - _Requirements: 10.1, 10.2, 10.6_
  - [x] 3.3 Live smoke of the full pipeline + seed verification (Atlas, cleaned up)
    - Disposable user: profile → accommodation intent → mess plan → mock-settle payments → register events → journey `complete`; then delete. Re-run `init_db`; verify each seeded account resolves to its intended journey state.
    - _Requirements: 2.4, 3.1, 4.1, 5.1, 6.3, 7.2, 10.2_

- [ ] 4. Frontend: API contract + journey plumbing
  - [ ] 4.1 Types + ApiClient + realApi adapter + mock
    - Add `Journey`, `JourneyStep`, `EventRegistration`, `PendingPaymentItem`, `TestAccount` to `api/types.ts`; add the new methods to `ApiClient`, `realApi` (snake↔camel), and `mockApi`.
    - Extend mock fixtures with the seeded account states + seed registrations so the mock mirrors the real harness.
    - _Requirements: 3.3, 7.2, 10.5, 13.3_
  - [ ] 4.2 `useJourney` hook + journey-driven post-login routing + guards
    - `features/journey/`: pure step model + `useJourney`; update `postLoginRoute` to route via `next_step`; onboarding guards redirect out-of-order deep links.
    - Unit-test the pure step model.
    - _Requirements: 1.4, 2.2, 2.5, 2.8, 11.4_

- [ ] 5. Frontend: student-first entry + onboarding pipeline
  - [ ] 5.1 Student-first landing
    - Rework Splash so the primary CTA is student register/sign-in; demote organizer/admin to a secondary link. Preserve the "Paradox Connect" heading and portal labels used by tests.
    - _Requirements: 1.1, 1.2, 1.3, 12.2_
  - [ ] 5.2 Onboarding layout + steps with progress
    - `pages/onboarding/OnboardingLayout` renders the current step from journey with a progress header; steps: Profile (reuse CompleteProfile), Accommodation (opt), Mess (opt, plan select), Payment (pending items → hosted checkout), Events (prompt).
    - Skip/continue for optional steps; empty-payment bypass; resume at `next_step`.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 4.1, 5.1, 6.1, 11.1, 12.4_

- [ ] 6. Frontend: event registration + passes + student home
  - [ ] 6.1 Event detail/list registration UI
    - Register/cancel on event detail; "Registered"/"Full" states; list shows registered badge; My Events surfaced.
    - _Requirements: 7.1, 7.3, 7.4, 7.5, 7.6, 11.3_
  - [ ] 6.2 Passes view + schedule access
    - `PassesPage`: QR digital ID + per-registered-event pass access; schedule by day/time reachable; announcements within one interaction.
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  - [ ] 6.3 Reworked student Home + refined nav
    - Home sections: continue-setup (while incomplete), my events, my pass, bookings & payment status, announcements (unread indicator), quick links — each with loading/empty/error/success. Refine student nav (Home · Events · My Pass · More · Profile).
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 9.4, 11.2, 11.3_

- [ ] 7. Frontend: dev-only account switcher
  - [ ] 7.1 AccountSwitcher (dev/mock only)
    - `features/devtools/AccountSwitcher`: rendered only when `env.enableDevSwitcher`; lists `listTestAccounts()` grouped by state; tap → `devLogin` (real) or switch `currentId` (mock) → reload journey → route. Not rendered in production; add `VITE_ENABLE_DEV_SWITCHER` + docs.
    - _Requirements: 10.3, 10.4, 10.5_

- [ ] 8. Integration, docs, and verification
  - [ ] 8.1 End-to-end verification pass
    - Frontend typecheck + lint (0 errors) + vitest green + build; backend pytest green; live smoke clean. Confirm offline QR + installable PWA still hold.
    - _Requirements: 12.1, 12.5, 13.1, 13.3_
  - [ ] 8.2 Update contract + tracker docs
    - Extend `docs/api-contract.md` with journey/registration/dev-login endpoints; update `PROJECT_PROGRESS_TRACKER.md` and `backend/README.md`.
    - _Requirements: 10.6, 13.1_

## Task Dependency Graph

Tasks in the same wave can proceed in parallel; each wave depends on the ones
before it.

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"], "depends_on": [] },
    { "wave": 2, "tasks": ["2"], "depends_on": ["1"] },
    { "wave": 3, "tasks": ["3", "4"], "depends_on": ["1", "2"] },
    { "wave": 4, "tasks": ["5"], "depends_on": ["4"] },
    { "wave": 5, "tasks": ["6", "7"], "depends_on": ["3", "4", "5"] },
    { "wave": 6, "tasks": ["8"], "depends_on": ["5", "6", "7"] }
  ]
}
```

## Notes

- Backend keeps snake_case + `roles[]`; the frontend `realApi` adapter maps to
  camelCase (never change component-facing types).
- New collections/indexes (none expected beyond reusing `event_registrations`)
  require re-running `scripts/init_db.py`; live smokes create disposable data and
  clean it up.
- Do not weaken server-side RBAC; dev-login stays hard-gated behind
  `enable_dev_login` and is never shipped to production.
- Ship each slice's backend + mock together so the app works on the mock in dev
  and the real backend in integration with no component changes.
