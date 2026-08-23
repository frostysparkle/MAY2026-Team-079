import { describe, expect, it } from 'vitest';
import type { EmergencyContact, Hostel, Mess, MyHostelResponse } from '@/api/types';
import {
  contactCountLabel,
  coordinatorContact,
  dialDigits,
  groupSize,
  hostelContacts,
  hostelDirectory,
  messContacts,
  messDirectory,
  normalisePhone,
  ownEmergencyContact,
  readDutyContacts,
  searchDirectory,
  smsHref,
  telHref,
} from './dutyContacts';

function hostel(overrides: Partial<Hostel> = {}): Hostel {
  return {
    hostel_id: 'H12',
    name: 'Ganga Block',
    capacity: 300,
    gender: 'male',
    ...overrides,
  };
}

function mess(overrides: Partial<Mess> = {}): Mess {
  return {
    mess_id: 'M3',
    name: 'Hall C',
    capacity: 500,
    type: 'north_indian__veg',
    ...overrides,
  };
}

describe('normalisePhone', () => {
  it('keeps a number exactly as it was typed', () => {
    // Reformatting would misrepresent a landline or an extension.
    expect(normalisePhone('+91 98765 43210')).toBe('+91 98765 43210');
    expect(normalisePhone('  044-2257-8000 ')).toBe('044-2257-8000');
  });

  it('rejects the backend\u2019s own "no phone recorded" placeholder', () => {
    // `my_hostel` substitutes the literal string "N/A" for a missing phone.
    expect(normalisePhone('N/A')).toBeNull();
    expect(normalisePhone('n/a')).toBeNull();
    expect(normalisePhone('none')).toBeNull();
    expect(normalisePhone('-')).toBeNull();
  });

  it('rejects anything without enough digits to dial, keeps a short extension', () => {
    expect(normalisePhone('12')).toBeNull();
    expect(normalisePhone('')).toBeNull();
    expect(normalisePhone(undefined)).toBeNull();
    expect(normalisePhone('4512')).toBe('4512');
  });

  it('strips a number down for tel: and sms: links', () => {
    expect(dialDigits('+91 98765 43210')).toBe('+919876543210');
    expect(telHref('044-2257-8000')).toBe('tel:04422578000');
    expect(smsHref('9876543210', 'Water outage\nBlock 12')).toBe(
      'sms:9876543210?body=Water%20outage%0ABlock%2012',
    );
  });
});

describe('readDutyContacts', () => {
  it('replaces the role word the backend substitutes for a missing name', () => {
    // `my_hostel` sends `t.get("name") or t.get("role")`, so a nameless
    // volunteer arrives as the literal string "volunteer".
    const [contact] = readDutyContacts([{ name: 'volunteer', phone: '9876543210' }], 'On duty');
    expect(contact.name).toBe('On duty');
    expect(contact.phone).toBe('9876543210');
  });

  it('drops a record with neither a usable name nor a number', () => {
    expect(readDutyContacts([{ name: 'volunteer', phone: 'N/A' }])).toEqual([]);
    expect(readDutyContacts([{}])).toEqual([]);
    expect(readDutyContacts(null)).toEqual([]);
  });

  it('keeps a named contact with no number, and says so by leaving phone null', () => {
    expect(readDutyContacts([{ name: 'Meera R', phone: 'N/A' }])).toEqual([
      { name: 'Meera R', phone: null },
    ]);
  });

  it('collapses the same person listed twice', () => {
    const contacts = readDutyContacts([
      { name: 'Meera R', phone: '+91 98765 43210' },
      { name: 'meera r', phone: '+919876543210' },
    ]);
    expect(contacts).toHaveLength(1);
  });

  it('sorts reachable contacts ahead of names alone', () => {
    const contacts = readDutyContacts([
      { name: 'No Number', phone: 'N/A' },
      { name: 'Reachable', phone: '9876543210' },
    ]);
    expect(contacts.map((c) => c.name)).toEqual(['Reachable', 'No Number']);
  });

  it('labels a count the same way everywhere', () => {
    expect(contactCountLabel(1)).toBe('1 contact on duty');
    expect(contactCountLabel(3)).toBe('3 contacts on duty');
  });

  it('reads a block\u2019s masked list and a hall\u2019s team through the same rules', () => {
    const my = { volunteers: [{ name: 'volunteer', phone: 'N/A' }] } as MyHostelResponse;
    expect(hostelContacts(my)).toEqual([]);
    expect(messContacts([{ user_id: null, role: 'other', name: 'Ravi', logging: true }])).toEqual([
      { name: 'Ravi', phone: null },
    ]);
  });
});

describe('coordinatorContact', () => {
  it('reads name and phone out of the untyped coordinator dict', () => {
    expect(coordinatorContact({ name: 'Dr. Rao', phone: '+91 98765 43210' })).toEqual({
      name: 'Dr. Rao',
      phone: '+91 98765 43210',
    });
  });

  it('accepts the alternative keys hand-entered records use', () => {
    expect(coordinatorContact({ full_name: 'Dr. Rao', mobile: '9876543210' })).toEqual({
      name: 'Dr. Rao',
      phone: '9876543210',
    });
  });

  it('is absent when the block has no coordinator, or nothing usable in one', () => {
    // `hostel.coordinator` is a bare, untyped dict on the stored document —
    // `POST /hostels` has no field to accept one at all.
    expect(coordinatorContact(undefined)).toBeNull();
    expect(coordinatorContact({})).toBeNull();
    expect(coordinatorContact({ name: '', phone: 'N/A' })).toBeNull();
    expect(coordinatorContact({ name: 42, phone: ['nope'] })).toBeNull();
  });

  it('falls back to a generic title when only a number was recorded', () => {
    expect(coordinatorContact({ phone: '9876543210' })).toEqual({
      name: 'Block coordinator',
      phone: '9876543210',
    });
  });
});

describe('the directory', () => {
  it('lists a block with its coordinator first and the team after', () => {
    const [group] = hostelDirectory([
      hostel({
        coordinator: { name: 'Dr. Rao', phone: '9876543210' },
        hostel_team: [
          {
            user_id: 'BT1',
            role: 'hostel_volunteer',
            name: 'Meera R',
            phone: '9000000001',
            attendance: true,
          },
        ],
      }),
    ]);

    expect(group.coordinator?.name).toBe('Dr. Rao');
    expect(group.contacts.map((c) => c.name)).toEqual(['Meera R']);
    expect(groupSize(group)).toBe(2);
    expect(group.detail).toBe('male · 300 beds');
  });

  it('does not list the coordinator twice when they are also on the team', () => {
    const [group] = hostelDirectory([
      hostel({
        coordinator: { name: 'Dr. Rao', phone: '+91 98765 43210' },
        hostel_team: [
          {
            user_id: 'BT1',
            role: 'hostel_volunteer',
            name: 'Dr. Rao',
            phone: '+919876543210',
            attendance: true,
          },
        ],
      }),
    ]);
    expect(groupSize(group)).toBe(1);
    expect(group.contacts).toEqual([]);
  });

  it('leaves out a block with nobody reachable rather than showing a dead end', () => {
    expect(hostelDirectory([hostel()])).toEqual([]);
    expect(
      hostelDirectory([
        hostel({ hostel_team: [{ user_id: null, role: 'hostel_volunteer', attendance: false }] }),
      ]),
    ).toEqual([]);
  });

  it('lists mess halls with their dietary detail and no coordinator concept', () => {
    const [group] = messDirectory([
      mess({
        type: 'south_indian__non_veg',
        mess_team: [
          { user_id: 'BT2', role: 'other', name: 'Ravi K', phone: '9000000002', logging: true },
        ],
      }),
    ]);
    expect(group.kind).toBe('mess');
    expect(group.coordinator).toBeNull();
    expect(group.detail).toBe('south indian · non veg');
  });

  it('sorts by name so the list is stable however the API ordered it', () => {
    const groups = hostelDirectory([
      hostel({ hostel_id: 'H2', name: 'Yamuna', coordinator: { name: 'A', phone: '9000000001' } }),
      hostel({ hostel_id: 'H1', name: 'Ganga', coordinator: { name: 'B', phone: '9000000002' } }),
    ]);
    expect(groups.map((g) => g.name)).toEqual(['Ganga', 'Yamuna']);
  });

  it('handles a missing catalogue', () => {
    expect(hostelDirectory(null)).toEqual([]);
    expect(messDirectory(undefined)).toEqual([]);
  });
});

describe('searchDirectory', () => {
  const groups = hostelDirectory([
    hostel({
      hostel_id: 'H1',
      name: 'Ganga Block',
      coordinator: { name: 'Dr. Rao', phone: '9000000001' },
      hostel_team: [
        {
          user_id: 'BT1',
          role: 'hostel_volunteer',
          name: 'Meera R',
          phone: '9000000002',
          attendance: true,
        },
        {
          user_id: 'BT2',
          role: 'hostel_volunteer',
          name: 'Arjun P',
          phone: '9000000003',
          attendance: true,
        },
      ],
    }),
    hostel({
      hostel_id: 'H2',
      name: 'Yamuna Block',
      coordinator: { name: 'Dr. Iyer', phone: '9000000004' },
    }),
  ]);

  it('returns everything for a blank query', () => {
    expect(searchDirectory(groups, '   ')).toHaveLength(2);
  });

  it('matches a place by name or id, keeping all of its contacts', () => {
    const [found] = searchDirectory(groups, 'ganga');
    expect(found.name).toBe('Ganga Block');
    expect(groupSize(found)).toBe(3);
    expect(searchDirectory(groups, 'h2')).toHaveLength(1);
  });

  it('matches a person, and narrows the group to whoever matched', () => {
    // Somebody told to "ask Meera" does not necessarily know which block she is on.
    const [found] = searchDirectory(groups, 'meera');
    expect(found.name).toBe('Ganga Block');
    expect(found.coordinator).toBeNull();
    expect(found.contacts.map((c) => c.name)).toEqual(['Meera R']);
  });

  it('matches a coordinator without dragging in the whole team', () => {
    const [found] = searchDirectory(groups, 'iyer');
    expect(found.coordinator?.name).toBe('Dr. Iyer');
    expect(found.contacts).toEqual([]);
  });

  it('returns nothing when nobody matches', () => {
    expect(searchDirectory(groups, 'zzz')).toEqual([]);
  });
});

describe('ownEmergencyContact', () => {
  it('reads the next-of-kin a participant recorded about themselves', () => {
    const contact = { name: 'Sunita K', relation: 'elder_sibling', phone: '9876543210' };
    expect(ownEmergencyContact(contact as EmergencyContact)).toEqual({
      name: 'Sunita K',
      phone: '9876543210',
      relation: 'elder sibling',
    });
  });

  it('is absent on a fresh sign-in, because no route returns it', () => {
    // It reaches the session only through the PATCH /profile/complete echo.
    expect(ownEmergencyContact(null)).toBeNull();
    expect(ownEmergencyContact(undefined)).toBeNull();
    expect(
      ownEmergencyContact({ name: '', relation: '', phone: 'N/A' } as EmergencyContact),
    ).toBeNull();
  });
});
