"""
Endpoint tests for `PATCH /profile/complete` (declared in main.py).

Two rules carry most of the weight here, and both hinge on
`model_fields_set` — the difference between "this field was left out" and "this
field was sent as null":

* an omitted `emergency_contact` must not erase a stored one, because no read
  route returns the field, so a client has nothing to resend after a fresh
  sign-in and every save used to destroy it;
* an omitted `mess_preference` is not a change, so it cannot trip the lock that
  applies once a hall has been allotted.
"""
import pytest

import database
import main as main_module
from testing.helpers import auth_headers

PROFILE = {
    "full_name": "Asha Nair",
    "dob": "2004-05-01",
    "house": "Bandipur",
    "gender": "female",
    "phone": "9000000001",
    "country": "India",
    "state": "TN",
    "city": "Chennai",
    "address": "1 Test Street",
    "program": "DS",
    "course_stage": "diploma",
}
CONTACT = {"name": "Ravi", "relation": "father", "phone": "9000000009"}


def stored(participant):
    return database.participants_collection.find_one({"_id": participant["_id"]})


def test_a_complete_profile_is_saved_and_echoed(client, participant):
    response = client.patch("/profile/complete", json=PROFILE, headers=auth_headers(participant))
    assert response.status_code == 200
    body = response.json()
    assert body["full_name"] == "Asha Nair"
    assert body["house"] == "Bandipur"
    assert stored(participant)["profile"]["full_name"] == "Asha Nair"


def test_the_response_carries_the_full_profile_map(client, participant):
    body = client.patch("/profile/complete", json=PROFILE,
                        headers=auth_headers(participant)).json()
    assert set(body) == {
        "full_name", "dob", "house", "gender", "phone", "mess_preference", "country",
        "state", "city", "address", "emergency_contact", "program", "course_stage",
        "event_preferences", "photo",
    }


def test_a_staff_token_is_refused(client, super_admin):
    response = client.patch("/profile/complete", json=PROFILE,
                            headers=auth_headers(super_admin))
    assert response.status_code == 403
    assert response.json()["detail"] == "Participant credentials required. Use /auth/login."


def test_no_token_is_refused(client):
    assert client.patch("/profile/complete", json=PROFILE).status_code in (401, 403)


def test_an_invalid_vocabulary_value_is_a_422(client, participant):
    assert client.patch("/profile/complete", json={**PROFILE, "house": "Hogwarts"},
                        headers=auth_headers(participant)).status_code == 422


def test_updated_at_is_stamped(client, participant):
    client.patch("/profile/complete", json=PROFILE, headers=auth_headers(participant))
    assert stored(participant)["updated_at"] >= participant["updated_at"]


# ---------------------------------------------------------------------------
# Photo
# ---------------------------------------------------------------------------

def test_a_photo_is_stored_when_supplied(client, participant):
    body = client.patch("/profile/complete", json={**PROFILE, "photo": "data:image/png;base64,AAA"},
                        headers=auth_headers(participant)).json()
    assert body["photo"] == "data:image/png;base64,AAA"
    assert stored(participant)["photo"] == "data:image/png;base64,AAA"


def test_an_omitted_photo_keeps_the_stored_one(client, make_participant):
    person = make_participant(photo="existing-photo")
    body = client.patch("/profile/complete", json=PROFILE, headers=auth_headers(person)).json()
    assert body["photo"] == "existing-photo"
    assert stored(person)["photo"] == "existing-photo"


# ---------------------------------------------------------------------------
# Emergency contact — omitted vs explicit null
# ---------------------------------------------------------------------------

def test_a_contact_can_be_saved(client, participant):
    body = client.patch("/profile/complete", json={**PROFILE, "emergency_contact": CONTACT},
                        headers=auth_headers(participant)).json()
    assert body["emergency_contact"] == CONTACT
    assert stored(participant)["profile"]["emergency_contact"] == CONTACT


def test_omitting_the_contact_preserves_a_stored_one(client, make_participant):
    """The regression this rule exists for: every profile save used to erase it."""
    person = make_participant(profile={"emergency_contact": CONTACT})
    body = client.patch("/profile/complete", json=PROFILE, headers=auth_headers(person)).json()
    assert body["emergency_contact"] == CONTACT
    assert stored(person)["profile"]["emergency_contact"] == CONTACT


def test_an_explicit_null_clears_the_contact(client, make_participant):
    """A client that means to remove a contact still can."""
    person = make_participant(profile={"emergency_contact": CONTACT})
    body = client.patch("/profile/complete", json={**PROFILE, "emergency_contact": None},
                        headers=auth_headers(person)).json()
    assert body["emergency_contact"] is None
    assert stored(person)["profile"]["emergency_contact"] is None


def test_an_explicit_clear_is_logged_because_nothing_else_records_it(
    client, make_participant, caplog
):
    import logging

    person = make_participant(profile={"emergency_contact": CONTACT})
    with caplog.at_level(logging.INFO, logger="paradox.profile"):
        client.patch("/profile/complete", json={**PROFILE, "emergency_contact": None},
                     headers=auth_headers(person))
    cleared = [r for r in caplog.records
               if r.getMessage() == "emergency contact cleared by explicit null"]
    assert cleared and cleared[-1].had_contact is True


def test_the_contacts_own_details_are_not_logged(client, make_participant, caplog):
    import logging

    person = make_participant(profile={"emergency_contact": CONTACT})
    with caplog.at_level(logging.INFO, logger="paradox.profile"):
        client.patch("/profile/complete", json={**PROFILE, "emergency_contact": None},
                     headers=auth_headers(person))
    assert not any("9000000009" in str(r.__dict__) for r in caplog.records)


# ---------------------------------------------------------------------------
# Mess preference lock
# ---------------------------------------------------------------------------

def test_the_preference_is_editable_before_a_hall_is_allotted(client, participant):
    body = client.patch("/profile/complete",
                        json={**PROFILE, "mess_preference": "south_indian__non_veg"},
                        headers=auth_headers(participant)).json()
    assert body["mess_preference"] == "south_indian__non_veg"


def test_changing_the_preference_after_allotment_is_a_409(client, make_participant):
    mess = database.mess_collection.insert_one({"mess_id": "MESS1", "type": "north_indian__veg"})
    person = make_participant(
        profile={"mess_preference": "north_indian__veg"},
        mess={"mess_id": mess.inserted_id, "registered": True},
    )
    response = client.patch("/profile/complete",
                            json={**PROFILE, "mess_preference": "jain"},
                            headers=auth_headers(person))
    assert response.status_code == 409
    assert response.json()["detail"] == "Mess preference is locked once a mess hall has been allotted"


def test_the_refusal_records_both_preferences_and_the_hall(client, make_participant, audit):
    mess = database.mess_collection.insert_one({"mess_id": "MESS1", "type": "north_indian__veg"})
    person = make_participant(
        profile={"mess_preference": "north_indian__veg"},
        mess={"mess_id": mess.inserted_id, "registered": True},
    )
    client.patch("/profile/complete", json={**PROFILE, "mess_preference": "jain"},
                 headers=auth_headers(person))

    row = audit.one("PROFILE_UPDATE_DENIED")
    assert row["details"]["reason"] == "mess_preference_locked"
    assert row["details"]["stored_preference"] == "north_indian__veg"
    assert row["details"]["requested_preference"] == "jain"
    assert row["details"]["mess_id"] == str(mess.inserted_id)


def test_resending_the_same_preference_after_allotment_is_allowed(client, make_participant):
    """Not a change, so not a violation."""
    mess = database.mess_collection.insert_one({"mess_id": "MESS1", "type": "north_indian__veg"})
    person = make_participant(
        profile={"mess_preference": "north_indian__veg"},
        mess={"mess_id": mess.inserted_id, "registered": True},
    )
    assert client.patch("/profile/complete",
                        json={**PROFILE, "mess_preference": "north_indian__veg"},
                        headers=auth_headers(person)).status_code == 200


def test_omitting_the_preference_after_allotment_keeps_it(client, make_participant):
    """The field is optional, so an omission must not be read as a request to
    write the model's default over a locked value."""
    mess = database.mess_collection.insert_one({"mess_id": "MESS1", "type": "north_indian__veg"})
    person = make_participant(
        profile={"mess_preference": "north_indian__veg"},
        mess={"mess_id": mess.inserted_id, "registered": True},
    )
    response = client.patch("/profile/complete", json=PROFILE, headers=auth_headers(person))
    assert response.status_code == 200
    assert response.json()["mess_preference"] == "north_indian__veg"
    assert stored(person)["profile"]["mess_preference"] == "north_indian__veg"


def test_an_explicit_null_preference_after_allotment_is_a_change_and_refused(
    client, make_participant
):
    mess = database.mess_collection.insert_one({"mess_id": "MESS1", "type": "north_indian__veg"})
    person = make_participant(
        profile={"mess_preference": "north_indian__veg"},
        mess={"mess_id": mess.inserted_id, "registered": True},
    )
    assert client.patch("/profile/complete", json={**PROFILE, "mess_preference": None},
                        headers=auth_headers(person)).status_code == 409


def test_registering_for_mess_without_a_hall_does_not_lock_the_preference(
    client, make_participant
):
    """The lock keys off `mess.mess_id`, not `mess.registered`."""
    person = make_participant(mess={"registered": True, "mess_id": None})
    assert client.patch("/profile/complete", json={**PROFILE, "mess_preference": "jain"},
                        headers=auth_headers(person)).status_code == 200


# ---------------------------------------------------------------------------
# Preference embedding
# ---------------------------------------------------------------------------

def test_an_embedding_is_generated_when_the_preference_text_changes(
    client, participant, monkeypatch
):
    calls = []

    def embedder(text):
        calls.append(text)
        return [0.5] * 768

    monkeypatch.setattr(main_module, "generate_embedding", embedder)
    client.patch("/profile/complete", json={**PROFILE, "event_preferences": "robotics, music"},
                 headers=auth_headers(participant))

    assert calls == ["robotics, music"]
    document = stored(participant)
    # One shared vector under both slots: there is only one preference field, so
    # workshop- and event-side matching start out identical.
    assert document["embedding"]["workshop"] == [0.5] * 768
    assert document["embedding"]["event"] == [0.5] * 768


def test_resubmitting_the_same_preference_text_does_not_re_embed(
    client, make_participant, monkeypatch
):
    """So a form saved twice does not burn an embeddings call each time."""
    calls = []
    monkeypatch.setattr(main_module, "generate_embedding",
                        lambda text: calls.append(text) or [0.1] * 768)
    person = make_participant(profile={"event_preferences": "robotics"})

    client.patch("/profile/complete", json={**PROFILE, "event_preferences": "robotics"},
                 headers=auth_headers(person))
    assert calls == []


def test_an_omitted_preference_text_does_not_re_embed(client, participant, monkeypatch):
    calls = []
    monkeypatch.setattr(main_module, "generate_embedding",
                        lambda text: calls.append(text) or [0.1] * 768)
    client.patch("/profile/complete", json=PROFILE, headers=auth_headers(participant))
    assert calls == []


def test_the_preference_text_itself_is_never_logged(client, participant, caplog):
    import logging

    with caplog.at_level(logging.INFO, logger="paradox.profile"):
        client.patch("/profile/complete",
                     json={**PROFILE, "event_preferences": "a very identifiable phrase"},
                     headers=auth_headers(participant))
    logged = [r for r in caplog.records
              if r.getMessage() == "regenerating preference embedding"]
    assert logged
    assert logged[-1].preference_length == len("a very identifiable phrase")
    assert not any("identifiable" in str(r.__dict__) for r in caplog.records)


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------

def test_a_save_records_field_names_but_never_values(client, participant, audit):
    client.patch("/profile/complete", json={**PROFILE, "emergency_contact": CONTACT},
                 headers=auth_headers(participant))
    row = audit.one("PROFILE_UPDATE")
    assert row["target_id"] == participant["participant_id"]
    assert "full_name" in row["details"]["fields_supplied"]
    assert "emergency_contact" in row["details"]["fields_supplied"]
    # Names only: the values are personal data and already live in the document.
    assert "Asha Nair" not in str(row["details"])
    assert "9000000009" not in str(row["details"])


def test_the_audit_row_reports_what_the_save_actually_did(client, participant, audit):
    client.patch("/profile/complete",
                 json={**PROFILE, "photo": "AAA", "mess_preference": "jain",
                       "event_preferences": "music"},
                 headers=auth_headers(participant))
    details = audit.one("PROFILE_UPDATE")["details"]
    assert details["photo_replaced"] is True
    assert details["embedding_regenerated"] is True
    assert details["mess_preference_changed"] is True


def test_the_actor_is_recorded_as_the_participant(client, participant, audit):
    client.patch("/profile/complete", json=PROFILE, headers=auth_headers(participant))
    row = audit.one("PROFILE_UPDATE")
    assert row["actor_id"] == participant["participant_id"]
    assert row["actor_type"] == "participant"
    assert row["actor_role"] == "participant"


def test_a_participant_deleted_mid_request_is_reported_as_an_integrity_event(
    client, participant, caplog
):
    """
    The document was found moments earlier by the auth dependency, so a zero
    match means it was deleted mid-request. Without this the endpoint would still
    return the profile it *meant* to save.
    """
    import logging

    original = database.participants_collection.update_one

    def delete_then_update(*args, **kwargs):
        database.participants_collection.delete_one({"_id": participant["_id"]})
        return original(*args, **kwargs)

    with caplog.at_level(logging.ERROR, logger="paradox.audit"):
        import unittest.mock

        with unittest.mock.patch.object(
            database.participants_collection, "update_one", side_effect=delete_then_update
        ):
            response = client.patch("/profile/complete", json=PROFILE,
                                    headers=auth_headers(participant))

    assert response.status_code == 200, "the endpoint still answers"
    assert any(getattr(r, "reason", None) == "participant_vanished_mid_request"
               for r in caplog.records)
