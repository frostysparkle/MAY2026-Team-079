"""
Publish the Paradox workshop programme through the Super Admin workshops API.

Every workshop is sent to ``POST /workshops`` with exactly the payload the
dashboard's "+ New workshop" form sends — same endpoint, same schema, same Super
Admin permission check — so the workshops created here are indistinguishable
from ones typed in by hand, and remain fully editable in the dashboard
afterwards.

The programme itself lives in ``frontend/src/data/paradoxWorkshops.json``. That
one dataset is also what the frontend's mock API seeds, so the mock and the real
database hold the same programme.

Its content is taken from the workshop flyers in
``frontend/public/images/workshops/`` (title, description, speaker,
pre-requisites, date and shift) and from the Paradox check-in emails (venue).
Nothing is invented: two workshops whose venue appears in no email carry
"To be announced" and are meant to be edited in the dashboard.

Usage::

    python seed_workshops.py --email admin@paradox.dev
    python seed_workshops.py --email admin@paradox.dev --update
    python seed_workshops.py --email admin@paradox.dev --drop-demo

The password is read from ``PARADOX_ADMIN_PASSWORD`` or prompted for, so it never
lands in your shell history. Re-running is safe: workshops that already exist are
skipped unless ``--update`` is given.
"""

import argparse
import json
import os
from getpass import getpass
from pathlib import Path

import httpx

DEFAULT_API = "http://localhost:8000"
DEFAULT_DATASET = (
    Path(__file__).resolve().parent.parent / "frontend" / "src" / "data" / "paradoxWorkshops.json"
)

# The demo workshops the dashboard used to show. They were never real content,
# and are only removed when explicitly asked for.
DEMO_WORKSHOP_IDS = ("WS1", "WS2")

# `WorkshopUpdateRequest` has no `slot_id`: a workshop's time slot is fixed at
# creation because participants' bookings reference it, so it is dropped from
# update payloads.
UPDATE_FIELDS = ("name", "description", "venue", "capacity", "instructions")


def login(client: httpx.Client, email: str, password: str) -> str:
    """Sign in as staff and return the bearer token."""
    response = client.post("/auth/admin/login", json={"email": email, "password": password})
    if response.status_code != 200:
        raise SystemExit(f"Login failed ({response.status_code}): {_detail(response)}")

    body = response.json()
    if body.get("role") != "super_admin":
        raise SystemExit(
            f"{email} has role {body.get('role')!r}; only a Super Admin may create workshops."
        )
    return body["access_token"]


def _detail(response: httpx.Response) -> str:
    try:
        return str(response.json().get("detail", response.text))
    except ValueError:
        return response.text


def publish_workshops(
    client: httpx.Client,
    workshops: list[dict],
    *,
    update: bool = False,
    drop_demo: bool = False,
    log=print,
) -> dict:
    """
    Create (or update) every workshop in ``workshops`` through the workshops API.

    Takes an already-authenticated client so the transport is the caller's
    choice: the CLI passes a real ``httpx.Client``, the tests pass FastAPI's
    ``TestClient``, and both exercise the same code path.

    Returns a tally of what happened.
    """
    existing_response = client.get("/workshops")
    if existing_response.status_code != 200:
        raise SystemExit(f"Could not list workshops: {_detail(existing_response)}")
    existing = {w["workshop_id"] for w in existing_response.json()}
    log(f"{len(existing)} workshop(s) already in the database")

    tally = {"created": 0, "updated": 0, "skipped": 0, "demo_deleted": 0, "failed": 0}

    for payload in workshops:
        workshop_id = payload["workshop_id"]

        if workshop_id in existing:
            if not update:
                tally["skipped"] += 1
                continue
            body = {k: v for k, v in payload.items() if k in UPDATE_FIELDS}
            response = client.put(f"/workshops/{workshop_id}", json=body)
            if response.status_code == 200:
                tally["updated"] += 1
                log(f"  updated {workshop_id} — {payload['name']}")
            else:
                tally["failed"] += 1
                log(f"  FAILED  {workshop_id}: {_detail(response)}")
            continue

        response = client.post("/workshops", json=payload)
        if response.status_code == 200:
            tally["created"] += 1
            log(f"  created {workshop_id} — {payload['name']}")
        else:
            tally["failed"] += 1
            log(f"  FAILED  {workshop_id}: {_detail(response)}")

    if drop_demo:
        for workshop_id in DEMO_WORKSHOP_IDS:
            if workshop_id not in existing:
                continue
            response = client.delete(f"/workshops/{workshop_id}")
            if response.status_code == 200:
                tally["demo_deleted"] += 1
                log(f"  deleted demo workshop {workshop_id}")
            else:
                tally["failed"] += 1
                log(f"  FAILED  deleting {workshop_id}: {_detail(response)}")

    return tally


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default=DEFAULT_API, help=f"API base URL (default {DEFAULT_API})")
    parser.add_argument("--email", required=True, help="Super Admin email")
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET, help="Workshop dataset JSON")
    parser.add_argument(
        "--update",
        action="store_true",
        help="Overwrite workshops that already exist, instead of skipping them",
    )
    parser.add_argument(
        "--drop-demo",
        action="store_true",
        help=f"Delete the retired demo workshops ({', '.join(DEMO_WORKSHOP_IDS)}) if present",
    )
    args = parser.parse_args()

    if not args.dataset.is_file():
        raise SystemExit(f"Dataset not found: {args.dataset}")

    workshops = json.loads(args.dataset.read_text(encoding="utf-8"))
    print(f"Loaded {len(workshops)} workshops from {args.dataset}")

    password = os.getenv("PARADOX_ADMIN_PASSWORD") or getpass(f"Password for {args.email}: ")

    with httpx.Client(base_url=args.api.rstrip("/"), timeout=30.0) as client:
        token = login(client, args.email, password)
        client.headers["Authorization"] = f"Bearer {token}"

        tally = publish_workshops(client, workshops, update=args.update, drop_demo=args.drop_demo)

    print("\nDone. " + " ".join(f"{name}={count}" for name, count in tally.items()))
    return 1 if tally["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
