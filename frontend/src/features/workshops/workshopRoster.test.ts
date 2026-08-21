import { describe, expect, it } from 'vitest';
import type { WorkshopLogRow, WorkshopParticipationRow } from '@/api/types';
import {
  attendanceCounts,
  buildRoster,
  fromParticipation,
  interestByCohort,
  interestByLevel,
  interestByProgramme,
  mergeDeviceScans,
  mergeParticipation,
  parseParticipantId,
  rosterLists,
  ROSTER_CSV_COLUMNS,
  toRosterCsvRows,
} from './workshopRoster';

/**
 * The workshop desk's numbers are only as good as this derivation: the API gives
 * a flat list of log rows, and every figure, list, and export on that screen is
 * reconstructed from it. These cover the cases that would silently mis-state
 * attendance — an on-spot scan by someone who had also booked, a re-scan, and a
 * volunteer whose only record is their own device.
 */

function log(partial: Partial<WorkshopLogRow>): WorkshopLogRow {
  return {
    workshop_id: 'w1',
    action: 'registration',
    participant_id: 'DS23F3000001',
    timestamp: '2026-06-11T04:00:00',
    ...partial,
  };
}

/** A row of `GET /workshops/{id}/participation`. */
function row(partial: Partial<WorkshopParticipationRow>): WorkshopParticipationRow {
  return {
    participant_id: 'DS23F3000001',
    name: 'Ananya Iyer',
    email: 'ananya@ds.study.iitm.ac.in',
    phone: '+91 90000 00001',
    house: 'wayanad',
    gender: 'female',
    program: 'DS',
    course_stage: 'diploma',
    academic_level: 'Diploma',
    academic_level_number: 2,
    degree: 'BS in Data Science and Applications',
    entry_year: 2023,
    booking_type: 'pre-registered',
    attended: true,
    slot_id: '2026-06-11-morning',
    ...partial,
  };
}

describe('parseParticipantId', () => {
  it('reads the programme and entry year out of a roll-number id', () => {
    expect(parseParticipantId('DS23F3001726')).toEqual({ program: 'DS', entryYear: 2023 });
    expect(parseParticipantId('ms26f1000042')).toEqual({ program: 'MS', entryYear: 2026 });
  });

  it('returns nulls rather than a guess for anything else', () => {
    expect(parseParticipantId('BT1000000003')).toEqual({ program: null, entryYear: null });
    expect(parseParticipantId('')).toEqual({ program: null, entryYear: null });
  });
});

describe('buildRoster', () => {
  it('splits attendees from absentees', () => {
    const roster = buildRoster([
      log({ participant_id: 'DS23F3000001' }),
      log({ participant_id: 'DS22F3000002' }),
      log({
        participant_id: 'DS23F3000001',
        action: 'attendance',
        scan_type: 'pre-registered',
        scanned_by: 'BT1',
        timestamp: '2026-06-11T05:00:00',
      }),
    ]);
    const lists = rosterLists(roster);

    expect(lists.attended.map((e) => e.participantId)).toEqual(['DS23F3000001']);
    expect(lists.absent.map((e) => e.participantId)).toEqual(['DS22F3000002']);
    expect(lists.onSpot).toHaveLength(0);
    expect(lists.attended[0].scannedBy).toBe('BT1');
    expect(lists.attended[0].attendedAt).toBe('2026-06-11T05:00:00');
  });

  it('counts an on-spot scan as on-spot even when the person had booked', () => {
    // The backend does exactly this to the participant document: it pulls the
    // pre-registered entry for the slot and pushes an on-spot one.
    const roster = buildRoster([
      log({ participant_id: 'ES24F1000003' }),
      log({
        participant_id: 'ES24F1000003',
        action: 'attendance',
        scan_type: 'on-spot',
        timestamp: '2026-06-11T05:30:00',
      }),
    ]);
    const lists = rosterLists(roster);

    expect(lists.onSpot.map((e) => e.participantId)).toEqual(['ES24F1000003']);
    expect(lists.attended).toHaveLength(0);
    expect(lists.absent).toHaveLength(0);
  });

  it('keeps the first scan of a re-scanned participant and never duplicates them', () => {
    const roster = buildRoster([
      log({ participant_id: 'DS23F3000001' }),
      log({
        participant_id: 'DS23F3000001',
        action: 'attendance',
        scan_type: 'pre-registered',
        timestamp: '2026-06-11T05:10:00',
      }),
      log({
        participant_id: 'DS23F3000001',
        action: 'attendance',
        scan_type: 'pre-registered',
        timestamp: '2026-06-11T05:40:00',
      }),
    ]);

    expect(roster).toHaveLength(1);
    expect(roster[0].attendedAt).toBe('2026-06-11T05:10:00');
  });
});

describe('mergeDeviceScans', () => {
  it('adds somebody the log never mentioned, as a device-sourced entry', () => {
    const merged = mergeDeviceScans(
      [],
      [
        {
          participantId: 'AE26F2000004',
          scanType: 'on-spot',
          at: '2026-06-11T05:45:00',
          scannedBy: 'BT9',
        },
      ],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      participantId: 'AE26F2000004',
      booking: 'on-spot',
      attended: true,
      source: 'device',
      scannedBy: 'BT9',
    });
  });

  it('marks a booked participant present without duplicating their row', () => {
    const roster = buildRoster([log({ participant_id: 'DS23F3000001' })]);
    const merged = mergeDeviceScans(roster, [
      { participantId: 'DS23F3000001', scanType: 'pre-registered', at: '2026-06-11T05:00:00' },
    ]);
    const lists = rosterLists(merged);

    expect(merged).toHaveLength(1);
    expect(lists.attended).toHaveLength(1);
    expect(lists.absent).toHaveLength(0);
    // The booking row came from the log, so the entry keeps that provenance.
    expect(merged[0].source).toBe('log');
    expect(merged[0].registeredAt).toBe('2026-06-11T04:00:00');
  });
});

describe('attendanceCounts', () => {
  it('reports the workshop record’s own figures, and the on-spot cap', () => {
    const counts = attendanceCounts(
      { capacity: 100, registration_count: 80, participant_count: 55 },
      6,
    );

    expect(counts).toMatchObject({
      registered: 80,
      attended: 55,
      notAttended: 25,
      seatsLeft: 20,
      onSpotAllowance: 10,
      onSpotAdmitted: 6,
      onSpotLeft: 4,
    });
    expect(counts.showRate).toBeCloseTo(68.75);
  });

  it('leaves the on-spot split unknown rather than zero when the log is unreadable', () => {
    const counts = attendanceCounts({ capacity: 30, registration_count: 0, participant_count: 0 });

    expect(counts.onSpotAdmitted).toBeNull();
    expect(counts.onSpotLeft).toBeNull();
    expect(counts.showRate).toBeNull();
    expect(counts.notAttended).toBe(0);
  });

  it('never goes negative when a record disagrees with itself', () => {
    const counts = attendanceCounts({
      capacity: 10,
      registration_count: 4,
      participant_count: 9,
    });

    expect(counts.notAttended).toBe(0);
    expect(counts.seatsLeft).toBe(6);
  });
});

describe('interest breakdowns', () => {
  const roster = buildRoster([
    log({ participant_id: 'DS23F3000001' }),
    log({ participant_id: 'DS23F3000002' }),
    log({ participant_id: 'DS21F3000003' }),
    log({ participant_id: 'ES24F1000004' }),
    log({ participant_id: 'BT1000000003' }),
  ]);

  it('orders cohorts as a scale and reports ids it could not classify', () => {
    const breakdown = interestByCohort(roster);

    expect(breakdown.basis).toBe('cohort');
    expect(breakdown.buckets.map((b) => b.label)).toEqual([
      '2021 entry',
      '2023 entry',
      '2024 entry',
    ]);
    expect(breakdown.buckets.map((b) => b.value)).toEqual([1, 2, 1]);
    expect(breakdown.unknown).toBe(1);
    expect(breakdown.counted).toBe(4);
  });

  it('ranks programmes by size', () => {
    const breakdown = interestByProgramme(roster);

    expect(breakdown.buckets[0]).toMatchObject({ key: 'DS', value: 3 });
    expect(breakdown.buckets[1]).toMatchObject({ key: 'ES', value: 1 });
    expect(breakdown.unknown).toBe(1);
  });
});

describe('fromParticipation', () => {
  it('carries the identity and the academic level the log never could', () => {
    const [entry] = fromParticipation([row({})]);

    expect(entry).toMatchObject({
      participantId: 'DS23F3000001',
      name: 'Ananya Iyer',
      email: 'ananya@ds.study.iitm.ac.in',
      house: 'wayanad',
      courseStage: 'diploma',
      academicLevel: 'Diploma',
      program: 'DS',
      programLabel: 'Data Science',
      entryYear: 2023,
      booking: 'pre-registered',
      attended: true,
      source: 'roster',
    });
  });

  it('treats an unfinished profile as unknown rather than guessing', () => {
    const [entry] = fromParticipation([
      row({
        participant_id: 'ES24F1000004',
        name: null,
        program: null,
        course_stage: null,
        academic_level: null,
        entry_year: null,
      }),
    ]);

    expect(entry.name).toBeNull();
    expect(entry.courseStage).toBeNull();
    // With no `profile.program` stored, the programme falls back to the two
    // letters that open every participant id.
    expect(entry.program).toBe('ES');
    expect(entry.entryYear).toBe(2024);
  });
});

describe('mergeParticipation', () => {
  it('lets the server’s roster win but keeps the log’s timestamps', () => {
    // The log says present; the roster says absent, because somebody corrected it
    // through PATCH .../participants/{id}. The correction is the truth.
    const fromLogs = buildRoster([
      log({ participant_id: 'DS23F3000001' }),
      log({
        participant_id: 'DS23F3000001',
        action: 'attendance',
        scan_type: 'pre-registered',
        scanned_by: 'BT1',
        timestamp: '2026-06-11T05:00:00',
      }),
    ]);
    const merged = mergeParticipation(fromLogs, [row({ attended: false })]);

    expect(merged).toHaveLength(1);
    expect(merged[0].attended).toBe(false);
    expect(merged[0].name).toBe('Ananya Iyer');
    expect(merged[0].source).toBe('roster');
    // Timestamps survive: only the log knows them.
    expect(merged[0].registeredAt).toBe('2026-06-11T04:00:00');
    expect(merged[0].attendedAt).toBe('2026-06-11T05:00:00');
    expect(merged[0].scannedBy).toBe('BT1');
  });

  it('adds a booking the log never recorded', () => {
    const merged = mergeParticipation([], [row({ participant_id: 'MS26F1000005' })]);
    expect(merged.map((e) => e.participantId)).toEqual(['MS26F1000005']);
    expect(merged[0].registeredAt).toBeNull();
  });
});

describe('interestByLevel', () => {
  it('counts the three levels and always shows all of them', () => {
    const breakdown = interestByLevel(
      fromParticipation([
        row({ participant_id: 'DS23F3000001', course_stage: 'diploma' }),
        row({ participant_id: 'DS23F3000002', course_stage: 'diploma' }),
        row({ participant_id: 'DS21F3000003', course_stage: 'degree' }),
      ]),
    );

    expect(breakdown.basis).toBe('level');
    // Ladder order, and Foundation is present at zero rather than missing.
    expect(breakdown.buckets).toEqual([
      { key: 'foundational', label: 'Foundation', value: 0 },
      { key: 'diploma', label: 'Diploma', value: 2 },
      { key: 'degree', label: 'Degree', value: 1 },
    ]);
    expect(breakdown.unknown).toBe(0);
    expect(breakdown.counted).toBe(3);
  });

  it('counts an unfinished profile as unknown, not as a level', () => {
    const breakdown = interestByLevel(
      fromParticipation([
        row({ participant_id: 'DS23F3000001', course_stage: 'foundational' }),
        row({ participant_id: 'ES24F1000004', course_stage: null }),
      ]),
    );

    expect(breakdown.buckets.find((b) => b.key === 'foundational')?.value).toBe(1);
    expect(breakdown.unknown).toBe(1);
    expect(breakdown.counted).toBe(1);
  });

  it('appends a stage the app has never heard of rather than dropping it', () => {
    const breakdown = interestByLevel(
      fromParticipation([row({ participant_id: 'DS23F3000001', course_stage: 'postgraduate' })]),
    );

    expect(breakdown.buckets.at(-1)).toEqual({
      key: 'postgraduate',
      label: 'postgraduate',
      value: 1,
    });
  });

  it('reports nothing countable for a roster with no profiles at all', () => {
    // A log-only roster: the page falls back to the cohort chart on this signal.
    const breakdown = interestByLevel(buildRoster([log({})]));
    expect(breakdown.counted).toBe(0);
    expect(breakdown.unknown).toBe(1);
  });
});

describe('toRosterCsvRows', () => {
  it('exports the identity and level the roster route supplies', () => {
    const merged = mergeParticipation(
      buildRoster([
        log({ participant_id: 'DS23F3000001' }),
        log({
          participant_id: 'DS23F3000001',
          action: 'attendance',
          scan_type: 'pre-registered',
          scanned_by: 'BT1',
          timestamp: '2026-06-11T05:00:00',
        }),
      ]),
      [row({})],
    );
    const [csv] = toRosterCsvRows(merged);

    expect(Object.keys(csv)).toEqual(ROSTER_CSV_COLUMNS);
    expect(csv).toEqual({
      participant_id: 'DS23F3000001',
      name: 'Ananya Iyer',
      email: 'ananya@ds.study.iitm.ac.in',
      phone: '+91 90000 00001',
      house: 'wayanad',
      programme: 'Data Science',
      level: 'Diploma',
      academic_level: 'Diploma',
      entry_year: '2023',
      booking_type: 'pre-registered',
      attended: 'yes',
      registered_at: '2026-06-11T04:00:00',
      attended_at: '2026-06-11T05:00:00',
      scanned_by: 'BT1',
      record_source: 'workshop roster',
    });
  });

  it('leaves unknown fields blank rather than writing a placeholder', () => {
    const [csv] = toRosterCsvRows(buildRoster([log({})]));

    expect(csv.name).toBe('');
    expect(csv.level).toBe('');
    expect(csv.record_source).toBe('workshop log');
  });
});
