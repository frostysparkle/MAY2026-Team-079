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
> edit is made.

## Documentation

- [Product Requirements Document](/docs/Paradox_Connect_PRD.md) — full scope, functional
  requirements, NFRs, risks, and release plan.

## Team

| Name                   | Roll No.   | Role                                |
|------------------------|------------|-------------------------------------|
| Veer Shah              | 23f1001524 | Code Reviewer / Tester              |
| Ashwin Devi Srinivasan | 23f2000226 | Backend Developer                   |
| Anshuman Pandey        | 23f3001726 | Product Manager / Backend Developer |
| Tanisha Agrawal        | 23f3001897 | Scrum Master / Tester               |
| Ravi Kumar K           | 24f1002594 | Frontend Developer                  |

## Backend Setup and Deployment Guide

This comprehensive guide covers how to set up and run the Paradox Connect backend from scratch, including environment configuration, database setup, seeding, and deployment.

---

### **Prerequisites**

- **Python 3.8+**
- **Git** (for cloning repository)
- **pip** (Python package manager)

---

### **1. Clone and Setup**

```bash
git clone <repository-url>
cd MAY2026-Team-079/backend
```

---

### **2. Python Environment**

```bash
# Create virtual environment (recommended)
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

---

### **3. Database Configuration**

#### **Option A: Local MongoDB (Development)**
1. Install MongoDB Community Edition from [mongodb.com](https://www.mongodb.com/try/download/community)
2. Start MongoDB service
3. Default connection: `mongodb://localhost:27017/paradox`

#### **Option B: MongoDB Atlas (Cloud/Production)**
1. Create free account at [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas)
2. Create M0 free cluster
3. Configure network access (add your IP or 0.0.0.0/0)
4. Create database user with read/write permissions
5. Copy connection string (starts with `mongodb+srv://`)

---

### **4. Environment Variables**

Create `backend/atlas-credentials.env`:

```env
# Database Configuration (choose one)
MONGODB_URI=mongodb://localhost:27017/paradox
# OR for Atlas:
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/paradox?retryWrites=true&w=majority

# Authentication
SECRET_KEY=your-super-secret-jwt-key-change-this-in-production

# AI Embeddings (choose one option)

# Option 1: OpenAI API (official, paid)
OPENAI_API_KEY=sk-your-openai-api-key-here

# Option 2: Local Embeddings (free, local server)
# EMBEDDINGS_API_KEY=not-needed
# EMBEDDINGS_BASE_URL=http://localhost:11434/v1  # Ollama default
# EMBEDDINGS_MODEL=llama2  # or your local model name

# Optional: Seeding passwords (will prompt if not set)
PARADOX_ADMIN_PASSWORD=admin123
PARADOX_STAFF_PASSWORD=staff123
```

**Important**: Never commit this file to git. It's already in `.gitignore`.

---

### **5. Running the Backend**

```bash
# Development mode (auto-reload)
python main.py

# OR using uvicorn directly
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Verify server is running:
- API Documentation: http://localhost:8000/docs
- OpenAPI Spec: http://localhost:8000/openapi.json

---

### **6. Database Seeding (Complete Setup)**

**Run these commands in order from the `backend/` directory:**

```bash
# 1. Bootstrap the first Super Admin account
python seed_staff.py --bootstrap --roster

# 2. Seed hostels catalogue
python seed.py --email paradox.admin@example.com

# 3. Seed mess halls and menus
python seed_mess.py --email paradox.admin@example.com

# 4. Seed events catalogue
python seed_events.py --email paradox.admin@example.com

# 5. Seed workshops catalogue
python seed_workshops.py --email paradox.admin@example.com

# 6. Assign staff to facilities
python seed_staff.py --assign --email paradox.admin@example.com

# 7. Seed student population (3000+ realistic students)
python seed_students.py
```

**Alternative: Dry run first**
```bash
python seed_students.py --dry-run
python seed.py --dry-run --email paradox.admin@example.com
```

---

### **7. Testing the Setup**

#### **Verify Seeding**
```bash
# Check counts in database
mongosh paradox --eval "db.participants.countDocuments()"
mongosh paradox --eval "db.backend_teams.countDocuments()"
mongosh paradox --eval "db.events.countDocuments()"
```

#### **Test Authentication**
```bash
# Admin login
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"paradox.admin@example.com","password":"admin123"}'

# Student login (use seeded student)
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"DS26F1000001@example.com","password":"password"}'
```

---

### **8. Production Deployment**

#### **Environment Variables in Production**
```bash
# Use system environment variables or secrets manager
export SECRET_KEY=$(openssl rand -hex 32)
export MONGODB_URI="your-production-uri"
export OPENAI_API_KEY="your-production-key"
```

#### **Running as Service (Linux)**
Create `/etc/systemd/system/paradox-backend.service`:
```ini
[Unit]
Description=Paradox Connect Backend
After=network.target mongod.service

[Service]
User=paradox
WorkingDirectory=/opt/paradox/backend
Environment="PATH=/opt/paradox/venv/bin"
ExecStart=/opt/paradox/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

---

### **9. Troubleshooting**

#### **Database Connection Failed**
```bash
# Check MongoDB is running
sudo systemctl status mongod
mongosh --eval "db.adminCommand('ping')"
```

#### **Missing Environment File**
```bash
# Create if missing
cp atlas-credentials.env.example atlas-credentials.env
# Edit with your values
```

#### **Seeding Errors**
```bash
# Check if catalogues exist first
python -c "from database import events_collection; print('Events:', events_collection.count_documents({}))"

# Run with verbose output
python seed_students.py --verbose
```

---

### **10. Default Credentials**

- **Super Admin**: `paradox.admin@example.com` / `admin123`
- **Staff Accounts**: Use passwords set in `PARADOX_STAFF_PASSWORD`
- **Students**: `DS26F1000001@example.com` through `DS26F1003000@example.com` / `password`

---

### **Quick Start Script**

Create `setup.sh`:
```bash
#!/bin/bash
cd backend

python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

cat > atlas-credentials.env << EOF
MONGODB_URI=mongodb://localhost:27017/paradox
SECRET_KEY=$(openssl rand -hex 32)
OPENAI_API_KEY=your-key-here
EOF

mongod --dbpath /data/db &
uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
```

---

### **API Documentation**

Complete API documentation is available at:
- Interactive Swagger UI: http://localhost:8000/docs
- OpenAPI JSON: http://localhost:8000/openapi.json
- API Specification: [/api_documentation.yaml](/api_documentation.yaml)