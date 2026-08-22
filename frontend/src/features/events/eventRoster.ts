/**
 * Who registered for an event, as much as the API will say about them.
 *
 * `GET /events/{event_id}/participation` is an Event Head's only roster — the
 * fest-wide `GET /participants`, which carries the full profile, is Super Admin
 * only. So this module takes the seven fields that route returns and adds the two
 * more the `participant_id` itself encodes: the student's programme and their entry
 * cohort (`features/participants/participantId`). That is the whole of what is
 * knowable here, and the honest limit of it is worth stating plainly:
 *
 *  - **House** is real, from `profile.house`.
 *  - **Programme** is derived from the roll number, and matches `profile.program`.
 *  - **Cohort** is the entry year in the roll number. It is *not* the academic
 *    level: a 2023-entry student may be on Foundation, Diploma or Degree.
 *    `profile.course_stage` is the field that answers level, and no endpoint an
 *    Event Head can call returns it for an event's registrants — the workshops
 *    equivalent (`GET /workshops/{id}/participation`) does, the events one does
 *    not. Every label this module produces says "cohort", never "level".
 *
 * The breakdowns exist because a roster of two hundred cards answers "who is
 * coming" and not "what kind of entry does my event attract", which is the
 * question an organiser plans rounds and prizes around.
 */
import type { EventParticipant } from '@/api/types';
import { parseParticipantId, PROGRAM_LABEL } from '@/features/participants/participantId';

export interface EventRegistrant {
  participantId: string;
  name: string | null;
  email: string;
  phone: string | null;
  house: string | null;
  teamId: string | null;
  teamRole: string | null;
  /** `DS`, when the id parses. */
  program: string | null;
  /** `Data Science`, when the id parses. */
  programme: string | null;
  /** `2023` — an entry cohort, not an academic level. */
  entryYear: number | null;
}

/** Alphabetical by name, unnamed accounts last under their id. */
export function eventRegistrants(participants: readonly EventParticipant[]): EventRegistrant[] {
  return participants
    .map((p): EventRegistrant => {
      const { program, entryYear } = parseParticipantId(p.participant_id);
      return {
        participantId: p.participant_id,
        name: p.name,
        email: p.email,
        phone: p.phone,
        house: p.house,
        teamId: p.team_id,
        teamRole: p.team_role,
        program,
        programme: program ? (PROGRAM_LABEL[program] ?? program) : null,
        entryYear,
      };
    })
    .sort((a, b) =>
      (a.name || `zz${a.participantId}`).localeCompare(b.name || `zz${b.participantId}`),
    );
}

/* ------------------------------------------------------------ breakdowns --- */

export interface RegistrantBucket {
  key: string;
  label: string;
  value: number;
}

/** The label for everyone a breakdown could not place. Always sorted last. */
export const UNKNOWN_BUCKET = 'Unknown';

function rank(rows: readonly EventRegistrant[], read: (row: EventRegistrant) => string | null) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = read(row) || UNKNOWN_BUCKET;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, value]) => ({ key, label: key, value }))
    .sort((a, b) => {
      // "Unknown" is an absence, not the smallest category, so it never takes the
      // top of a ranked chart even when it is the largest group.
      if (a.key === UNKNOWN_BUCKET) return 1;
      if (b.key === UNKNOWN_BUCKET) return -1;
      return b.value - a.value || a.label.localeCompare(b.label);
    });
}

/** Registrants per house, biggest first. */
export function registrantsByHouse(rows: readonly EventRegistrant[]): RegistrantBucket[] {
  return rank(rows, (row) => row.house);
}

/** Registrants per BS programme, biggest first. */
export function registrantsByProgramme(rows: readonly EventRegistrant[]): RegistrantBucket[] {
  return rank(rows, (row) => row.programme);
}

/** Registrants per entry cohort, oldest first — a year axis reads as a scale. */
export function registrantsByCohort(rows: readonly EventRegistrant[]): RegistrantBucket[] {
  return rank(rows, (row) => (row.entryYear === null ? null : String(row.entryYear))).sort(
    (a, b) => {
      if (a.key === UNKNOWN_BUCKET) return 1;
      if (b.key === UNKNOWN_BUCKET) return -1;
      return Number(a.key) - Number(b.key);
    },
  );
}

export interface TeamSplit {
  /** Registrants who hold a `team_id`. */
  teamed: number;
  /** Registered alone, and what `POST /allocate_teams` would group. */
  solo: number;
  /** Distinct teams formed so far. */
  teams: number;
}

export function teamSplit(rows: readonly EventRegistrant[]): TeamSplit {
  const teams = new Set<string>();
  let teamed = 0;
  for (const row of rows) {
    if (!row.teamId) continue;
    teamed += 1;
    teams.add(row.teamId);
  }
  return { teamed, solo: rows.length - teamed, teams: teams.size };
}
