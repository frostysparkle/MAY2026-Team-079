# Paradox Connect backend

## Run locally

1. Install dependencies:

   ```bash
   uv sync
   ```

2. Set the variables shown in `.env.example`. For a local MongoDB instance:

   ```bash
   export MONGODB_URI='mongodb://localhost:27017'
   export MONGODB_DATABASE='paradox_connect'
   ```

3. Start the API:

   ```bash
   uv run uvicorn app.main:app --reload
   ```

Interactive API documentation: `http://127.0.0.1:8000/docs`.

Generate a local JWT signing secret and place the result in `.env`:

```powershell
.venv-windows\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(48))"
```

QR verification also requires Redis plus a Fernet key held outside MongoDB:

```powershell
.\.venv-windows\Scripts\python.exe -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Set the output as `QR_SECRET_ENCRYPTION_KEY` and configure `REDIS_URL`. Scan
verification fails closed when either dependency is unavailable. Redis stores
only expiring, hashed replay/rate-limit keys; MongoDB stores encrypted TOTP
secret ciphertext and the durable scan audit log.

Authentication fails closed when `GOOGLE_CLIENT_ID` or a JWT secret of at least
32 characters is missing.

## Initialize MongoDB

The initial database uses three collections:

* `users` stores every person's verified Google identity, profile, status, and roles.
* `event_registrations` links a user to an event without growing the user document.
* `staff_assignments` grants organizer or staff access for a particular scope.

Admins manage those assignments through `/api/v1/admin/staff-assignments`.
Event operations use `scope_type=event` with the event ID; mess, hostel, and
workshop operations use `scope_type=checkpoint`. A `scope_id` of `*` is an
explicit wildcard. Admin and Super Admin roles retain global access.

After configuring `.env`, initialize the collections, indexes, and optional
Super Admin invitation:

```powershell
.venv-windows\Scripts\python.exe -m scripts.init_db
```

Set `INITIAL_SUPER_ADMIN_EMAIL` to an allowed IITM Google account if the first
Super Admin should be invited during initialization. The invitation has no
password and cannot authenticate until that exact account signs in through
Google and the backend verifies its token.

The command is idempotent. It also removes the obsolete unique `username` index,
which would otherwise prevent multiple Google-only users from being created. It
does not delete legacy password records; those accounts cannot authenticate and
are reported as a warning. A legacy record with a verified matching email has
its password fields removed when it first links to Google.

### Initial indexes

* Unique Google subjects, emails, and participant roll numbers.
* One event registration per `(user_id, event_id)` pair.
* One staff assignment per `(user_id, role, scope_type, scope_id)` tuple.
* One QR secret per `(user_id, checkpoint_context, scope_id)` tuple; event
  secrets use the concrete event ID as `scope_id`.

## Google authentication

The frontend obtains a Google Identity Services credential and sends it to:

```http
POST /api/v1/auth/google
Content-Type: application/json
```

```json
{"credential": "<google-id-token>"}
```

The backend verifies the Google signature, audience, expiry, verified email, and
hosted IITM domain. It creates or finds the user using Google's stable `sub`
claim, then returns a short-lived Paradox Connect JWT. Send that JWT on later
requests as `Authorization: Bearer <token>`.

`GET /api/v1/users/me` returns the authenticated user and is a convenient way to
verify that the issued application JWT works.

The API never accepts an email or role from the client as proof of identity.
New users always start with the `participant` role.

## Health endpoints

* `GET /` confirms that FastAPI is running and points to the database check.
* `GET /ping-db` returns MongoDB reachability in the starter response format.
* `GET /api/v1/health/live` confirms that FastAPI is running.
* `GET /api/v1/health/ready` confirms MongoDB, Redis, and QR encryption
  configuration are ready.
* `GET /api/v1/health/google` confirms local Google/JWT configuration and checks
  Google's OpenID Connect discovery endpoint without exposing credentials.

`/live` works without external services. `/ready` returns HTTP 503 until MongoDB,
Redis, and QR secret encryption are configured.

## Test accounts (manual QA)

For end-to-end manual testing there is a seed script plus a dev-only login so you
can switch between realistic accounts without creating data by hand.

Seed (idempotent — purges the previously seeded test data, then rebuilds it;
real data is untouched):

```bash
uv run python -m scripts.seed_test_data          # purge + re-seed
uv run python -m scripts.seed_test_data --reset  # purge test data only
```

This creates accounts on `@ds.study.iitm.ac.in`, each in a distinct state:

| Email local part | Role | State |
|---|---|---|
| `newbie` | participant | signed in, no profile |
| `profileonly` | participant | profile done, no bookings |
| `hosteler` | participant | accommodation booked + paid + allocated |
| `hostelunpaid` | participant | accommodation chosen, payment pending |
| `messie` | participant | mess plan booked + paid |
| `fullstack` | participant | profile + hostel + mess + events, all paid |
| `eventfan` | participant | registered for several events |
| `paidpending` | participant | one paid + one pending payment |
| `volunteer` | organizer | scanner access |
| `warden` | admin | admin surfaces |

To use them in the app, enable the **dev-only** login (never in production):

```bash
export APP_ENV=development
export ENABLE_DEV_LOGIN=true
```

Then:

* `GET  /api/v1/auth/test-accounts` — lists the seeded accounts (dev only).
* `POST /api/v1/auth/dev-login {"email": "hosteler@ds.study.iitm.ac.in"}` — issues
  a normal session for that seeded account (dev only).

Both endpoints return **404** unless `ENABLE_DEV_LOGIN=true` **and**
`APP_ENV != production`, and only accounts flagged `is_test` can be assumed, so
real users are never reachable this way. The frontend account switcher uses these
endpoints when `VITE_ENABLE_DEV_SWITCHER=true`.
