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

Authentication uses email/password credentials and fails closed when the JWT
signing secret is missing or shorter than 32 characters. Passwords are stored
only as salted PBKDF2 hashes.

## Initialize MongoDB

The initial database uses three collections:

* `users` stores every person's account credentials, profile, status, and roles.
* `event_registrations` links a user to an event without growing the user
  document; an atomic counter on each event prevents concurrent overbooking.
* `staff_assignments` grants organizer or staff access for a particular scope.

Admins manage those assignments through `/api/v1/admin/staff-assignments`.
Event operations use `scope_type=event` with the event ID; mess, hostel, and
workshop operations use `scope_type=checkpoint`. A `scope_id` of `*` is an
explicit wildcard. Admin and Super Admin roles retain global access.

After configuring `.env`, initialize the collections, indexes, and optional
initial Super Admin:

```powershell
.venv-windows\Scripts\python.exe -m scripts.init_db
```

Set both `INITIAL_SUPER_ADMIN_EMAIL` and `INITIAL_SUPER_ADMIN_PASSWORD` when the
first Super Admin should be created during initialization. There is no default
password. The password is hashed before storage and is never printed. Bootstrap
refuses to replace a different Super Admin or promote an existing ordinary user.

The command is idempotent. It also removes obsolete unique `username` and
`google_subject` indexes left by earlier authentication models and reconciles
the atomic event-registration counters for existing events. Run it as a
maintenance operation while registrations are paused.

### Initial indexes

* Unique emails and participant roll numbers.
* One event registration per `(user_id, event_id)` pair.
* One staff assignment per `(user_id, role, scope_type, scope_id)` tuple.
* One QR secret per `(user_id, checkpoint_context, scope_id)` tuple; event
  secrets use the concrete event ID as `scope_id`.

## Email/password authentication

Public registration creates a participant account:

```http
POST /api/v1/auth/register
Content-Type: application/json
```

```json
{"email": "student@example.com", "password": "<password>", "full_name": "Student"}
```

Existing users sign in at `POST /api/v1/auth/login` with the same email/password
shape (without `full_name`). Both endpoints return a short-lived Paradox Connect
JWT. Send it on later requests as `Authorization: Bearer <token>`.

`GET /api/v1/users/me` returns the authenticated user and is a convenient way to
verify that the issued application JWT works.

Public registration never accepts a role from the client. New accounts always
start with the `participant` role; elevated roles and operational assignments
must come from authorized server-side administration.

## Health endpoints

* `GET /` confirms that FastAPI is running and points to the database check.
* `GET /ping-db` returns MongoDB reachability in the starter response format.
* `GET /api/v1/health/live` confirms that FastAPI is running.
* `GET /api/v1/health/ready` confirms MongoDB, Redis, and QR encryption
  configuration are ready.

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
