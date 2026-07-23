# Requirements Document

## Introduction

Paradox Connect is a mobile-first PWA for the IIT Madras BS fest, Paradox. The
platform already has working modules for authentication (email + password),
profile completion, events, mess, hostel, queries/contacts,
announcements, attendance, payments (mock gateway), and an admin/operations
surface.

However, the current entry experience is a neutral "portal picker" (Student /
Organizer / Admin) that does not reflect reality: the overwhelming majority of
users are **students**, and their journey should be the spine of the product.
This spec reorients the application around a single, seamless student journey —
**register → complete profile → (optionally) book accommodation → (optionally)
book mess → pay → register for events → participate** — and adds a comprehensive
**test-account harness** so the whole journey can be exercised without manually
creating data.

The reference point for scope, information architecture, and professionalism is a
large college-fest platform (e.g., techfest.org): a clear student journey, rich
event presentation, obvious registration workflows, and a coherent navigation
hierarchy. This is inspiration for structure, not a visual copy.

### Scope

In scope: student-first entry and onboarding pipeline, onboarding/progress state,
participant-side event registration, a student home that surfaces passes,
bookings, payments, schedule and notifications, and a dev-only test-account
harness with an account switcher.

Out of scope (unchanged from prior specs): the TOTP/QR security model, admin
operational tooling internals, and the real payment-gateway integration (the
mock gateway remains; a real provider stays swappable).

## Glossary

- **Onboarding step**: one stage of the student journey (register, profile,
  accommodation, mess, payment, events).
- **Onboarding state**: the persisted record of which steps a student has
  completed, used to resume and to drive the home surface.
- **Event registration**: a participant's enrolment in a specific event
  (distinct from admin event management).
- **Pass**: the participant's QR digital ID, and any per-event ticket derived
  from an event registration.
- **Test harness**: dev-only seeded accounts + a switcher for manual QA.

---

## Requirements

### Requirement 1: Student-first entry point

**User Story:** As a first-time student, I want the app to open directly into a
student-focused sign-up/sign-in, so that I can start registering for Paradox
without having to understand internal roles.

#### Acceptance Criteria

1. WHEN an unauthenticated user opens the application root THE SYSTEM SHALL
   present a student-oriented landing whose primary call to action is "Register
   / Sign in as a student" using an email and password.
2. THE SYSTEM SHALL provide access to Organizer and Admin entry points from the
   landing WITHOUT making them the primary or most prominent action.
3. WHEN a user registers or signs in THE SYSTEM SHALL validate the email and
   password and display a clear message when the credentials are invalid.
4. WHEN a returning student signs in THE SYSTEM SHALL route them to the next
   incomplete onboarding step, or to the student home if onboarding is complete.
5. THE SYSTEM SHALL treat the resolved server-side role as the source of truth
   for permissions; the chosen entry point SHALL carry no permission.

### Requirement 2: Guided onboarding pipeline

**User Story:** As a newly registered student, I want a guided, step-by-step
onboarding, so that I complete everything required to participate without
guessing what to do next.

#### Acceptance Criteria

1. THE SYSTEM SHALL define the onboarding order as: (1) account/registration,
   (2) profile completion, (3) accommodation booking [optional],
   (4) mess booking [optional], (5) payment for selected bookings,
   (6) event registration.
2. WHILE a student has not completed their profile THE SYSTEM SHALL direct them
   to profile completion before any booking, payment, or event-registration step.
3. WHERE a step is marked optional (accommodation, mess) THE SYSTEM SHALL allow
   the student to skip it and continue the journey.
4. WHEN a student completes a step THE SYSTEM SHALL advance them to the next
   incomplete step and reflect the new progress in the onboarding state.
5. WHEN a student leaves and later returns THE SYSTEM SHALL resume at the next
   incomplete step rather than restarting the pipeline.
6. THE SYSTEM SHALL display, at each step, the student's overall progress
   through the pipeline (e.g., step N of M and which steps remain).
7. IF a student has skipped all optional bookings and has nothing to pay THEN
   THE SYSTEM SHALL bypass the payment step and proceed to event registration.
8. WHEN onboarding is complete THE SYSTEM SHALL route the student to the student
   home and SHALL NOT force the pipeline again on subsequent visits.

### Requirement 3: Onboarding progress and status model

**User Story:** As a student, I want the app to remember exactly how far I've
gotten, so that my progress, bookings, and payments are always accurate and
resumable across devices.

#### Acceptance Criteria

1. THE SYSTEM SHALL derive each student's onboarding state from authoritative
   server-side data (profile completeness, accommodation/mess selections,
   payment status, event registrations) rather than a separate parallel copy.
2. WHEN any underlying record changes (profile saved, booking made, payment
   settled, event registered) THE SYSTEM SHALL reflect the change in the
   student's onboarding state without requiring a reinstall or manual refresh
   beyond a normal reload.
3. THE SYSTEM SHALL expose the student's current onboarding state to the
   frontend in a single, coherent shape that the home and pipeline both consume.
4. IF the onboarding state cannot be loaded THEN THE SYSTEM SHALL show a
   recoverable error state with a retry action rather than a blank screen.

### Requirement 4: Accommodation booking (optional step)

**User Story:** As an outstation student, I want to request/select hostel
accommodation during onboarding, so that I have a place to stay during the fest.

#### Acceptance Criteria

1. THE SYSTEM SHALL let a student indicate whether they need accommodation as an
   explicit optional choice during onboarding.
2. WHEN a student opts into accommodation THE SYSTEM SHALL record that intent and
   surface the resulting allocation/details (block, room, instructions,
   coordinator) once assigned, reusing the existing hostel module.
3. WHERE accommodation requires payment THE SYSTEM SHALL mark the accommodation
   as pending payment until payment is settled.
4. WHEN a student declines accommodation THE SYSTEM SHALL record the decline and
   continue onboarding without an accommodation obligation.
5. THE SYSTEM SHALL display an explicit "no accommodation" state on the student
   home when none is booked, rather than a blank area.

### Requirement 5: Mess/food booking (optional step)

**User Story:** As a student, I want to select a meal plan during onboarding, so
that I can eat at the mess during the fest using my digital pass.

#### Acceptance Criteria

1. THE SYSTEM SHALL let a student view the available meal plans and select one as
   an explicit optional choice during onboarding.
2. WHEN a student selects a meal plan THE SYSTEM SHALL record the selection and
   mark mess eligibility as pending until payment is settled.
3. WHEN a student declines a meal plan THE SYSTEM SHALL continue onboarding
   without a mess obligation.
4. WHEN mess payment is settled THE SYSTEM SHALL grant the digital mess pass and
   reflect eligibility on the student home and My QR, reusing the existing mess
   module.

### Requirement 6: Payment for selected bookings

**User Story:** As a student, I want to pay for my accommodation and/or mess in
one clear step, so that my bookings are confirmed.

#### Acceptance Criteria

1. WHEN a student has one or more unpaid selected bookings THE SYSTEM SHALL
   present a payment step summarizing each item and its amount before checkout.
2. WHEN a student initiates payment THE SYSTEM SHALL redirect to the gateway's
   hosted checkout and SHALL NOT collect or store raw card data on our servers.
3. WHEN a payment is confirmed via the verified gateway callback THE SYSTEM SHALL
   update the corresponding booking to paid and grant the associated access
   (hostel paid / mess pass).
4. IF a payment fails or is abandoned THEN THE SYSTEM SHALL leave the booking
   unpaid, allow retry, and NOT create duplicate bookings.
5. THE SYSTEM SHALL display current payment status (paid / pending / failed) and
   a receipt (amount, date, transaction reference) for each settled payment,
   reachable from the student home without raising a query.

### Requirement 7: Event registration (participant side)

**User Story:** As a student, I want to browse and register for fest events, so
that I secure my spot and get a pass for each.

#### Acceptance Criteria

1. THE SYSTEM SHALL let a student browse published events with venue, date,
   time, and entry instructions.
2. WHEN a student registers for an event THE SYSTEM SHALL record the registration
   against their profile and confirm it.
3. WHEN a student views an event they are registered for THE SYSTEM SHALL clearly
   indicate registered status and provide access to their pass/QR for that event.
4. IF an event is at capacity THEN THE SYSTEM SHALL prevent new registrations and
   communicate the full status clearly.
5. WHEN a student cancels a registration (WHERE cancellation is permitted) THE
   SYSTEM SHALL remove the registration and free their spot.
6. THE SYSTEM SHALL list the student's registered events on the student home for
   quick access.

### Requirement 8: Student home / dashboard

**User Story:** As a student using the app before and during the fest, I want a
single home that surfaces everything I need, so that I can navigate quickly
without hunting through menus.

#### Acceptance Criteria

1. THE SYSTEM SHALL present a student home that surfaces: my registered events,
   my digital pass/QR access, payment status, accommodation details, mess
   details, and recent announcements/notifications.
2. WHILE onboarding is incomplete THE SYSTEM SHALL surface a prominent "continue
   setup" affordance on the home that deep-links to the next incomplete step.
3. THE SYSTEM SHALL provide fast, thumb-reachable navigation to events, passes,
   bookings, notifications, and profile.
4. WHEN new announcements relevant to the student exist THE SYSTEM SHALL indicate
   them on the home (e.g., an unread/updated indicator).
5. THE SYSTEM SHALL provide loading, empty, error, and success states for every
   data-backed section of the home.

### Requirement 9: Passes, notifications, and schedule access

**User Story:** As a student at the fest, I want quick access to my passes,
schedule, and updates, so that I can move through checkpoints and stay informed.

#### Acceptance Criteria

1. THE SYSTEM SHALL provide the on-device QR digital ID (reusing the existing
   offline TOTP model) as the student's primary pass.
2. WHERE an event registration exists THE SYSTEM SHALL make the corresponding
   event pass reachable from both the event and the student's passes view.
3. THE SYSTEM SHALL present the event schedule in a browsable, student-friendly
   form (by day/time) with venue and status.
4. THE SYSTEM SHALL surface official announcements to the student, filtered to
   their audience, and reachable within one interaction from the home.

### Requirement 10: Test-account harness and switcher

**User Story:** As someone testing the app, I want ready-made accounts across all
key states and an easy way to switch between them, so that I can verify every
student journey without creating data by hand.

#### Acceptance Criteria

1. THE SYSTEM SHALL provide a repeatable way to seed a set of test accounts that
   spans, at minimum: a brand-new student, a profile-only student, a student
   with accommodation booked, a student with mess booked, a student with both,
   students registered for different events, a student with a successful payment,
   a student with a pending/failed payment, an admin, and an organizer/volunteer.
2. THE SYSTEM SHALL make each seeded account's data realistic and internally
   consistent (e.g., a "paid accommodation" account has both the booking and the
   settled payment).
3. WHERE the app runs in a development/test context THE SYSTEM SHALL provide an
   account switcher that lets a tester assume any seeded account without manually
   entering credentials.
4. THE SYSTEM SHALL NOT expose the account switcher or bypass real authentication
   in a production context.
5. WHEN a tester switches accounts THE SYSTEM SHALL load that account's real
   onboarding state so the resulting journey (home, pipeline, bookings, payments,
   events) matches the account's seeded state.
6. THE SYSTEM SHALL document the seeded accounts and how to reset/re-seed them.

### Requirement 11: Coherent end-to-end journey and navigation

**User Story:** As a student attending Paradox for the first time, I want each
step to lead naturally into the next, so that the whole experience feels like one
polished product rather than disconnected pages.

#### Acceptance Criteria

1. THE SYSTEM SHALL connect each onboarding step's completion to a clear next
   action (no dead ends), including from empty/success states.
2. THE SYSTEM SHALL maintain a consistent navigation hierarchy and information
   architecture across the student journey (entry → onboarding → home → modules).
3. WHEN a student reaches a state with nothing to do in a section THE SYSTEM SHALL
   offer the most relevant next action rather than a bare empty state.
4. THE SYSTEM SHALL preserve existing organizer/admin capabilities and route
   non-student roles to their appropriate surfaces after sign-in.

### Requirement 12: Non-functional: mobile-first PWA quality

**User Story:** As a student on a phone with variable connectivity, I want the app
to feel fast, installable, and reliable, so that I can depend on it throughout the
fest.

#### Acceptance Criteria

1. THE SYSTEM SHALL remain an installable PWA with an offline-capable app shell,
   and the on-device QR pass SHALL continue to work offline once provisioned.
2. THE SYSTEM SHALL be mobile-first and responsive across phone, tablet, and
   desktop, with thumb-reachable primary actions on mobile.
3. THE SYSTEM SHALL preserve accessibility: labelled controls, keyboard
   operability, sufficient contrast, and announced status/errors.
4. THE SYSTEM SHALL provide loading (skeleton), empty, error, and success states
   for all asynchronous views, with no abrupt layout shifts.
5. THE SYSTEM SHALL keep the initial load lean via route-level code-splitting and
   cached/prefetched navigation, consistent with the existing performance setup.

### Requirement 13: Backward compatibility and data integrity

**User Story:** As a maintainer, I want the redesign to build on the existing
modules and data without breaking current behavior, so that we don't regress
working functionality.

#### Acceptance Criteria

1. THE SYSTEM SHALL reuse the existing auth, profile, events, mess, hostel,
   payments, announcements, and QR modules rather than duplicating their data.
2. WHERE new state is required (onboarding progress, event registrations) THE
   SYSTEM SHALL introduce it additively without invalidating existing records.
3. THE SYSTEM SHALL keep the mock/real API boundary intact so the app runs on the
   mock in development and the real backend in integration with no component
   changes.
4. THE SYSTEM SHALL preserve server-side RBAC as the security boundary; UI
   routing changes SHALL NOT weaken it.
