import type { ParticipantRecord } from '@/api/types';
import {
  changedFields,
  clearedFields,
  displayName,
  EDITABLE_FIELDS,
  editableValue,
  formFrom,
  hasChanges,
  hostelLabel,
  hostelNames,
  signupLabel,
  standingOf,
} from './participantAdmin';

/**
 * Story 7.3's pure rules.
 *
 * Two of these matter more than the rest. `changedFields` sends only what
 * actually changed, because `UPDATE_PARTICIPANT` naming eleven fields when one
 * was edited is an audit trail nobody can read. And it refuses to send a cleared
 * field, because emptying an input is not the same request as deleting a value,
 * and this form does not claim to do the second.
 */

function participant(overrides: Partial<ParticipantRecord> = {}): ParticipantRecord {
  return {
    participant_id: 'DS23F1000042',
    email: '23f1000042@ds.study.iitm.ac.in',
    profile: {
      full_name: 'Meera Raghunathan',
      house: 'Ganga',
      gender: 'female',
      phone: '9000000001',
      country: 'India',
      state: 'TN',
      city: 'Chennai',
      address: 'IITM',
      program: 'DS',
      course_stage: 'diploma',
    },
    event_count: 2,
    workshop_count: 1,
    ...overrides,
  } as ParticipantRecord;
}

describe('the editable set', () => {
  it('offers no identity, credential, or allocation field', () => {
    // The routes that own those enforce rules a direct write would skip — capacity,
    // scan state, and the email-to-id derivation every roster and QR joins on.
    const keys = EDITABLE_FIELDS.map((field) => field.key as string);
    for (const forbidden of [
      'email',
      'participant_id',
      'password_hash',
      'qr_secrets',
      'mess',
      'accommodation',
      'events',
      'workshops',
      'photo',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('offers the profile fields an admin would actually need to correct', () => {
    const keys = EDITABLE_FIELDS.map((field) => field.key as string);
    expect(keys).toContain('full_name');
    expect(keys).toContain('phone');
    expect(keys).toContain('house');
  });
});

describe('formFrom', () => {
  it('reads every editable field off the profile', () => {
    const form = formFrom(participant());
    expect(form.full_name).toBe('Meera Raghunathan');
    expect(form.city).toBe('Chennai');
  });

  it('turns a missing value into an empty string, never undefined', () => {
    // An uncontrolled input that becomes controlled mid-edit is a React warning
    // and a lost keystroke.
    const form = formFrom(participant({ profile: {} }));
    for (const field of EDITABLE_FIELDS) {
      expect(form[field.key]).toBe('');
    }
  });
});

describe('editableValue', () => {
  it('offers the known vocabulary for a select field', () => {
    const gender = EDITABLE_FIELDS.find((field) => field.key === 'gender')!;
    expect(editableValue(gender, 'female')).toEqual(['male', 'female', 'other']);
  });

  it('keeps a stored value the vocabulary does not list', () => {
    // Silently rewriting `Male` to `male` while an admin edited a phone number is
    // a change nobody asked for, and it would show in the trail as theirs.
    const gender = EDITABLE_FIELDS.find((field) => field.key === 'gender')!;
    expect(editableValue(gender, 'Male')[0]).toBe('Male');
  });

  it('returns nothing for a free-text field', () => {
    const name = EDITABLE_FIELDS.find((field) => field.key === 'full_name')!;
    expect(editableValue(name, 'anything')).toEqual([]);
  });
});

describe('changedFields', () => {
  const original = formFrom(participant());

  it('sends nothing when nothing changed', () => {
    expect(changedFields(original, { ...original })).toEqual({});
    expect(hasChanges(original, { ...original })).toBe(false);
  });

  it('sends only the field that changed', () => {
    const edited = { ...original, phone: '9111111111' };
    expect(changedFields(original, edited)).toEqual({ phone: '9111111111' });
    expect(hasChanges(original, edited)).toBe(true);
  });

  it('sends several when several changed', () => {
    const edited = { ...original, phone: '9111111111', city: 'Coimbatore' };
    expect(changedFields(original, edited)).toEqual({
      phone: '9111111111',
      city: 'Coimbatore',
    });
  });

  it('trims, so re-saving the same value with spaces sends nothing', () => {
    expect(changedFields(original, { ...original, city: '  Chennai  ' })).toEqual({});
  });

  it('never sends a cleared field', () => {
    // Emptying a field would overwrite a real value with nothing, which is a
    // deletion dressed up as an edit.
    expect(changedFields(original, { ...original, address: '' })).toEqual({});
    expect(hasChanges(original, { ...original, address: '' })).toBe(false);
  });

  it('names cleared fields so the form can explain why Save ignored them', () => {
    const cleared = clearedFields(original, { ...original, address: '', phone: '' });
    expect(cleared.map((field) => field.key).sort()).toEqual(['address', 'phone']);
  });

  it('does fill a field that was empty before', () => {
    const blank = formFrom(participant({ profile: {} }));
    expect(changedFields(blank, { ...blank, full_name: 'Arjun P' })).toEqual({
      full_name: 'Arjun P',
    });
  });
});

describe('standingOf', () => {
  it('reads a profile with a name as complete', () => {
    // The same test `/participants/statistics` makes: a profile is `{}` from
    // registration until `PATCH /profile/complete` fills it.
    expect(standingOf(participant()).profileComplete).toBe(true);
    expect(standingOf(participant({ profile: {} })).profileComplete).toBe(false);
  });

  it('reports placement and campus presence', () => {
    const placed = participant({
      accommodation: { hostel_id: 'GANGA', room: '214', logged_in: true },
      mess: { mess_id: 'NILGIRI' },
    });
    expect(standingOf(placed)).toEqual({
      profileComplete: true,
      hostel: 'GANGA',
      mess: 'NILGIRI',
      onCampus: true,
    });
  });

  it('reads an unplaced participant as nowhere rather than throwing', () => {
    expect(standingOf(participant({ accommodation: undefined, mess: undefined }))).toEqual({
      profileComplete: true,
      hostel: null,
      mess: null,
      onCampus: false,
    });
  });
});

describe('displayName', () => {
  it('uses the name on file', () => {
    expect(displayName(participant())).toBe('Meera Raghunathan');
  });

  it('falls back to the id, which is always present', () => {
    expect(displayName(participant({ profile: {} }))).toBe('DS23F1000042');
  });
});

/**
 * The roster used to print `accommodation.hostel_id` — a code like `HS01` that an
 * admin had to translate by hand. A participant record carries no block name, so
 * these two turn the catalogue from `GET /hostels` into the name the column
 * shows, and decide what to do when the catalogue cannot answer.
 */
describe('hostelNames', () => {
  it('maps each block id to its name', () => {
    expect(
      hostelNames([
        { hostel_id: 'HS01', name: 'Alakananda', capacity: 300, gender: 'male' },
        { hostel_id: 'HS04', name: 'Ganga', capacity: 300, gender: 'male' },
      ]),
    ).toEqual({ HS01: 'Alakananda', HS04: 'Ganga' });
  });

  it('drops a nameless block rather than mapping it to an empty string', () => {
    // So `hostelLabel` falls back to the id instead of rendering nothing.
    expect(
      hostelNames([{ hostel_id: 'HS01', name: '   ', capacity: 300, gender: 'male' }]),
    ).toEqual({});
  });
});

describe('hostelLabel', () => {
  const names = { HS01: 'Alakananda' };

  it('names the block and keeps the room number', () => {
    const placed = participant({ accommodation: { hostel_id: 'HS01', room: '214' } });
    expect(hostelLabel(placed, names)).toBe('Alakananda · 214');
  });

  it('falls back to the code when the catalogue has no row for it', () => {
    // An id reads worse than a name but it is still true, and hiding the
    // placement would make an allotted participant look unhoused.
    const placed = participant({ accommodation: { hostel_id: 'HS99', room: '214' } });
    expect(hostelLabel(placed, names)).toBe('HS99 · 214');
    expect(hostelLabel(placed, {})).toBe('HS99 · 214');
  });

  it('names the block alone when no room is recorded', () => {
    expect(hostelLabel(participant({ accommodation: { hostel_id: 'HS01' } }), names)).toBe(
      'Alakananda',
    );
  });

  it('is null for somebody with no block, which the column shows as not allotted', () => {
    expect(hostelLabel(participant({ accommodation: undefined }), names)).toBeNull();
    expect(hostelLabel(participant({ accommodation: { hostel_id: null } }), names)).toBeNull();
  });
});

/**
 * This column read `0 ev · 1 ws` until somebody asked what it meant, which is the
 * only evidence an abbreviation needs. The counts themselves are untouched.
 */
describe('signupLabel', () => {
  const signups = (event_count: number, workshop_count: number) =>
    signupLabel(participant({ event_count, workshop_count }));

  it('spells out both nouns instead of abbreviating them', () => {
    expect(signups(2, 3)).toBe('2 events · 3 workshops');
  });

  it('says "1 event" and "1 workshop" rather than pluralising a single one', () => {
    expect(signups(1, 1)).toBe('1 event · 1 workshop');
  });

  it('pluralises zero, as English does', () => {
    expect(signups(0, 0)).toBe('0 events · 0 workshops');
  });

  it('pluralises each noun on its own count', () => {
    expect(signups(0, 1)).toBe('0 events · 1 workshop');
    expect(signups(1, 0)).toBe('1 event · 0 workshops');
  });
});
