# PRODUCT REQUIREMENTS DOCUMENT

## Paradox Connect

*(working title — team to confirm final product name)*

A Centralized Management Platform & Student Help Portal for Paradox

Software Engineering [BSCS3001] — Project Milestone Deliverable

IIT Madras BS Degree Program

Team: blastoi-SE | Team Code: MAY2026-Team-079

Selected Problem Statement: Community Services Platform

### Document Control

| Version     | Date         | Status              | Prepared With             |
|-------------|--------------|---------------------|---------------------------|
| 1.2 (Draft) | 11 July 2026 | Pending team review | AI-assisted PRD synthesis |
| 1.1 (Draft) | 10 July 2026 | Superseded          | AI-assisted PRD synthesis |

### Project Team

| Name                   | Roll No.   | Role                                |
|------------------------|------------|-------------------------------------|
| Veer Shah              | 23f1001524 | Code Reviewer / Tester              |
| Ashwin Devi Srinivasan | 23f2000226 | Backend Developer                   |
| Anshuman Pandey        | 23f3001726 | Product Manager / Backend Developer |
| Tanisha Agrawal        | 23f3001897 | Scrum Master / Tester               |
| Ravi Kumar K           | 24f1002594 | Frontend Developer                  |

### Changelog: v1.1 → v1.2

This revision incorporates decisions locked during Sprint 1 planning and the QR/TOTP architecture review. It does not change project scope; it refines how already-committed features are built.

- **Identity validation model refined (major).** The digital ID is now explicitly a **standard TOTP model** (RFC 6238 — HMAC-SHA1, 6-digit code, 30-second step, ±1 step tolerance): a secret is provisioned once while online, after which the **student device generates the QR entirely on-device with no per-refresh server call**. Only the *organizer's* verification step requires the network. Previous wording that implied the student's ID screen depends on connectivity, or that every refresh polls the server, is corrected. See the companion document `Paradox_Connect_QRTOTP_Architecture.md`.
- **Per-event TOTP secret (new).** A **unique TOTP secret is provisioned per participant *per event/checkpoint context*** (e.g. hostel entry, a given event), not a single global secret per participant. A code valid for one event is therefore not valid at another. Updates FR-2.1.
- **Login method locked: Google Sign-in only.** Registration and login are via Google OAuth against confirmed IITM domains — **no password field anywhere**. This replaces the earlier email + password `/register` assumption. Updates FR-7.1, Section 1.3, Section 7.2.
- **Confirmed valid email domains:** `@ds.study.iitm.ac.in`, `@es.study.iitm.ac.in`, `@ee.study.iitm.ac.in`, `@mg.study.iitm.ac.in`.
- **Roles expand to a 4-tier hierarchy:** Participant → Organizer → **Admin → Super Admin**. Only a Super Admin can change another user's role, and the first Super Admin is seeded directly in the database as a one-time setup step. Updates FR-7.3, Section 7.2.
- **"Complete Your Profile" confirmed as a single full page**, with a **separate `photos` collection** in MongoDB linked by participant ID (photos are not embedded in the profile document).
- **Section 8 (Admin) reframed** from a read-only participant list to **User Management**, adding a Super-Admin-only role-assignment control.

### Changelog: v1.0 → v1.1

- Backend framework confirmed: Python + FastAPI (was: not yet finalized).
- Scaling approach locked for MVP: stateless backend + caching on the QR/TOTP verification path; full multi-service distribution moved to Future Roadmap.
- Payments added to scope: new Epic 10 (hostel & mess fee payment via a certified third-party gateway); previously listed as out of scope by omission.
- New risk (R8) and two new open questions added covering payment-webhook reliability and payment/access gating logic.

## Table of Contents

1. Overview
2. Problem & Research Basis
3. Goals & Success Metrics
4. Users & Personas
5. Scope
6. Functional Requirements
7. Non-Functional Requirements
8. Technical Constraints
9. Risks & Open Questions
10. Testing Strategy & Release Plan
11. Future Roadmap (Post-MVP)

## 1. Overview

### 1.1 Purpose of this Document

This PRD translates the team's Milestone 1 research — user identification, pain-point analysis, and user stories — into a build-ready set of prioritized, testable requirements for a 4-week MVP development cycle. It is intended to be handed to the full team as the single reference for what is being built, in what order, and why.

### 1.2 Product Summary

Paradox Connect is a centralized Progressive Web App (PWA) for Paradox, a large-scale IIT Madras fest. It replaces scattered email/WhatsApp communication and manual physical verification (ID cards, mess cards, attendance sheets) with a single platform covering: event information and updates, a unified QR/TOTP-based digital identity used for all entry checkpoints, real-time attendance and crowd visibility, mess information and digital mess access, hostel allocation and digital check-in, hostel and mess fee payment, structured query and contact management, targeted announcements, and an operational dashboard for the core team — all built on one integrated participant profile.

### 1.3 Confirmed Project Parameters

The following parameters were confirmed directly by the team and are treated as fixed constraints throughout this document, not open questions:

- Team type: small student team (5 members), building to production-grade engineering and security standards, but not enterprise scale.
- Timeline: 4 weeks from PRD approval to a single ("big-bang") MVP release for the project presentation.
- Scope: all 9 epics from the Milestone 1 research, plus a newly confirmed Payments epic (Section 6, Epic 10), are in scope for the MVP, tiered by priority within each epic (Section 5).
- Performance target: the system must support 10,000+ concurrent active sessions/API calls during fest week — a real NFR, not a narrative figure.
- Scaling approach (locked for MVP): a stateless backend design with a caching layer on the QR/TOTP verification path (the system's highest-traffic operation), to reduce per-request load on free-tier hosting. Full multi-service data distribution and load balancing across backend instances is deferred to the Future Roadmap (Section 11); the residual capacity risk on free-tier hosting for the MVP is documented, not eliminated (Risk R1, Section 9).
- Registration eligibility: Paradox is exclusive to IITM students/staff; every participant profile is created via **Google Sign-in** using a valid IITM college email. There is no password-based registration. Confirmed valid domains: `@ds.study.iitm.ac.in`, `@es.study.iitm.ac.in`, `@ee.study.iitm.ac.in`, `@mg.study.iitm.ac.in`.
- Identity mechanism: JWT-based session authentication (post Google Sign-in) with a **TOTP-powered rotating QR digital identity (RFC 6238)**. A TOTP secret is provisioned once per participant **per event/checkpoint context** while the device is online; the student's QR is then generated **on-device** from the cached secret, with **no server call on each refresh**. Verification of a scan happens server-side on the organizer's device, which requires connectivity. Full offline organizer-side validation remains out of scope for the MVP (Future Roadmap, Section 11).
- Backend framework: Python + FastAPI (confirmed).
- Payments: basic fee collection for hostel accommodation and mess/meal plans is in scope, processed through a certified third-party payment gateway with hosted checkout (e.g., a Razorpay/Stripe-style provider). Paradox Connect does not collect, handle, or store raw card/payment data directly (Section 6, Epic 10).
- Deployment: ₹0 infrastructure budget; free-tier/open-source services only (Vercel for frontend, Render for backend), while the system is designed and documented to production-grade standards.
- Integration: standalone/greenfield system for the MVP with respect to IITM's own systems — no integration with existing IITM SSO, hostel/mess databases, or the fest website in this release. The third-party payment gateway is a necessary, separate external integration required for fee collection.

## 2. Problem & Research Basis

The team's research is based on a single structured interview with a House POR/POC who had direct experience with event coordination, sports coordination, and participant support during Paradox. This is an explicit limitation carried forward into this PRD (see Section 9.2, Risks): findings for personas who were not directly interviewed (mess managers, vendors, security staff, hostel wardens) are reasoned inferences, not validated needs.

### 2.1 Root Causes Identified

- Absence of a centralized information system for event, hostel, mess, and workshop data.
- No unified digital identity for participants across mess, hostel, events, and workshops.
- No standard operating procedure visible to all participants and staff (inconsistent entry rules).
- Heavy dependence on manual verification and physical records (ID cards, mess cards, sign-in sheets).
- No structured query management or escalation workflow.
- No real-time attendance or crowd information for organizers.
- No admin dashboard for fast, reliable information updates.
- No integration between event registration, accommodation, mess, and workshop data — participants re-enter the same details repeatedly.

### 2.2 Pain Points Summary

Eleven pain points were identified during research. They are summarized here by theme; full detail (affected users, impact, and the specific requirement each generated) is preserved in the team's Milestone 1 research document and is traceable to the Functional Requirements in Section 6.

| **Pain Point**                            | **Core Issue**                                                                                                          | **Addressed By** |
|:------------------------------------------|:------------------------------------------------------------------------------------------------------------------------|:-----------------|
| Scattered event information               | Venue/time updates spread across email, WhatsApp, and word of mouth; participants reach the wrong venue or miss events. | Epic 1           |
| No centralized communication channel      | PORs and event teams coordinate urgently via personal contacts; no official channel exists.                             | Epic 1, 8        |
| Inconsistent entry rules                  | ID cards, bands, and item restrictions vary by venue with no advance notice to participants.                            | Epic 1           |
| Manual attendance & crowd counting        | Organizers lack accurate headcounts; participants denied entry despite available space.                                 | Epic 3           |
| Mess menu unavailable in advance          | Participants must physically visit the mess to see what food is available.                                              | Epic 4           |
| Manual mess verification & long queues    | Physical mess cards create queues and are difficult to recover if lost.                                                 | Epic 4           |
| Manual, slow hostel check-in              | Check-in queues observed at ~2 hours in larger hostels during peak arrival.                                             | Epic 5           |
| Unclear contact points                    | Participants and even PORs do not know who to contact for accommodation, mess, or emergencies.                          | Epic 6           |
| Weak query management, no status tracking | Issues raised informally with no visibility into whether they are being handled.                                        | Epic 6           |
| Manual workshop check-in                  | Volunteers search paper sheets to verify registration; participants re-enter the same data repeatedly.                  | Epic 2, 7        |
| Outdated website, no admin update path    | Official information falls out of date because there is no fast way for admins to update it.                            | Epic 1, 9        |

## 3. Goals & Success Metrics

### 3.1 Business Goals

- Establish a single source of truth for all Paradox event, hostel, mess, and contact information.
- Eliminate manual physical verification (ID cards, mess cards, attendance sheets) through one unified digital identity.
- Give organizers real-time visibility into attendance, crowd levels, and open participant issues.
- Reduce the support burden currently absorbed informally by PORs through a trackable query system.
- Remove repeated data entry for participants by unifying their profile across every module.

### 3.2 Success Metrics

The following draft metrics are grounded in the baselines the team's own research already surfaced. Bracketed values are placeholders that need explicit confirmation by the team before this becomes a locked target — they are proposals, not assumptions.

| **Metric**                                | **Current Baseline**                           | **Target**                                         |
|:------------------------------------------|:-----------------------------------------------|:---------------------------------------------------|
| Hostel check-in time per participant      | ~2 hours (observed, large hostels)             | [Team to confirm target, e.g. under 5 minutes]     |
| Event/mess/hostel entry verification time | Manual, unmeasured                             | [Team to confirm, e.g. under 5 seconds per scan]   |
| Queries with trackable status             | ~0% (informal calls/emails)                    | 100% of submitted queries have a visible status    |
| Duplicate data entry per participant      | Re-entered for each event/workshop/hostel/mess | 1 profile, entered once                            |
| Peak concurrent active sessions supported | Not previously measured                        | 10,000+ (confirmed NFR, not a draft)               |
| System uptime during fest week            | Not previously defined                         | [Team to confirm target, e.g. 99%]                 |
| Query resolution turnaround               | Not previously measured                        | [Team to confirm target]                           |

## 4. Users & Personas

Users are classified by how directly and how frequently they interact with the system. Full interview-derived detail for each persona is preserved in the team's research document; this section consolidates it for requirement traceability.

| **Tier**  | **Users**                                                                                                                      | **Why**                                                                                          |
|:----------|:-------------------------------------------------------------------------------------------------------------------------------|:-------------------------------------------------------------------------------------------------|
| Primary   | Paradox participants; event/workshop volunteers; accommodation/security volunteers; hostel guards; mess staff; House PORs/POCs | Direct, frequent use for information, QR verification, entry, and operational updates.           |
| Secondary | Fest administration; Paradox core teams; Coordinators/Super Coordinators; helpdesk volunteers                                  | Use dashboards for monitoring, reporting, planning, and query resolution.                        |
| Tertiary  | Institute administration; general campus community; hostel wardens; vendors/food court operators; mess managers                | Not direct users, but affected by smoother operations, reduced bottlenecks, and better planning. |

### 4.1 Primary Persona Needs (top priority for MVP)

- Paradox Participant / Student — needs one place to see event schedules, receive change alerts, hold a single digital ID, and raise/track queries.
- On-Ground Operational Staff (volunteers, guards, mess staff) — needs fast QR-based verification instead of manual lookup, plus real-time attendance visibility.
- House PORs/POCs — needs verified contact points and official updates so they stop relying on personal contacts to support students.

## 5. Scope

### 5.1 Priority Tiering (Draft — for team finalization)

All 9 research epics, plus the newly confirmed Payments epic (Epic 10), ship in the single MVP release. Priority is tiered within each epic between the core mechanism (P0) and enhancement stories (P1), so the 4-week timeline and full scope are not in conflict. This tiering is a draft for the team to confirm or adjust before development planning.

**P0 — Must Have**

- Epic 7 — Integrated Participant Profile (all stories): foundational; every module depends on one profile.
- Epic 2 — Digital ID / QR-TOTP Entry (all stories): the verification mechanism every checkpoint depends on.
- Epic 1 — Event schedule view, admin edit, entry instructions (Stories 1.1, 1.3, 1.4).
- Epic 5 — Hostel allocation view and digital check-in (Stories 5.1, 5.2): worst-measured pain point (~2-hour queues).
- Epic 6 — Query management and contact directory (Stories 6.1–6.5): only scalable support model at 10,000+ users.
- Epic 4 — Mess menu, digital mess pass, digital mess verification (Stories 4.1–4.3).
- Epic 10 — Hostel & mess fee payment (Stories 10.1–10.3): payment is the precondition for the hostel/mess access flows above; whether it hard-gates access is an open question (Section 9.2), but the payment flow itself is P0.

**P1 — Should Have**

- Epic 3 — Attendance & crowd information (all stories): built on Epic 2, not a blocker to entry itself.
- Epic 8 — Team communication / targeted announcements (all stories).
- Epic 9 — Admin operational dashboard (Stories 9.1, 9.3).
- Epic 1, Story 1.2 — push notifications; an in-app "last updated" badge is an acceptable fallback if push infra takes too long to build.
- Epic 5, Stories 5.3–5.4 — hostel contact info / issue reporting; can route through the Epic 6 query system.
- Epic 4, Story 4.4 — mess opt-in count dashboard: a reporting layer, not participant-critical.
- Epic 10, Story 10.4 — admin payment reconciliation view.

**P2 — Future Roadmap (not built for MVP)**

- Predictive crowd/queue forecasting.
- Offline-tolerant scanner validation fallback.
- SSO / integration with existing IITM systems.
- Support for non-IITM/external participants.
- Admin analytics and data export tooling.
- Story 9.2 — automatic flagging of overloaded locations.
- Full multi-service data distribution and load balancing across backend instances (beyond the stateless + QR-path-caching design locked for MVP).
- Automated refunds and GST-compliant invoicing for hostel/mess payments.

### 5.2 Out of Scope / Non-Goals (MVP)

The following are explicitly not being built in this MVP. Anything not listed as in-scope above should be treated as out of scope unless the team amends this document.

- Integration with existing IITM systems (SSO, existing hostel/mess registration databases, the existing fest website).
- Support for participants outside IITM students/staff.
- Native iOS/Android apps — PWA only.
- Fully offline **organizer-side** QR/TOTP verification — the student's QR is generated offline on-device, but the scan *verification* step still requires the organizer's device to reach the server. An offline-tolerant organizer verification fallback is Future Roadmap (Section 11).
- Predictive analytics or crowd forecasting.
- Handling or storing raw card/payment data directly — all payments route through a certified third-party gateway's hosted checkout (Epic 10); Paradox Connect only stores payment status and gateway transaction references.
- Refunds, cancellations, and GST-compliant invoicing for hostel/mess payments — deferred to the Future Roadmap (Section 11); the MVP handles successful one-time payment collection only.
- Detailed admin reporting/data export tooling beyond the operational dashboard views in Epic 9.

### 5.3 Assumptions & Dependencies

- Every participant has and can access a valid IITM college email for registration (per confirmed identity design).
- Fest organizers/admins will provide accurate, timely event/hostel/mess data through the admin dashboard; data quality depends on operator input, not the system itself.
- Every entry venue (event, mess, hostel, workshop) has adequate device and internet connectivity **on the organizer/scanning device** for online scan verification — there is no offline verification fallback on the organizer side in the MVP. (The student's QR itself generates offline once provisioned, so this dependency applies to the scanning device, not the student's.) This is a real dependency, not a formality; see Risk R2 in Section 9.
- Vercel and Render free-tier service limits remain available and sufficient through the 4-week build and presentation window.
- All 5 team members remain available across the 4-week window at the capacity implied by this scope.
- A certified third-party payment gateway account (e.g., Razorpay/Stripe-style) can be provisioned in test/sandbox mode within the 4-week window at no cost; the specific provider is not yet chosen (see Open Questions, Section 9.2).

## 6. Functional Requirements

Requirements are grouped by epic and numbered against the originating user story for full traceability. Every requirement below is written to be independently testable.

### Epic 1 — Centralized Event Information & Updates

**FR-1.1 View Updated Event Schedule**

**P0 — Must Have (MVP core)** *(Ref: Story 1.1)*

Participants can view all events with venue, date, time, and current status in one place, sourced from a single centrally maintained record.

***Acceptance Criteria***

- Every event displays venue, date, start time, and end time.
- An admin update to an event's venue or time is visible to participants within a defined latency window (target: 60 seconds) without an app reinstall.
- The schedule is viewable by any participant, including those with no event registrations.

**FR-1.2 Venue/Time Change Alerts**

**P1 — Should Have (MVP if time allows)** *(Ref: Story 1.2)*

Registered participants are alerted when the venue or time of an event they are registered for changes.

***Acceptance Criteria***

- When an admin changes an event's venue or time, every participant registered for that event receives a notification.
- The notification states the event name and what changed (old vs. new value).
- Delivery does not depend on the participant having scanned any QR code first.

***Note:** Push notifications are the target; an in-app banner/badge is the minimum acceptable fallback if push infrastructure is not ready within the 4-week window.*

**FR-1.3 Update Event Details from Admin Dashboard**

**P0 — Must Have (MVP core)** *(Ref: Story 1.3)*

Authorized organizers/admins create and update event venue, time, capacity, and instructions without developer or database access.

***Acceptance Criteria***

- Only Organizer- or Admin-role accounts can access the edit interface; a Participant-role account cannot.
- A saved change is reflected in the participant-facing schedule (FR-1.1) without a deployment or restart.
- Venue, time, capacity, and instructions are each independently editable and required before an event can be published as active.

**FR-1.4 View Event-Specific Instructions**

**P0 — Must Have (MVP core)** *(Ref: Story 1.4)*

Each event displays entry rules — required ID/QR, allowed/restricted items, reporting time — visible before a participant travels to the venue.

***Acceptance Criteria***

- Every published event has an instructions field rendered on its detail screen.
- If no instructions are set, the screen shows an explicit default state rather than a blank or broken screen.
- Instructions are viewable in advance, without requiring the participant's physical presence at the venue.

### Epic 2 — Digital Identity & Entry Management

**FR-2.1 Issue QR/TOTP-Based Digital ID**

**P0 — Must Have (MVP core)** *(Ref: Story 2.1)*

Each registered participant is issued a TOTP-based rotating digital identity, presented as a QR code, used across mess, hostel, workshop, and event entry. A **distinct TOTP secret is provisioned per participant per event/checkpoint context**, so a code is scoped to the context it was issued for. The QR encodes `{ participant_id, current_code }` — never the secret itself.

***Acceptance Criteria***

- The QR code follows standard TOTP behavior (RFC 6238) with fixed parameters shared by frontend and backend: **HMAC-SHA1, 6 digits, 30-second time step, ±1 step (~90s) validation tolerance, Base32-encoded 160-bit secret**. The 6-digit code rotates on the 30-second step. (Full parameter table: companion doc, "TOTP Parameters".)
- A distinct secret is used per event/checkpoint context; a code valid for one event/checkpoint does not verify as valid at a different one, even for the same participant.
- The digital ID is **generated on-device from the cached secret and renders without an active internet connection**; the app does not call the server on each 30-second refresh. Connectivity is required only (a) once, during initial secret provisioning, and (b) on the organizer's device at scan time for verification.
- A screenshotted or expired code fails verification on scan, since the organizer's device checks the submitted code against the current valid time window server-side, and a code already used within its window is rejected as a duplicate (replay protection).

***Note:** The secret is sent to the device exactly once, over HTTPS, during registration/profile completion, and is stored in encrypted client-side storage (encrypted IndexedDB via the Web Crypto API, as this is a PWA). It is never re-exposed by any later API call. Full provisioning and security detail is in the companion document `Paradox_Connect_QRTOTP_Architecture.md`.*

**FR-2.2 Scan & Verify Participant QR**

**P0 — Must Have (MVP core)** *(Ref: Story 2.2)*

Staff/volunteers at any checkpoint scan a participant's QR and receive an immediate valid/invalid result plus checkpoint-specific eligibility.

***Acceptance Criteria***

- A scan returns a result, valid or invalid with a reason, within a defined latency target (e.g., 2 seconds) under normal network conditions.
- The organizer/scanning app supplies the **event/checkpoint context** with the scan (the QR carries only `{ participant_id, current_code }`); the backend uses `(participant_id, checkpoint_context)` to select the correct per-context secret for verification.
- The result is specific to the checkpoint type — e.g., a mess-only pass scanned at an event gate returns an explicit "not eligible for this checkpoint" result, not a generic error.
- Every scan is logged with a timestamp and the identity of the scanning staff member, supporting the audit-logging NFR (Section 7).

### Epic 3 — Event Attendance & Crowd Information

**FR-3.1 Automatic Attendance Counting**

**P1 — Should Have (MVP if time allows)** *(Ref: Story 3.1)*

Every valid QR scan at an event entry automatically increments that event's attendance counter in real time.

***Acceptance Criteria***

- A valid scan increments the count exactly once; a duplicate scan of the same participant within a defined re-entry window does not double-count without an explicit staff override.
- The organizer-facing count updates within a defined latency target of the scan occurring.

**FR-3.2 View Remaining Capacity**

**P1 — Should Have (MVP if time allows)** *(Ref: Story 3.2)*

Organizers see remaining allowed entries for an event, computed as configured capacity minus current attendance.

***Acceptance Criteria***

- Remaining capacity is visible on the organizer's event screen and updates as scans occur.
- When remaining capacity reaches zero, the event is visibly flagged "at capacity" in the organizer view.

**FR-3.3 View Crowd Status Pre-Visit**

**P1 — Should Have (MVP if time allows)** *(Ref: Story 3.3)*

Participants see a simple status indicator (e.g., Available / Filling Fast / Full) for an event or venue before deciding whether to go.

***Acceptance Criteria***

- The status is derived from the same attendance/capacity data used in FR-3.2, not a separately maintained figure.
- The status updates at the same cadence as the organizer-facing capacity view.

**FR-3.4 Monitor Event Crowd from Dashboard**

**P1 — Should Have (MVP if time allows)** *(Ref: Story 3.4)*

Core team members view live attendance/crowd figures across all active events in one screen.

***Acceptance Criteria***

- The dashboard lists every currently active event with live attendance and capacity without navigating to separate pages per event.
- Only Core Team/Admin roles can access this consolidated view.

### Epic 4 — Mess Information & Mess Entry

**FR-4.1 View Mess Menu & Timings**

**P0 — Must Have (MVP core)** *(Ref: Story 4.1)*

Participants view the current mess menu and meal timings before physically visiting the mess.

***Acceptance Criteria***

- Menu and timing information is available per mess location (if multiple exist) and per meal.
- A Mess-Manager/Admin role can update the menu; the update is visible to participants without a new app release.

**FR-4.2 Digital Mess Pass**

**P0 — Must Have (MVP core)** *(Ref: Story 4.2)*

A participant's mess eligibility is attached to their single digital ID (FR-2.1) rather than a separate physical mess card.

***Acceptance Criteria***

- A mess-eligible participant shows an explicit eligibility status on their profile, verifiable via the same QR used elsewhere.
- If a participant's device is lost, mess access can be recovered by re-authenticating (e.g., via college email login) rather than requiring a replacement physical card.

***Note:** Depends on FR-10.2 (mess fee/meal plan payment). Whether mess eligibility is only granted after payment is confirmed, or is tracked separately without hard enforcement in the MVP, is an open question — see Section 9.2.*

**FR-4.3 Verify Mess Entry Digitally**

**P0 — Must Have (MVP core)** *(Ref: Story 4.3)*

Mess staff scan a participant's QR to verify mess eligibility instead of manually checking a physical card.

***Acceptance Criteria***

- A scan at the mess checkpoint returns "eligible" or "not eligible for mess" using the same verification mechanism as FR-2.2.
- Each mess entry scan is logged with a timestamp, supporting the opt-in count in FR-4.4.

**FR-4.4 Mess Opt-In Count Dashboard**

**P1 — Should Have (MVP if time allows)** *(Ref: Story 4.4)*

Mess staff/managers view the number of participants who have opted in for a given meal, to plan preparation quantities.

***Acceptance Criteria***

- The count reflects participants marked mess-eligible for that specific meal/location, not a global participant count.
- The count is viewable ahead of the meal, based on opt-in/registration data, not only after entry scans occur.

### Epic 5 — Hostel & Accommodation Management

**FR-5.1 View Hostel Allocation Details**

**P0 — Must Have (MVP core)** *(Ref: Story 5.1)*

Participants view their assigned hostel, room/allocation details, and check-in instructions in the app.

***Acceptance Criteria***

- An outstation participant with a hostel allocation sees their hostel and room/bed detail without contacting a POR or volunteer.
- A participant with no accommodation assigned sees an explicit "no accommodation assigned" state rather than a blank screen.

***Note:** Depends on FR-10.1 (hostel fee payment). Whether hostel allocation is confirmed only after payment succeeds, or allocation and payment are tracked independently in the MVP, is an open question — see Section 9.2.*

**FR-5.2 Digital Hostel Check-In**

**P0 — Must Have (MVP core)** *(Ref: Story 5.2)*

Hostel guards/volunteers scan a participant's digital ID to verify accommodation eligibility and complete check-in.

***Acceptance Criteria***

- A scan at hostel check-in returns the assigned hostel/room and an eligibility result within a defined latency target (e.g., 2 seconds).
- A successful check-in is recorded with a timestamp; a participant cannot be checked into two different hostels simultaneously without an explicit staff override.

***Note:** If payment gating is confirmed (see FR-5.1 note), an unpaid participant's scan result at check-in must explicitly state "payment pending" rather than a generic denial, so guards can direct them to resolve payment rather than turning them away.*

**FR-5.3 View Hostel Contact Information**

**P1 — Should Have (MVP if time allows)** *(Ref: Story 5.3)*

Participants view the contact details of the currently responsible hostel coordinator.

***Acceptance Criteria***

- The contact shown reflects the coordinator currently assigned to that hostel in admin-maintained data, not a static/hardcoded value.

**FR-5.4 Report Hostel/Mess Issue**

**P1 — Should Have (MVP if time allows)** *(Ref: Story 5.4)*

Participants raise a hostel- or mess-related issue directly from the relevant screen, submitted through the query system.

***Acceptance Criteria***

- Initiating "report an issue" from the hostel or mess screen pre-fills the query category (Hostel/Mess) in the FR-6.1 query form.
- The submitted query follows the same tracking flow as any other query (FR-6.2).

### Epic 6 — Query & Contact Management

**FR-6.1 Raise a Query**

**P0 — Must Have (MVP core)** *(Ref: Story 6.1)*

Any participant submits a query with a category (event/hostel/mess/workshop/lost item/other) and description.

***Acceptance Criteria***

- A query cannot be submitted without a selected category and a non-empty description.
- Every submitted query is timestamped and associated with the submitting participant's profile.

**FR-6.2 Track Query Status**

**P0 — Must Have (MVP core)** *(Ref: Story 6.2)*

Participants view the status of their submitted queries: Open, Assigned, In Progress, or Resolved.

***Acceptance Criteria***

- Every query holds exactly one of the four defined statuses at all times.
- A participant can view status for queries they personally submitted, and cannot view another participant's queries.

**FR-6.3 Assign Queries to Correct Team**

**P0 — Must Have (MVP core)** *(Ref: Story 6.3)*

Admins/core team view incoming queries and assign them to the responsible team, updating status accordingly.

***Acceptance Criteria***

- An admin can change a query's status and assign an owning team from a defined list (event/hostel/mess/workshop/general).
- A status change is reflected in the participant-facing view (FR-6.2) within a defined latency target.

**FR-6.4 POR Access to Verified Contact Points**

**P0 — Must Have (MVP core)** *(Ref: Story 6.4)*

House PORs/POCs view the same verified contact directory and official updates the core team publishes, so they guide participants with accurate information.

***Acceptance Criteria***

- A POR-role account can view the current contact directory and official announcements relevant to their house/area.
- The directory reflects the same underlying data source used elsewhere in the system — not a separately maintained list.

**FR-6.5 View Emergency Contacts**

**P0 — Must Have (MVP core)** *(Ref: Story 6.5)*

Participants view verified emergency/support contacts for hostel, mess, events, and security.

***Acceptance Criteria***

- Emergency contacts are visible without needing to submit a query first (e.g., a persistent "Help" section).
- Contacts shown are sourced from the same admin-maintained directory as FR-6.4.

### Epic 7 — Integrated Participant Profile

**FR-7.1 Single Profile via College Email**

**P0 — Must Have (MVP core)** *(Ref: Story 7.1)*

A participant registers once via **Google Sign-in** using their IITM college email, creating a single profile reused across all modules. No password is set or stored.

***Acceptance Criteria***

- Registration is completed through Google Sign-in; there is no email + password form anywhere in the flow.
- The Google account's email domain must match one of the confirmed IITM suffixes (`@ds.study.iitm.ac.in`, `@es.study.iitm.ac.in`, `@ee.study.iitm.ac.in`, `@mg.study.iitm.ac.in`); any other domain is rejected with a clear message.
- A participant cannot create more than one profile using the same Google account/college email.
- On first successful sign-in, the participant is routed to **Complete Your Profile** (a single page); details entered there are not re-requested for subsequent events or workshops.

**FR-7.2 Shared Profile Across Services**

**P0 — Must Have (MVP core)** *(Ref: Story 7.2)*

The single participant profile is the data source for event registration, hostel allocation, mess access, and workshop registration.

***Acceptance Criteria***

- A change to core profile data made in one place is reflected consistently across event, hostel, mess, and workshop views without separate updates in each module.
- Every module-specific record (hostel allocation, mess eligibility, event registration) references the same underlying profile ID.

**FR-7.3 Admin Participant Record Management**

**P0 — Must Have (MVP core)** *(Ref: Story 7.3)*

Admins view and manage participant records — identification, accommodation, mess access, event eligibility — from a single **User Management** dashboard. This screen is no longer read-only: it includes role management, gated by role tier.

***Acceptance Criteria***

- An admin can search for a participant by name, email, or ID and view all module-specific data for that participant in one screen.
- Only Admin-role accounts (or higher) can edit another participant's record.
- A **role-assignment control** (e.g. a per-row dropdown) is visible and usable **only to a Super Admin**; regular Admins see the same list without the role-editing control.
- Only a Super Admin can change a user's role across the four tiers (Participant → Organizer → Admin → Super Admin). The very first Super Admin is created directly in the database as a one-time setup step, since no in-app account has permission to grant that role initially.
- Each participant's profile photo is read from the separate `photos` collection (linked by participant ID), not from a field embedded in the participant document.

### Epic 8 — Communication Between Teams

**FR-8.1 Send Official Announcements**

**P1 — Should Have (MVP if time allows)** *(Ref: Story 8.1)*

Core team sends announcements to a selected audience group: all participants, event registrants, hostel residents, or PORs.

***Acceptance Criteria***

- An announcement can be scoped to at least the four named groups; sending to "all participants" does not require selecting individuals manually.
- Every announcement is logged (sender, audience, timestamp, content) for accountability.

**FR-8.2 Notify Only Affected Participants**

**P1 — Should Have (MVP if time allows)** *(Ref: Story 8.2)*

When an event's details change, only participants registered for that specific event receive the related notification.

***Acceptance Criteria***

- Triggering a change to a specific event automatically scopes the resulting notification (per FR-1.2) to that event's registered participants only.
- Participants not registered for the changed event do not receive the notification.

### Epic 9 — Admin Visibility & Coordination

**FR-9.1 Operational Dashboard**

**P1 — Should Have (MVP if time allows)** *(Ref: Story 9.1)*

Core team views a single dashboard summarizing event attendance, crowd status, open queries, hostel issues, and mess status.

***Acceptance Criteria***

- All five data categories are visible on one dashboard screen without navigating to separate pages for each.
- Only Core Team/Admin roles can access this dashboard.

**FR-9.2 Identify Overloaded Locations**

**P2 — Future Roadmap** *(Ref: Story 9.2)*

The system highlights which hostel, mess, or event venue has unusually high crowd or unresolved issues, to guide volunteer redirection.

***Acceptance Criteria***

- A location is flagged when its crowd/issue count exceeds a defined threshold (threshold definition deferred to Phase 2 design).

***Note:** Deferred to the post-MVP roadmap (Section 11) per team agreement; not required for MVP launch.*

**FR-9.3 Maintain Centralized Information**

**P1 — Should Have (MVP if time allows)** *(Ref: Story 9.3)*

All official event, hostel, mess, contact, and participant information is stored in one system as the single source of truth for every team.

***Acceptance Criteria***

- No module maintains a duplicate/parallel copy of data owned by another module (e.g., hostel contact info is not re-entered separately in the query system).
- This requirement is satisfied structurally by FR-7.2's shared-profile design plus each module referencing the same underlying data store.

### Epic 10 — Hostel & Mess Fee Payments

This epic was added after the initial Milestone 1 research — it does not originate from the team's user-story set, but was confirmed as in-scope during PRD discovery. It covers collection of hostel accommodation fees and mess/meal plan fees.

**FR-10.1 Pay Hostel Accommodation Fee**

**P0 — Must Have (MVP core)** *(Ref: New (confirmed in PRD discovery))*

A participant with a hostel allocation pays the accommodation fee through a certified third-party payment gateway's hosted checkout.

***Acceptance Criteria***

- Initiating payment redirects the participant to the gateway's hosted checkout; Paradox Connect's own servers never receive or store raw card/payment details.
- On a successful payment, the participant's hostel payment status updates to "paid" and a gateway transaction reference is stored against their profile.
- On a failed or abandoned payment, the participant's status remains "unpaid" and they can retry without creating a duplicate hostel allocation record.

***Note:** Whether "paid" status is a hard precondition for hostel allocation/check-in (FR-5.1, FR-5.2) is an open question — see Section 9.2.*

**FR-10.2 Pay Mess Fee / Select Meal Plan**

**P0 — Must Have (MVP core)** *(Ref: New (confirmed in PRD discovery))*

A participant selects a meal plan and pays the mess fee through the same third-party gateway.

***Acceptance Criteria***

- The participant can select from the meal plan options configured by an Admin/Mess-Manager before paying.
- On successful payment, mess eligibility (FR-4.2) is updated to reflect the paid plan and a transaction reference is stored against their profile.
- A failed or abandoned payment leaves mess eligibility unchanged and allows retry.

***Note:** Whether "paid" status is a hard precondition for mess eligibility (FR-4.2, FR-4.3) is an open question — see Section 9.2.*

**FR-10.3 View Payment Status & Receipt**

**P0 — Must Have (MVP core)** *(Ref: New (confirmed in PRD discovery))*

A participant can see the status of their hostel and mess payments (Paid / Pending / Failed) and view a basic receipt/confirmation for each successful payment.

***Acceptance Criteria***

- Payment status is visible from the participant's profile without needing to raise a query to ask.
- A successful payment produces a receipt showing amount, date, and gateway transaction reference.
- A failed payment shows a clear reason where the gateway provides one, and a way to retry.

**FR-10.4 Admin Payment Reconciliation View**

**P1 — Should Have (MVP if time allows)** *(Ref: New (confirmed in PRD discovery))*

Admins can view which participants have paid, have a pending payment, or have not paid, for hostel and mess fees separately.

***Acceptance Criteria***

- An admin can filter participants by payment status (Paid / Pending / Failed / Not Started) for hostel fees and for mess fees independently.
- The view reflects the same payment status and transaction references used in FR-10.1–FR-10.3, not a separately maintained figure.

## 7. Non-Functional Requirements

### 7.1 Performance & Scalability

- The system must support 10,000+ concurrent active sessions/API calls during fest week without service degradation (confirmed NFR).
- Scaling approach locked for MVP: the backend is stateless (no server-side session state pinned to a single instance), and a shared caching layer (**Redis**) sits specifically on the QR/TOTP verification path (FR-2.2), since it is the system's highest-traffic, highest-consequence operation. Because the backend may run across multiple instances, all replay-protection state (used TOTP codes within their validity window), rate-limit counters, and temporary verification state live in this shared Redis store — never in per-instance memory — so verification is correct regardless of which instance handles a request.
- Full multi-service data distribution and load balancing across multiple backend instances is deferred to the Future Roadmap (Section 11). The MVP's stateless + cached-verification design reduces, but does not eliminate, capacity risk on free-tier hosting — this residual risk is tracked as Risk R1 (Section 9), not silently assumed away.
- [Team to confirm] Target API response time under peak load (e.g., under 2 seconds for QR verification calls specifically, since this sits on the critical path at every physical checkpoint).
- QR scan verification should be load-tested in isolation first, ahead of full-system load testing, since it is both the highest-traffic path and the one carrying the caching mitigation above.

### 7.2 Security

- All traffic served over HTTPS; no endpoint accepts unencrypted requests.
- Authentication is via **Google Sign-in (OAuth)**; no passwords are collected or stored, so there is no local password hash to protect. Google OAuth tokens are verified server-side, and the domain is checked against the confirmed IITM suffixes before a session is issued.
- The per-participant, per-event **TOTP secret is stored encrypted at rest** (encryption key held outside the database), sent to the device exactly once over HTTPS, and never re-exposed by a later API call. On the device it is held in encrypted client-side storage (encrypted IndexedDB via Web Crypto). **Lost/changed-device recovery** is: log in again → generate a **new** secret → invalidate the previous secret → only the new device can generate valid codes. The previous secret is never reissued or downloaded again; there is deliberately no endpoint that re-exposes an existing secret. This same "regenerate ID" mechanism is the revocation path for a lost or compromised device.
- Role-based access control (RBAC) enforced server-side (not just hidden in the UI) across a **four-tier hierarchy: Participant → Organizer → Admin → Super Admin**. Only a Super Admin can change another user's role; the role-assignment endpoint rejects calls from any lower tier.
- TOTP codes are verified server-side on every scan; a stale, out-of-window, or already-used code is rejected (replay protection, via shared Redis state). Scan attempts are rate-limited on a **composite key of participant ID + scanner device + IP address** (not participant ID alone), so brute-force attempts cannot be spread cheaply across many participant IDs.
- JWT tokens have a defined, reasonable expiry and are never exposed in logs or client-visible error messages.
- All QR scans and admin data edits are logged with timestamp and actor identity (supports auditability and Epic 2/4/5 acceptance criteria).
- Student PII is restricted to the roles that need it for their function (least-privilege access) — e.g., mess staff should not see a participant's full profile, only mess eligibility.
- Raw card/payment data is never received, processed, or stored by Paradox Connect's own servers; all payment capture happens on the third-party gateway's hosted checkout (Epic 10). Only payment status and gateway transaction references are stored on our side, which meaningfully reduces our own compliance/security scope for handling financial data.
- Payment status changes (e.g., gateway webhook or callback confirming a payment) are verified as genuinely originating from the gateway (e.g., signature verification) before being trusted, not accepted at face value from the client.

### 7.3 Reliability & Availability

- [Open — team to confirm] An uptime target for fest week (e.g., 99%), given this is a live, week-long, single-channel system for many of the pain points it replaces.
- [Open — flagged risk, not currently addressed anywhere in the source research] A manual/paper fallback procedure should be defined for any checkpoint (mess, hostel, event) in the event of a system or network outage during live operation.

### 7.4 Usability

- Mobile-first, responsive design; must function on common Android/iOS mobile browsers without requiring an app-store install (per the confirmed PWA decision).
- Digital ID and verification screens must remain legible and fast to load on campus Wi-Fi/mobile data under queue conditions (i.e., optimized for speed over visual richness at checkpoints).
- Interfaces used under time pressure (entry checkpoints, query submission) should minimize required taps/fields.

### 7.5 Data Integrity & Compliance

- A single participant profile (Epic 7) is the sole source of truth; no module maintains a conflicting parallel copy.
- [Open — team/instructor to confirm] A data retention and deletion policy for participant PII after the fest concludes is not currently defined anywhere in the source material and should be explicitly decided, even if the answer is simple.

## 8. Technical Constraints

These are confirmed decisions, recorded here as constraints on implementation — not requirements to be re-litigated by this PRD. Functional requirements above remain implementation-agnostic except where they directly depend on these decisions (e.g., TOTP behavior in FR-2.1).

| Layer                  | Decision                                                                                                                                                                                                                                                                                                                                                                   |
|------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Frontend               | React.js, built and delivered as a Progressive Web App (PWA).                                                                                                                                                                                                                                                                                                              |
| Backend                | Python + FastAPI.                                                                                                                                                                                                                                                                                                                                                          |
| Database               | MongoDB, including a separate `photos` collection linked to participants by ID.                                                                                                                                                                                                                                                                                            |
| Authentication         | **Google Sign-in (OAuth), no passwords**, restricted to the four confirmed IITM domains; JWT-based session tokens after sign-in. Digital identity is a **TOTP rotating QR (RFC 6238), one secret per participant per event/checkpoint**, generated on-device and verified server-side on scan. **Fixed TOTP parameters (frontend and backend must match): HMAC-SHA1, 6 digits, 30-second step, ±1 step (~90s) window, Base32-encoded 160-bit secret** (`pyotp` backend / `otpauth` frontend). The organizer app supplies the checkpoint context at scan; the QR carries only `{ participant_id, current_code }`. |
| Authorization          | Four-tier RBAC: Participant → Organizer → Admin → Super Admin. Only Super Admin can assign roles; first Super Admin seeded directly in the database.                                                                                                                                                                                                                       |
| Scaling approach (MVP) | Stateless backend design with a shared **Redis** caching layer on the QR/TOTP verification path (highest-traffic operation), which also holds replay-protection state, rate-limit counters, and temporary verification state across instances. Full multi-service data distribution and load balancing is deferred to the Future Roadmap (Section 11).                     |
| Timezone               | **India Standard Time (IST)** is the official application timezone; all human-facing timestamps (logs, receipts, schedules) use IST. TOTP itself is computed on Unix epoch time (timezone-independent), so a correct device clock is what matters, not the display timezone.                                                                                              |
| Payments               | Certified third-party payment gateway with hosted checkout (e.g., a Razorpay/Stripe-style provider; specific provider not yet chosen — see Open Questions, Section 9.2). Raw card/payment data is never handled or stored directly by Paradox Connect.                                                                                                                     |
| Hosting (presentation) | Vercel (frontend) and Render (backend), free tier.                                                                                                                                                                                                                                                                                                                         |
| Version Control        | Git & GitHub.                                                                                                                                                                                                                                                                                                                                                              |
| Budget                 | ₹0 infrastructure budget. Free-tier/open-source services only for deployment, while the system is designed and documented to production-grade architecture and engineering practices.                                                                                                                                                                                      |
| Integration            | Standalone/greenfield for MVP with respect to IITM's own systems — no integration with existing IITM SSO, hostel/mess databases, or fest website in this release. The third-party payment gateway is a separate, necessary external integration for fee collection. Google OAuth is used as the sign-in provider only, not as an integration with IITM's internal systems. |

## 9. Risks & Open Questions

### 9.1 Risk Register

| **ID** | **Risk**                                                                                                                                                                                                                              | **Impact** | **Mitigation**                                                                                                                                                                                                                                                                                                                                                                                                        |
|:-------|:--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:-----------|:----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| R1     | Free-tier hosting (Render/Vercel) may not sustain 10,000+ concurrent sessions; free tiers commonly have cold starts and concurrency limits.                                                                                           | High       | Mitigation locked for MVP: stateless backend design plus a caching layer on the QR/TOTP verification path (Section 7.1, 8). This reduces but does not eliminate the risk — load-test against free-tier limits early (Week 1–2) and escalate to stakeholders if the NFR and ₹0 budget constraint still prove incompatible. Full multi-service distribution and load balancing is Future Roadmap (Section 11), not MVP. |
| R2     | Online-only QR validation depends on stable network at every venue; poor connectivity during peak crowd recreates the exact problem being solved.                                                                                     | High       | Audit network conditions at every physical venue before launch; treat this as a hard go/no-go dependency, not a soft assumption.                                                                                                                                                                                                                                                                                      |
| R3     | 4-week timeline against 9 epics plus production-grade security is aggressive for a 5-person team.                                                                                                                                     | High       | Hold firm to the P0/P1/P2 tiering in Section 5; move any at-risk P0 item to P1 early rather than cutting corners late.                                                                                                                                                                                                                                                                                                |
| R4     | Single-interview research basis means needs of non-interviewed personas (mess managers, vendors, security staff) are inferred, not validated.                                                                                         | Medium     | Even 2–3 lightweight validation conversations with other personas in Week 1 would materially de-risk requirements for their modules.                                                                                                                                                                                                                                                                                  |
| R5     | No fallback plan exists for system downtime during the live, week-long fest, where the system is the primary channel for many of the pain points it replaces.                                                                         | Medium     | Define a manual/paper backup SOP for each checkpoint type before launch.                                                                                                                                                                                                                                                                                                                                              |
| R6     | Resolved — backend framework confirmed as Python + FastAPI (Section 8).                                                                                                                                                               | Resolved   | No further action; retained here for decision history.                                                                                                                                                                                                                                                                                                                                                                |
| R7     | No data retention/deletion policy defined for student PII collected during the fest.                                                                                                                                                  | Low        | Define a simple retention and deletion timeline explicitly, even if the policy itself is minimal.                                                                                                                                                                                                                                                                                                                     |
| R8     | Payment gateway integration adds a new external dependency and failure mode — e.g., a payment succeeds at the gateway but its confirmation (webhook/callback) fails to reach our backend, leaving a paying participant marked unpaid. | Medium     | Build idempotent, signature-verified payment confirmation handling with a status-polling fallback in addition to webhooks; provide an admin manual-override path (FR-10.4) to mark a payment confirmed if the automated path fails.                                                                                                                                                                                   |

### 9.2 Open Questions

These are explicitly unresolved and should not be treated as decided by omission:

- Exact numeric success-metric targets: hostel check-in time, query resolution turnaround, system uptime (Section 3.2).
- Whether a manual/paper fallback procedure is required for outages, and who owns defining it (Risk R5).
- Data retention/deletion policy for participant PII after the fest concludes (Risk R7).
- Whether successful hostel/mess payment hard-gates access (blocks allocation/check-in until paid) or is tracked without enforcement in the MVP demo (Epic 10; FR-4.2, FR-5.1, FR-5.2).
- Which specific third-party payment gateway provider will be used, and its transaction fee and settlement timeline implications (Section 5.3).

## 10. Testing Strategy & Release Plan

### 10.1 Testing Strategy (high-level)

- Unit testing for core business logic: identity issuance/validation, query routing, profile management, payment status transitions.
- Integration testing for the end-to-end QR issuance → scan → verification flow, since it is the critical path shared by mess, hostel, workshop, and event modules.
- Integration testing for the payment flow specifically: initiate payment → gateway hosted checkout → success/failure callback → status update on the participant profile, including a simulated failed/late-webhook case (Risk R8).
- Load/performance testing specifically simulating the 10,000+ concurrent session target ahead of fest week — the highest-risk NFR (see Risk R1) and therefore the highest-priority test to run early, not last. This should explicitly test the stateless-backend + cached-verification design under load, not just functional correctness.
- User acceptance testing (UAT) with a small group of real PORs/volunteers before go-live, to partially offset the single-interview research gap (Risk R4).
- Security testing: verify RBAC boundaries hold server-side (a Participant-role account cannot reach Admin routes even by direct API call, and a regular Admin cannot call the Super-Admin-only role-assignment endpoint), verify Google OAuth tokens and JWT session tokens are never exposed in logs or responses, verify the TOTP secret is never returned by any endpoint after initial provisioning, and verify payment webhook/callback signatures are checked rather than trusted at face value.

Detailed test cases and full QA documentation are out of scope for this PRD and belong to a later milestone, per team direction.

### 10.2 MVP Acceptance Criteria (Definition of Done for Launch)

- All P0 features (Section 5.1) implemented and passing integration tests.
- Digital ID issuance and scan-verification working end-to-end for at least mess, hostel, and one event flow.
- Hostel and mess payment flows (Epic 10) work end-to-end against the gateway's sandbox/test mode, including a handled failure case.
- The system has been demonstrated handling the target concurrent load in a test/staging environment — or, if free-tier constraints prevent full-scale testing, this is explicitly documented as an accepted risk rather than silently skipped.
- The full query lifecycle (raise → assign → track → resolve) is functional end-to-end.
- Security basics are in place: HTTPS enforced, Google OAuth verified server-side, TOTP secrets encrypted at rest and never re-exposed, four-tier RBAC (including Super-Admin-only role assignment) enforced server-side, payment callbacks signature-verified.

### 10.3 Release Plan

A single ("big-bang") MVP release is planned ahead of the project presentation, covering all 9 research epics plus Epic 10 (Payments) per the tiering in Section 5. The following week-by-week plan is a suggested starting point for the team to adjust based on actual skill distribution and availability — it is not a confirmed commitment.

| **Timeframe** | **Focus**                                                                                                                                            |
|:--------------|:-----------------------------------------------------------------------------------------------------------------------------------------------------|
| Week 1        | Set up the Python + FastAPI backend and MongoDB data model; build the auth foundation (Epic 7, Epic 2); provision a payment gateway sandbox account. |
| Week 2        | Build core P0 flows: event info (Epic 1), hostel check-in (Epic 5), mess access (Epic 4), and the hostel/mess payment flow (Epic 10).                |
| Week 3        | Build query management (Epic 6); integrate digital identity and payment status across all P0 modules; begin P1 items if ahead of schedule.           |
| Week 4        | P1 features as time allows; end-to-end, payment, and load testing (Section 10.1); bug fixing; presentation preparation.                              |

## 11. Future Roadmap (Post-MVP)

The following are explicitly deferred beyond the 4-week MVP, framed as candidate Phase 2+ initiatives rather than commitments:

- SSO / integration with existing IITM systems (student database, existing hostel/mess registration, existing fest website).
- Support for non-IITM/external participants, if Paradox's audience ever expands beyond IITM students/staff.
- Offline-tolerant **organizer-side** QR/TOTP verification fallback, for venues with unreliable connectivity (the student side already generates its QR offline; this would remove the remaining network dependency on the scanning device).
- Predictive crowd/queue forecasting and analytics.
- Automatic flagging of overloaded locations (FR-9.2), building on the operational dashboard.
- Advanced admin reporting and data export tooling.
- Native mobile app wrappers, if PWA performance or adoption proves insufficient after real-world use.
- Full multi-service data distribution and load balancing across backend instances, beyond the stateless + QR-path-caching design locked for MVP (Section 7.1, Risk R1).
- Automated refunds, cancellations, and GST-compliant invoicing for hostel/mess payments, beyond the MVP's one-time payment collection (Epic 10).
