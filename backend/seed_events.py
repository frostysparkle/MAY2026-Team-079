"""
Publish the Paradox event catalogue through the Super Admin events API.

Every event is sent to ``POST /events`` with exactly the payload the dashboard's
"+ New Event" form sends — same endpoint, same schema, same Super Admin
permission check — so the events created here are indistinguishable from ones
typed in by hand, and remain fully editable in the dashboard afterwards.

The catalogue itself lives in ``frontend/src/data/paradoxEvents.json``. That one
dataset is also what the frontend's mock API seeds, so the mock and the real
database hold the same programme.

Usage::

    python seed_events.py --email admin@paradox.dev
    python seed_events.py --email admin@paradox.dev --update
    python seed_events.py --email admin@paradox.dev --drop-demo

The password is read from ``PARADOX_ADMIN_PASSWORD`` or prompted for, so it never
lands in your shell history. Re-running is safe: events that already exist are
skipped unless ``--update`` is given.
"""

import argparse
import json
import os
import sys
from getpass import getpass
from pathlib import Path

import httpx

DEFAULT_API = "http://localhost:8000"
DEFAULT_DATASET = Path(__file__).resolve().parent.parent / "frontend" / "src" / "data" / "paradoxEvents.json"

# The two demo events the dashboard used to show. They were never real content,
# and are only removed when explicitly asked for.
DEMO_EVENT_IDS = ("EVT_SOLO", "EVT_TEAM")

# `EventUpdateRequest` has no `event_type`; an event's category is fixed at
# creation, so it is dropped from update payloads.
UPDATE_FIELDS = (
    "name",
    "description",
    "poster",
    "team",
    "prize_money",
    "registration",
    "schedule",
    "registration_fields",
)


def login(client: httpx.Client, email: str, password: str) -> str:
    """Sign in as staff and return the bearer token."""
    response = client.post("/auth/admin/login", json={"email": email, "password": password})
    if response.status_code != 200:
        raise SystemExit(f"Login failed ({response.status_code}): {_detail(response)}")

    body = response.json()
    if body.get("role") != "super_admin":
        raise SystemExit(
            f"{email} has role {body.get('role')!r}; only a Super Admin may create events."
        )
    return body["access_token"]


def _detail(response: httpx.Response) -> str:
    try:
        return str(response.json().get("detail", response.text))
    except ValueError:
        return response.text


def publish_events(
    client: httpx.Client,
    events: list[dict],
    *,
    update: bool = False,
    drop_demo: bool = False,
    log=print,
) -> dict:
    """
    Create (or update) every event in ``events`` through the events API.

    Takes an already-authenticated client so the transport is the caller's
    choice: the CLI passes a real ``httpx.Client``, the tests pass FastAPI's
    ``TestClient``, and both exercise the same code path.

    Returns a tally of what happened.
    """
    existing_response = client.get("/events")
    if existing_response.status_code != 200:
        raise SystemExit(f"Could not list events: {_detail(existing_response)}")
    existing = {e["event_id"] for e in existing_response.json()}
    log(f"{len(existing)} event(s) already in the database")

    tally = {"created": 0, "updated": 0, "skipped": 0, "demo_deleted": 0, "failed": 0}

    for payload in events:
        event_id = payload["event_id"]

        if event_id in existing:
            if not update:
                tally["skipped"] += 1
                continue
            body = {k: v for k, v in payload.items() if k in UPDATE_FIELDS}
            response = client.put(f"/events/{event_id}", json=body)
            if response.status_code == 200:
                tally["updated"] += 1
                log(f"  updated {event_id} — {payload['name']}")
            else:
                tally["failed"] += 1
                log(f"  FAILED  {event_id}: {_detail(response)}")
            continue

        response = client.post("/events", json=payload)
        if response.status_code == 200:
            tally["created"] += 1
            log(f"  created {event_id} — {payload['name']}")
        else:
            tally["failed"] += 1
            log(f"  FAILED  {event_id}: {_detail(response)}")

    if drop_demo:
        for event_id in DEMO_EVENT_IDS:
            if event_id not in existing:
                continue
            response = client.delete(f"/events/{event_id}")
            if response.status_code == 200:
                tally["demo_deleted"] += 1
                log(f"  deleted demo event {event_id}")
            else:
                tally["failed"] += 1
                log(f"  FAILED  deleting {event_id}: {_detail(response)}")

    return tally


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default=DEFAULT_API, help=f"API base URL (default {DEFAULT_API})")
    parser.add_argument("--email", required=True, help="Super Admin email")
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET, help="Event dataset JSON")
    parser.add_argument(
        "--update",
        action="store_true",
        help="Overwrite events that already exist, instead of skipping them",
    )
    parser.add_argument(
        "--drop-demo",
        action="store_true",
        help=f"Delete the retired demo events ({', '.join(DEMO_EVENT_IDS)}) if present",
    )
    args = parser.parse_args()

    if not args.dataset.is_file():
        raise SystemExit(f"Dataset not found: {args.dataset}")

    events = json.loads(args.dataset.read_text(encoding="utf-8"))
    print(f"Loaded {len(events)} events from {args.dataset}")

    password = os.getenv("PARADOX_ADMIN_PASSWORD") or getpass(f"Password for {args.email}: ")

    with httpx.Client(base_url=args.api.rstrip("/"), timeout=30.0) as client:
        token = login(client, args.email, password)
        client.headers["Authorization"] = f"Bearer {token}"

        tally = publish_events(
            client, events, update=args.update, drop_demo=args.drop_demo
        )

    print(
        "\nDone. "
        + " ".join(f"{name}={count}" for name, count in tally.items())
    )
    return 1 if tally["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
