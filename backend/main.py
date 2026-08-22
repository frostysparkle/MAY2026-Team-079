from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime

from models import ProfileCompleteRequest

from routers import (
    workshops, workshop_slots, events, mess, hostels, audit, participants, embeddings,
    queries, issues, auth, backend_teams
)
from dependencies import get_current_participant
from database import participants_collection
from embedding_service import generate_embedding

app = FastAPI(title="Paradox Connect API")

# Add CORS middleware for the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==========================================
# PROFILE APIS
#
# Kept here rather than moved into routers/auth.py: this route calls
# `generate_embedding` through main's own module-level reference, and
# testing/embeddings/test_content_embeddings.py patches it there via
# `monkeypatch.setattr(main_module, "generate_embedding", embedder)`. Moving
# this endpoint elsewhere would leave that patch aimed at nothing.
# ==========================================

@app.patch("/profile/complete")
def complete_profile(request: ProfileCompleteRequest, current_user: dict = Depends(get_current_participant)):
    if "participant_id" not in current_user:
        raise HTTPException(status_code=400, detail="Only participants have student profiles")

    # The meal preference is editable only until a hall is allotted.
    #
    # `POST /mess/allocate` places a participant against `profile.mess_preference`
    # and stores the hall on `mess.mess_id`. Letting the preference change after
    # that would leave a student holding a seat in a hall that no longer serves
    # what they eat, and the allocation batch never revisits a participant who
    # already has a hall — so the disagreement would be permanent and invisible.
    # Enforced here rather than only in the UI, so it holds for any client.
    #
    # A request that does not mention `mess_preference` is not a change: the field
    # is optional, and `model_fields_set` is what separates "left out" from "sent
    # this value". An omitted field keeps whatever is on file, instead of writing
    # the model's placeholder default over it.
    stored_preference = (current_user.get("profile") or {}).get("mess_preference")
    preference_sent = "mess_preference" in request.model_fields_set
    requested_preference = request.mess_preference if preference_sent else stored_preference
    mess_allotted = (current_user.get("mess") or {}).get("mess_id") is not None
    if mess_allotted and requested_preference != stored_preference:
        raise HTTPException(
            status_code=409,
            detail="Mess preference is locked once a mess hall has been allotted",
        )

    # An omitted emergency contact is not a deletion.
    #
    # This endpoint replaces `profile` wholesale, and the field is optional, so
    # writing None whenever it was left out erased a contact already on file. That
    # was reachable in normal use rather than theoretical: no read route returns
    # `profile.emergency_contact` — it reaches a client only through this route's
    # own response echo — so on a fresh sign-in a client has nothing to resend and
    # every profile save destroyed it.
    #
    # Same `model_fields_set` test `mess_preference` above already uses, and the
    # same distinction: "left out" keeps what is stored, while an explicit null
    # still clears it, so a client that means to remove a contact can.
    if "emergency_contact" in request.model_fields_set:
        emergency_contact = (
            request.emergency_contact.model_dump() if request.emergency_contact else None
        )
    else:
        emergency_contact = (current_user.get("profile") or {}).get("emergency_contact")

    profile_data = {
        "full_name": request.full_name,
        "dob": request.dob,
        "house": request.house,
        "gender": request.gender,
        "phone": request.phone,
        "mess_preference": requested_preference,
        "country": request.country,
        "state": request.state,
        "city": request.city,
        "address": request.address,
        "emergency_contact": emergency_contact,
        "program": request.program,
        "course_stage": request.course_stage,
        "event_preferences": request.event_preferences,
    }

    update_doc = {
        "profile": profile_data,
        "updated_at": datetime.utcnow()
    }
    if request.photo:
        update_doc["photo"] = request.photo

    # Only re-embed when the preference text actually changed, so resubmitting
    # an unchanged profile form doesn't burn an embeddings API call every time.
    previous_preferences = current_user.get("profile", {}).get("event_preferences")
    if request.event_preferences and request.event_preferences != previous_preferences:
        preference_vector = generate_embedding(request.event_preferences)
        # One shared preference embedding, stored under both slots: there is
        # currently only one preference field, so workshop- and event-side
        # matching start out identical until the two are given separate inputs.
        update_doc["embedding"] = {
            "workshop": preference_vector,
            "event": preference_vector
        }

    participants_collection.update_one(
        {"_id": current_user["_id"]},
        {"$set": update_doc}
    )

    return {
        **profile_data,
        "photo": request.photo or current_user.get("photo")
    }


# ==========================================
# ROUTERS
# ==========================================
app.include_router(auth.router)
app.include_router(backend_teams.router)
app.include_router(workshops.router)
app.include_router(workshop_slots.router)
app.include_router(events.router)
app.include_router(mess.router)
app.include_router(hostels.router)
app.include_router(audit.router)
app.include_router(participants.router)
app.include_router(embeddings.router)
app.include_router(queries.router)
app.include_router(issues.router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
