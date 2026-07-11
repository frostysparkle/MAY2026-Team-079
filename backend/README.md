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

Authentication fails closed when `GOOGLE_CLIENT_ID` or a JWT secret of at least
32 characters is missing.

## Initialize MongoDB

The initial database uses three collections:

* `users` stores every person's verified Google identity, profile, status, and roles.
* `event_registrations` links a user to an event without growing the user document.
* `staff_assignments` grants organizer or staff access for a particular scope.

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
* `GET /api/v1/health/ready` confirms that MongoDB is configured and reachable.
* `GET /api/v1/health/google` confirms local Google/JWT configuration and checks
  Google's OpenID Connect discovery endpoint without exposing credentials.

`/live` works without MongoDB. `/ready` returns HTTP 503 until `MONGODB_URI` points to a reachable database.
