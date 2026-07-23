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
| Authentication | Email/password credentials + JWT sessions                            |
| Digital ID     | TOTP rotating QR (RFC 6238), per participant per checkpoint         |
| Payments       | Certified third-party gateway, hosted checkout                     |
| Hosting        | Vercel (frontend) · Render (backend) — free tier                   |

## Documentation

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
