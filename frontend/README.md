# Paradox Connect — Frontend

Progressive Web App (PWA) frontend for Paradox Connect. Built in Sprint 1 by the
frontend developer. See the root [PRD](../docs/Paradox_Connect_PRD.md),
[QR/TOTP architecture](../docs/Paradox_Connect_QRTOTP_Architecture.md), and the
[Sprint 1 review](../docs/sprint1-frontend-review.md).

## Stack

- **React 19 + Vite + TypeScript** (strict)
- **Tailwind CSS v4** for styling
- **React Router** for routing, **React Hook Form** for forms
- **Zustand** for global state (auth/session, toasts)
- **otpauth** (TOTP), **qrcode.react** (render), **html5-qrcode** (scan)
- **vite-plugin-pwa** for the installable, offline-capable app
- **Vitest + React Testing Library** for tests

## Getting started

```bash
npm install
cp .env.example .env.local   # optional; sensible defaults work out of the box
npm run dev
```

The app runs against an in-memory **mock API** by default (`VITE_USE_MOCK_API=true`),
so no backend is required. The login screen uses the same email/password flow in
mock and real-API modes. Seed accounts (one per role):

- `student@mg.study.iitm.ac.in` — Participant
- `organizer@ee.study.iitm.ac.in` — Organizer
- `admin@es.study.iitm.ac.in` — Admin
- `superadmin@ds.study.iitm.ac.in` — Super Admin

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
  api/          Typed API client, mock + real implementations, contract types
  components/   Reusable UI primitives, layout shell, route guard
  config/       env, constants (roles, TOTP params, domains), routes
  features/     Feature logic (auth, profile, qr, scan)
  lib/          TOTP, encrypted secret store, image/validation helpers
  pages/        Route screens
  stores/       Zustand stores (auth, ui)
```

## Notes for the team

- **No backend yet.** Everything goes through `src/api` behind the `ApiClient`
  interface. Flip `VITE_USE_MOCK_API=false` (and set `VITE_API_BASE_URL`) to use
  the real backend once endpoints exist. The request/response types in
  `src/api/types.ts` are the contract for the backend developer.
- **Offline digital ID.** The My QR page generates TOTP codes on-device from a
  per-checkpoint secret cached in encrypted IndexedDB — no server call on refresh.
  Test offline behavior with `npm run build && npm run preview`, then toggle the
  network in devtools.
- **RBAC is UI-only here.** Route guards gate screens, but the backend must
  enforce roles server-side; the guards are not a security boundary.
- **Deferred to a later sprint:** animated QR countdown ring, remember-last-role.
