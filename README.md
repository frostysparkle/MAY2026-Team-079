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
| Database       | MongoDB Atlas (`paradox` database)                                  |
| Authentication | Email + password (IITM domains only), bcrypt, JWT sessions          |
| Digital ID     | Rotating QR, RSA-OAEP encrypted payload, per participant             |
| Payments       | Not implemented — see Project Status                                |
| Hosting        | Vercel (frontend) · Render (backend) — free tier                   |

## Project Status

**Sprint 3 · 13–18 August 2026** — the Milestone 2 screens are now integrated against the
live FastAPI backend, and the staff/admin console has been built out on top of it.

| Area | State |
|---|---|
| Public site — landing, event catalogue, workshop programme, schedule, sponsors | Built |
| Participant app — registration, dual login, profile, event & workshop booking | Built |
| Data source | **Live backend only.** The in-memory mock API was removed; the app always calls the real FastAPI backend. |
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

## Backend Setup Instructions

### Quick Start

1. **Navigate to backend directory**:
   ```bash
   cd backend
   ```

2. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure environment**:
   Create `atlas-credentials.env` file with:
   ```env
   MONGODB_URI=mongodb://localhost:27017/paradox
   SECRET_KEY=your-secret-key-here
   # For embeddings (optional):
   # OPENAI_API_KEY=your-key-here
   ```

4. **Run the backend**:
   ```bash
   python main.py
   # or
   uvicorn main:app --host 0.0.0.0 --port 8000 --reload
   ```

### Database Setup

**Option A: Local MongoDB**:
- Install MongoDB Community Edition
- Default connection: `mongodb://localhost:27017/paradox`

**Option B: MongoDB Atlas**:
- Create free cluster at mongodb.com/cloud/atlas
- Configure network access and database user
- Use provided connection string

### Seeding (Optional)
Run from `backend/` directory:
```bash
python seed_staff.py --bootstrap --roster
python seed.py --email paradox.admin@example.com
python seed_mess.py --email paradox.admin@example.com
python seed_events.py --email paradox.admin@example.com
python seed_workshops.py --email paradox.admin@example.com
python seed_staff.py --assign --email paradox.admin@example.com
python seed_students.py
```

### Default Credentials
- Admin: `paradox.admin@example.com` / `admin123`
- Students: `DS26F1000001@example.com` through `DS26F1003000@example.com` / `password`

### API Documentation
- Interactive docs: http://localhost:8000/docs
- OpenAPI spec: http://localhost:8000/openapi.json