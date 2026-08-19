# Paradox Connect

A Centralized Management Platform & Student Help Portal for **Paradox**, the IIT Madras fest.

Software Engineering [BSCS3001] — IIT Madras BS Degree Program
**Team:** blastoi-SE · **Team Code:** MAY2026-Team-079

## Overview

Paradox Connect is a Progressive Web App (PWA) that replaces scattered email/WhatsApp
communication and manual physical verification (ID cards, mess cards, attendance sheets)
with one integrated platform, built around a single participant profile. It covers:

- Centralized event information and updates
- A unified QR/TOTP-based digital identity for all entry checkpoints
- Real-time attendance and crowd visibility
- Mess information and digital mess access
- Hostel allocation and digital check-in
- Hostel and mess fee payments (via a certified third-party gateway)
- Structured query and contact management
- Targeted announcements and an operational dashboard for the core team

## Tech Stack

| Layer          | Choice                                                              |
|----------------|--------------------------------------------------------------------|
| Frontend       | React.js (Progressive Web App)                                      |
| Backend        | Python + FastAPI                                                    |
| Database       | MongoDB                                                             |
| Authentication | Google Sign-in (OAuth, IITM domains only) + JWT sessions           |
| Digital ID     | Rotating QR, RSA-OAEP encrypted payload, per participant             |
| Payments       | Certified third-party gateway, hosted checkout                     |
| Hosting        | Vercel (frontend) · Render (backend) — free tier                   |

## Project Status

**Sprint 3 · 13–18 August 2026** — the Milestone 2 screens are now integrated against the
live FastAPI backend, and the staff/admin console has been built out on top of it.

| Area | State |
|---|---|
| Public site — landing, event catalogue, workshop programme, schedule, sponsors | Built |
| Participant app — registration, dual login, profile, event & workshop booking | Built |
| Digital identity — rotating QR, RSA-OAEP payload (replaces the earlier TOTP scheme) | Built |
| Checkpoint scanners — event, workshop, mess, hostel | Built |
| Staff console — staff home, event teams, event participation | Built |
| Admin console — events, workshops, mess, hostels, staff, backend teams | Built |
| Audit trail — full log plus per-entity views | Built |
| Fest overview board — KPIs, capacity, trends, alerts | Built |
| Mess & hostel fee payments | **Not built.** The backend has no payments domain; the Finance panel renders a client-side demo ledger derived from real rosters and is labelled as such. |
| Query / contact management | **Not started** |
| Targeted announcements | **Not started** |

The backend gained a participant statistics endpoint, unauthenticated event and workshop
catalogues, accommodation request/cancel routes, mess cuisine metadata, and audit-log
filtering this sprint, with seed scripts and pytest coverage for each.

## Contributing

> **🔒 The backend is frozen.** No changes may be made to anything under `backend/` —
> routes, schemas, auth, QR crypto, or the published API contract. Frontend code adapts to
> the backend, never the reverse. If a change appears to require touching `backend/`, stop
> and raise it with the team, including the exact file, line, and proposed diff, before any
> edit is made. Full rule and required reporting format: [CLAUDE.md](CLAUDE.md).

## Documentation

- [Project Instructions](CLAUDE.md) — working agreements and the backend-freeze rule.
- [Product Requirements Document](docs/Paradox_Connect_PRD.md) — full scope, functional
  requirements, NFRs, risks, and release plan.

## Team

| Name                   | Roll No.   | Role                                |
|------------------------|------------|-------------------------------------|
| Veer Shah              | 23f1001524 | Code Reviewer / Tester              |
| Ashwin Devi Srinivasan | 23f2000226 | Backend Developer                   |
| Anshuman Pandey        | 23f3001726 | Product Manager / Backend Developer |
| Tanisha Agrawal        | 23f3001897 | Scrum Master / Tester               |
| Ravi Kumar K           | 24f1002594 | Frontend Developer                  |
