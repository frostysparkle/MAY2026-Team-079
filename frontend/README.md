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

The app talks to the real FastAPI backend, so point `VITE_API_BASE_URL` at a
running backend (including the `/api/v1` prefix). For realistic local data, seed
the backend test accounts and use the dev-only account switcher
(`VITE_ENABLE_DEV_SWITCHER=true`, dev builds only) — see `backend/README.md`
(`scripts.seed_test_data` + `/auth/dev-login`).

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
  api/          Typed ApiClient interface, real backend adapter, contract types
  components/   Reusable UI primitives, layout shell, route guard
  config/       env, constants (roles, TOTP params, domains), routes
  features/     Feature logic (auth, profile, qr, scan)
  lib/          TOTP, encrypted secret store, image/validation helpers
  pages/        Route screens
  stores/       Zustand stores (auth, ui)
```

## Notes for the team

- **Single API boundary.** Everything goes through `src/api` behind the
  `ApiClient` interface — components never call `fetch` directly. Set
  `VITE_API_BASE_URL` to your backend. The request/response types in
  `src/api/types.ts` are the shared contract with the backend.
- **Offline digital ID.** The My QR page generates TOTP codes on-device from a
  per-checkpoint secret cached in encrypted IndexedDB — no server call on refresh.
  Test offline behavior with `npm run build && npm run preview`, then toggle the
  network in devtools.
- **RBAC is UI-only here.** Route guards gate screens, but the backend must
  enforce roles server-side; the guards are not a security boundary.
- **Deferred to a later sprint:** animated QR countdown ring, remember-last-role.
