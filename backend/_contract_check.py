"""
Throwaway: does the body the FRONTEND actually builds satisfy the REAL route,
and does the response satisfy the TypeScript types the frontend declares?

Frontend tests mock the API and backend tests use hand-written bodies, so a key
mismatch would pass both. This posts the exact object `draftToRequest` is
asserted to produce in `frontend/src/features/issues/issues.test.ts` and checks
every field the TS interfaces name is present with the right kind of value.
"""
import os
import sys
from datetime import datetime
import random

os.environ["TESTING"] = "1"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from main import app
from database import (
    issues_collection, hostel_collection, mess_collection,
    participants_collection, backend_teams_collection,
)
import security

client = TestClient(app)
failures = []


def check(label, condition, detail=""):
    if condition:
        print(f"  ok   {label}")
    else:
        print(f"  FAIL {label} {detail}")
        failures.append(label)


# --- world -------------------------------------------------------------------
issues_collection.delete_many({})
rand = random.randint(100000, 999999)
email = f"23f{rand}@ds.study.iitm.ac.in"
client.post("/auth/register", json={"email": email, "password": "secure_password"})
login = client.post("/auth/login", json={"email": email, "password": "secure_password"}).json()
p_headers = {"Authorization": f"Bearer {login['access_token']}"}
client.patch("/profile/complete", json={
    "full_name": "Anita Rao", "dob": "2003-05-01", "house": "Ganga", "gender": "female",
    "phone": "9876500011", "mess_preference": "veg", "country": "India", "state": "TN",
    "city": "Chennai", "address": "IITM", "program": "DS", "course_stage": "degree",
}, headers=p_headers)

bt = f"BT{rand}"
backend_teams_collection.insert_one({
    "paradox_id": bt, "email": f"bt{rand}@ds.study.iitm.ac.in",
    "password_hash": security.get_password_hash("secure_password"),
    "role": "volunteer", "department": "hostels", "designation": "Block Volunteer",
    "created_at": datetime.utcnow(), "updated_at": datetime.utcnow(),
})
s_headers = {"Authorization": f"Bearer {client.post('/auth/admin/login', json={'email': f'bt{rand}@ds.study.iitm.ac.in', 'password': 'secure_password'}).json()['access_token']}"}

hostel_id = f"H{rand}"
hostel_collection.insert_one({
    "hostel_id": hostel_id, "name": "Ganga Block", "capacity": 300, "gender": "female",
    "coordinator": {"name": "Meera", "phone": "9876500099"},
    "hostel_team": [{"user_id": bt, "role": "volunteer", "name": "Ravi", "logging": False}],
    "created_at": datetime.utcnow(),
})
participants_collection.update_one(
    {"participant_id": login["id"]},
    {"$set": {"accommodation.hostel_id": hostel_id, "accommodation.room": "101"}},
)

# --- the exact body draftToRequest is asserted to build -----------------------
# See issues.test.ts > draftToRequest > "sends the facility split back into the
# two fields the API wants" — toEqual, so these are the only keys.
body = {
    "facility_type": "hostel",
    "facility_id": hostel_id,
    "category": "water",
    "subject": "No hot water",
    "body": "Cold since 6am.",
}
print("\nPOST /issues with the frontend's own body:")
created = client.post("/issues", json=body, headers=p_headers)
check("accepted", created.status_code == 200, created.text)
payload = created.json()
# IssueCreateResponse { message, issue_id, status }
check("IssueCreateResponse keys", set(payload) == {"message", "issue_id", "status"}, set(payload))
issue_id = payload["issue_id"]

print("\nGET /issues/mine matches the Issue interface:")
mine = client.get("/issues/mine", headers=p_headers).json()
check("IssueListResponse keys", set(mine) == {"count", "issues"}, set(mine))
row = mine["issues"][0]
ISSUE_KEYS = {
    "issue_id", "facility_type", "facility_id", "category", "subject", "body",
    "room", "status", "created_at", "updated_at", "updates",
}
check("Issue keys exactly as declared", set(row) == ISSUE_KEYS, set(row) ^ ISSUE_KEYS)
check("room defaulted to the allotted room", row["room"] == "101", row["room"])
check("status is an IssueStatus", row["status"] in ("open", "in_progress", "resolved"))
check("updates is a list", isinstance(row["updates"], list))
check("no reporter leaks to the author", "reporter" not in row)
check("no participant_id leaks to the author", "participant_id" not in row)

print("\nPATCH /issues/{id} with the frontend's own body:")
patched = client.patch(f"/issues/{issue_id}",
                       json={"status": "resolved", "note": "Element replaced."},
                       headers=s_headers)
check("accepted", patched.status_code == 200, patched.text)
check("IssueUpdateResponse keys",
      set(patched.json()) == {"message", "issue_id", "status"}, set(patched.json()))

print("\nGET /issues matches the StaffIssue interface:")
staff = client.get("/issues", headers=s_headers).json()
check("StaffIssueListResponse keys", set(staff) == {"count", "issues"}, set(staff))
srow = staff["issues"][0]
check("StaffIssue keys = Issue + reporter",
      set(srow) == ISSUE_KEYS | {"reporter"}, set(srow) ^ (ISSUE_KEYS | {"reporter"}))
check("reporter keys as declared",
      set(srow["reporter"]) == {"participant_id", "name", "phone", "room"}, set(srow["reporter"]))
check("reporter name/phone reach the team",
      srow["reporter"]["name"] == "Anita Rao" and srow["reporter"]["phone"] == "9876500011",
      srow["reporter"])

print("\nIssueUpdate shape, both audiences:")
supdate = srow["updates"][-1]
check("staff update carries `by`", set(supdate) == {"at", "status", "note", "by"}, set(supdate))
pupdate = client.get("/issues/mine", headers=p_headers).json()["issues"][0]["updates"][-1]
check("participant update omits `by`", set(pupdate) == {"at", "status", "note"}, set(pupdate))

print("\nTimestamps are the naive-UTC form formatIssueTime compensates for:")
check("created_at has no offset suffix",
      not row["created_at"].endswith("Z") and "+" not in row["created_at"][10:],
      row["created_at"])

print("\nThe status filter the client sends:")
check("?status=resolved narrows server-side",
      client.get("/issues?status=resolved", headers=s_headers).json()["count"] == 1)
check("?status=open now matches nothing",
      client.get("/issues?status=open", headers=s_headers).json()["count"] == 0)

print()
if failures:
    print(f"{len(failures)} CONTRACT FAILURE(S): {failures}")
    sys.exit(1)
print("Contract verified end to end.")
