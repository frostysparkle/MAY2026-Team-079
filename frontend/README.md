# Paradox Connect — Frontend

Progressive Web App (PWA) frontend for Paradox Connect. Every screen talks to the
real FastAPI backend; the contract it codes against is documented in the root
[Frontend Integration Guide](../Frontend_Integration_Guide.md) and
[api_documentation.yaml](../api_documentation.yaml).

## Stack

- **React 19 + Vite + TypeScript** (strict)
- **Tailwind CSS v4** for styling
- **React Router** for routing, **React Hook Form** for forms
- **Zustand** for global state (auth/session, toasts)
- **qrcode.react** (render the digital ID), **html5-qrcode** (checkpoint scanning)
- **vite-plugin-pwa** for the installable, offline-capable app
- **Vitest + React Testing Library** for tests

## Getting started

There is no mock mode — the app always calls the real backend, so start that
first:

```bash
# 1. Backend (from backend/) — needs a reachable MongoDB; API on http://localhost:8000
uvicorn main:app --port 8000

# 2. Frontend
npm install
cp .env.example .env.local   # VITE_API_BASE_URL defaults to http://localhost:8000
npm run dev
```

Sign-in and registration are real email + password accounts. Registration
(`POST /auth/register`) is accepted only for IITM addresses matching
`@*.study.iitm.ac.in`; backend staff sign in separately at `/admin/login`
(`POST /auth/admin/login`).

## Scripts

| Script              | Purpose                                                     |
| ------------------- | ----------------------------------------------------------- |
| `npm run dev`       | Start the dev server                                        |
| `npm run build`     | Typecheck + production build (generates the service worker) |
| `npm run preview`   | Preview the production build (needed to test PWA/offline)   |
| `npm run test`      | Run unit/component tests                                    |
| `npm run coverage`  | Tests with coverage                                         |
| `npm run lint`      | ESLint                                                      |
| `npm run format`    | Prettier write                                              |
| `npm run typecheck` | TypeScript, no emit                                         |

## Structure

```
src/
  api/          Typed API client for the real backend, contract types
  components/   Reusable UI primitives, layout shells, route guard
  config/       env, constants (IITM email domains, mess/gender vocabularies), routes
  features/     Feature logic (auth, profile, qr, scan, announcements, workshops, …)
  lib/          RSA-OAEP QR encryption, image/CSV helpers
  pages/        Route screens
  stores/       Zustand stores (auth, ui)
```

## Notes for the team

- **Real backend required.** All requests go through `src/api` behind the
  `ApiClient` interface; `realApi` calls the FastAPI backend at
  `VITE_API_BASE_URL` (default `http://localhost:8000`, see `.env.example`).
  The earlier in-memory mock API layer has been removed.
- **Offline digital ID.** The My QR page renders a rotating QR whose payload is
  the participant id encrypted on-device with RSA-OAEP, using the public key
  issued at login — refreshing makes no network call, so the pass still works
  offline. It regenerates every 45 s because the backend rejects any code older
  than 60 s. Checkpoint scanners read it with html5-qrcode. Test offline
  behavior with `npm run build && npm run preview`, then toggle the network in
  devtools.
- **RBAC is UI-only here.** Route guards gate screens, but the backend must
  enforce roles server-side; the guards are not a security boundary.
