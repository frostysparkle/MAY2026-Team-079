"""
Unit tests for the remaining request models: the admin participant edit, the
query models, the locally-declared issue models, and the embeddings request.
"""
import pytest
from pydantic import ValidationError

from models import (
    COURSE_STAGES,
    GENDERS,
    HOUSES,
    MESS_PREFERENCE_TYPES,
    PROGRAMS,
    EmbeddingRequest,
    ParticipantAdminUpdateRequest,
    QueryCreateRequest,
    QueryReplyRequest,
    QueryTeamAssignRequest,
    QueryUpdateRequest,
)
from routers.issues import IssueCreateRequest, IssueUpdateRequest


# ---------------------------------------------------------------------------
# ParticipantAdminUpdateRequest
# ---------------------------------------------------------------------------

def test_an_empty_admin_edit_is_schema_valid():
    """The 400 "Nothing to update" is the route's decision, not the schema's."""
    assert ParticipantAdminUpdateRequest().model_dump(exclude_unset=True) == {}


def test_only_profile_fields_are_writable():
    """Identity, credentials, and allocation state are unreachable by
    construction — the strongest guarantee this model gives."""
    fields = set(ParticipantAdminUpdateRequest.model_fields)
    for forbidden in ("email", "participant_id", "password_hash", "qr_secrets",
                      "mess", "accommodation", "events", "workshops", "photo"):
        assert forbidden not in fields


def test_the_writable_field_set():
    assert set(ParticipantAdminUpdateRequest.model_fields) == {
        "full_name", "house", "gender", "phone", "mess_preference", "country",
        "state", "city", "address", "program", "course_stage", "emergency_contact",
    }


@pytest.mark.parametrize("house", sorted(HOUSES))
def test_every_house_is_accepted(house):
    assert ParticipantAdminUpdateRequest(house=house).house == house


@pytest.mark.parametrize(
    "field,bad_value,message",
    [
        ("house", "Hogwarts", "house must be one of"),
        ("gender", "other", "gender must be one of"),
        ("program", "BS", "program must be one of"),
        ("course_stage", "masters", "course_stage must be one of"),
        ("mess_preference", "vegan", "mess_preference must be one of"),
    ],
)
def test_an_admin_cannot_write_a_value_a_participant_could_not(field, bad_value, message):
    with pytest.raises(ValidationError) as excinfo:
        ParticipantAdminUpdateRequest(**{field: bad_value})
    assert message in str(excinfo.value)


@pytest.mark.parametrize("field", ["house", "gender", "program", "course_stage", "mess_preference"])
def test_a_validated_field_may_still_be_omitted_or_null(field):
    """The validators guard on `is not None`, so absence is never an error."""
    assert getattr(ParticipantAdminUpdateRequest(**{field: None}), field) is None


def test_the_admin_vocabularies_match_the_participant_ones():
    for values in (HOUSES, GENDERS, PROGRAMS, COURSE_STAGES):
        assert len(values) == len(set(values))
    assert len(MESS_PREFERENCE_TYPES) == 5


def test_free_text_fields_are_unvalidated():
    request = ParticipantAdminUpdateRequest(full_name="  ", phone="not-a-number", city="")
    assert request.full_name == "  "


def test_the_nested_emergency_contact_is_still_validated():
    with pytest.raises(ValidationError):
        ParticipantAdminUpdateRequest(emergency_contact={"name": "Ravi"})
    request = ParticipantAdminUpdateRequest(
        emergency_contact={"name": "Ravi", "relation": "father", "phone": "9"}
    )
    assert request.emergency_contact.name == "Ravi"


def test_exclude_unset_and_exclude_none_together_are_what_the_route_relies_on():
    """`update_participant` builds its dotted `$set` from
    `model_dump(exclude_unset=True, exclude_none=True)`, so an all-null body is
    empty and becomes a 400 rather than blanking the profile."""
    assert ParticipantAdminUpdateRequest(house=None).model_dump(
        exclude_unset=True, exclude_none=True
    ) == {}
    assert ParticipantAdminUpdateRequest(house="Gir", phone=None).model_dump(
        exclude_unset=True, exclude_none=True
    ) == {"house": "Gir"}


# ---------------------------------------------------------------------------
# Query models
# ---------------------------------------------------------------------------

def test_a_valid_query_create_request():
    request = QueryCreateRequest(category="hostel", subject="Tap", body="Broken", target_id="HSTL111")
    assert request.target_id == "HSTL111"


def test_target_id_is_optional_at_the_schema_layer():
    """Whether it is required depends on the category, which the route decides."""
    assert QueryCreateRequest(category="general", subject="s", body="b").target_id is None


@pytest.mark.parametrize("field", ["subject", "body"])
def test_subject_and_body_may_not_be_empty(field):
    payload = {"category": "general", "subject": "s", "body": "b", field: ""}
    with pytest.raises(ValidationError):
        QueryCreateRequest(**payload)


def test_whitespace_only_subject_passes_the_length_check_then_strips_to_empty():
    """`min_length=1` counts the whitespace, and the route strips afterwards, so a
    blank-looking query is storable. Pinned as current behaviour."""
    request = QueryCreateRequest(category="general", subject="   ", body="   ")
    assert request.subject.strip() == ""


def test_category_is_not_a_closed_set_at_the_schema_layer():
    """The route returns 400 with the allowed list, so an unknown category is a
    400 rather than a 422."""
    assert QueryCreateRequest(category="weather", subject="s", body="b").category == "weather"


def test_a_query_update_is_entirely_optional():
    assert QueryUpdateRequest().model_dump(exclude_unset=True) == {}


def test_query_update_fields():
    assert set(QueryUpdateRequest.model_fields) == {"status", "assigned_team", "assigned_to"}


def test_a_reply_requires_a_non_empty_body():
    assert QueryReplyRequest(body="On it").body == "On it"
    with pytest.raises(ValidationError):
        QueryReplyRequest(body="")


def test_team_assignment_requires_a_non_empty_user_id():
    assert QueryTeamAssignRequest(user_id="OTUH1111").user_id == "OTUH1111"
    with pytest.raises(ValidationError):
        QueryTeamAssignRequest(user_id="")


# ---------------------------------------------------------------------------
# Issue models
# ---------------------------------------------------------------------------

VALID_ISSUE = {
    "facility_type": "hostel",
    "facility_id": "HSTL111",
    "category": "water",
    "subject": "Tap is broken",
    "body": "No water since morning.",
}


def test_a_valid_issue_create_request():
    assert IssueCreateRequest(**VALID_ISSUE).room is None


def test_subject_length_bounds():
    assert IssueCreateRequest(**{**VALID_ISSUE, "subject": "abc"}).subject == "abc"
    assert IssueCreateRequest(**{**VALID_ISSUE, "subject": "x" * 120})
    with pytest.raises(ValidationError):
        IssueCreateRequest(**{**VALID_ISSUE, "subject": "ab"})
    with pytest.raises(ValidationError):
        IssueCreateRequest(**{**VALID_ISSUE, "subject": "x" * 121})


def test_body_length_bounds():
    assert IssueCreateRequest(**{**VALID_ISSUE, "body": "abc"})
    assert IssueCreateRequest(**{**VALID_ISSUE, "body": "x" * 2000})
    with pytest.raises(ValidationError):
        IssueCreateRequest(**{**VALID_ISSUE, "body": "ab"})
    with pytest.raises(ValidationError):
        IssueCreateRequest(**{**VALID_ISSUE, "body": "x" * 2001})


@pytest.mark.parametrize("field", ["facility_type", "facility_id", "category", "subject", "body"])
def test_every_issue_field_but_room_is_required(field):
    payload = dict(VALID_ISSUE)
    payload.pop(field)
    with pytest.raises(ValidationError):
        IssueCreateRequest(**payload)


def test_facility_type_and_category_are_validated_in_the_route_not_the_schema():
    """Both are 400s with the allowed list, because the allowed categories depend
    on the facility type."""
    request = IssueCreateRequest(**{**VALID_ISSUE, "facility_type": "library", "category": "wifi"})
    assert request.facility_type == "library"


def test_an_issue_update_needs_neither_field_at_the_schema_layer():
    """The 400 "Provide a status, a note, or both" is the route's."""
    assert IssueUpdateRequest().status is None


def test_an_issue_note_is_length_capped():
    assert IssueUpdateRequest(note="x" * 2000)
    with pytest.raises(ValidationError):
        IssueUpdateRequest(note="x" * 2001)


def test_issue_update_fields():
    assert set(IssueUpdateRequest.model_fields) == {"status", "note"}


# ---------------------------------------------------------------------------
# EmbeddingRequest
# ---------------------------------------------------------------------------

def test_a_single_string_input():
    assert EmbeddingRequest(input="hello").input == "hello"


def test_a_list_of_strings_input():
    assert EmbeddingRequest(input=["a", "b"]).input == ["a", "b"]


def test_input_is_required():
    with pytest.raises(ValidationError):
        EmbeddingRequest()


def test_optional_fields_default_to_none_so_the_route_can_omit_them():
    """The route forwards only what is set, because some OpenAI-compatible
    servers reject unrecognised nulls."""
    request = EmbeddingRequest(input="hello")
    assert request.model == request.encoding_format == request.dimensions == request.user is None


def test_optional_fields_round_trip():
    request = EmbeddingRequest(input="hello", model="text-embedding-3-large",
                              encoding_format="base64", dimensions=256, user="u1")
    assert request.dimensions == 256
    assert request.encoding_format == "base64"


def test_an_empty_string_input_is_schema_valid():
    """No minimum: the provider decides. `generate_embedding` short-circuits
    blank text separately."""
    assert EmbeddingRequest(input="").input == ""
