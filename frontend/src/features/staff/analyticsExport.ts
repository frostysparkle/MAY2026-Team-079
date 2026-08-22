/**
 * CSV export for the Super Admin's analytics views — Journey E.10, "all
 * unfiltered analytics views".
 *
 * The guide asks for an export from every one of them, and only some had one: the
 * event participation list, the audit trail, a single entity's log, and the
 * workshop roster. The four rosters an organiser is most likely to need on a phone
 * at a gate or in a spreadsheet at the end of the day — a hall's allotted
 * participants, a block's, the fest-wide participant record, and the staff
 * directory — had none, so reaching that data meant reading it off the screen.
 *
 * Column lists live here rather than at each call site so the header row of an
 * export cannot drift from the shape being exported, and so a reviewer can see in
 * one place exactly what leaves the app as a file. Every one of these is a Super
 * Admin-only read server-side; this adds no new visibility, only a way to save
 * what is already on screen.
 */
import type {
  BackendTeamMember,
  HostelStatisticsResponse,
  MessStatisticsResponse,
  ParticipantRecord,
} from '@/api/types';
import { downloadCsv, toCsv } from '@/lib/csv';

/** A hall's allotted participants. */
export function exportMessRoster(
  messId: string,
  stat: Pick<MessStatisticsResponse, 'allotted_participants'>,
): void {
  downloadCsv(
    `mess-${messId}-allotted.csv`,
    toCsv(stat.allotted_participants, ['participant_id', 'name', 'email', 'phone']),
  );
}

/** A block's allotted participants, with the room each was given. */
export function exportHostelRoster(
  hostelId: string,
  stat: Pick<HostelStatisticsResponse, 'allotted_participants'>,
): void {
  downloadCsv(
    `hostel-${hostelId}-allotted.csv`,
    toCsv(stat.allotted_participants, ['participant_id', 'name', 'email', 'room']),
  );
}

/**
 * The fest-wide participant record.
 *
 * `ParticipantRecord` nests the profile and the two allocation blocks, and `toCsv`
 * takes flat rows — so it is flattened here, which is also the chance to pick the
 * fields worth having in a spreadsheet rather than dumping the document. Exports
 * whatever the caller currently has on screen, filters included: the guide's
 * "unfiltered" means the view is not *pre*-filtered for this role, not that a
 * search the admin typed should be ignored.
 */
export function exportParticipants(participants: readonly ParticipantRecord[]): void {
  const rows = participants.map((p) => ({
    participant_id: p.participant_id,
    email: p.email,
    name: p.profile?.full_name ?? '',
    house: p.profile?.house ?? '',
    gender: p.profile?.gender ?? '',
    phone: p.profile?.phone ?? '',
    program: p.profile?.program ?? '',
    course_stage: p.profile?.course_stage ?? '',
    mess_preference: p.profile?.mess_preference ?? '',
    mess_id: p.mess?.mess_id ?? '',
    hostel_id: p.accommodation?.hostel_id ?? '',
    room: p.accommodation?.room ?? '',
    accommodation_registered: p.accommodation?.registered === true ? 'yes' : 'no',
    events: p.event_count,
    workshops: p.workshop_count,
  }));

  downloadCsv(
    'participants.csv',
    toCsv(rows, [
      'participant_id',
      'email',
      'name',
      'house',
      'gender',
      'phone',
      'program',
      'course_stage',
      'mess_preference',
      'mess_id',
      'hostel_id',
      'room',
      'accommodation_registered',
      'events',
      'workshops',
    ]),
  );
}

/**
 * The staff directory.
 *
 * `password_hash` is not in `BackendTeamMember` at all — `GET /backend_teams`
 * projects it out server-side — so there is nothing sensitive to omit here beyond
 * being deliberate about the columns. `admin_id` is reduced to a yes/no: the raw
 * value is a Mongo ObjectId that means nothing in a spreadsheet, while *whether*
 * an account is linked to a participant is what decides if the event-team check
 * can see them.
 */
export function exportStaffDirectory(team: readonly BackendTeamMember[]): void {
  const rows = team.map((member) => ({
    paradox_id: member.paradox_id,
    email: member.email,
    role: member.role ?? '',
    department: member.department ?? '',
    designation: member.designation ?? '',
    linked_to_participant: member.admin_id ? 'yes' : 'no',
  }));

  downloadCsv(
    'staff-accounts.csv',
    toCsv(rows, [
      'paradox_id',
      'email',
      'role',
      'department',
      'designation',
      'linked_to_participant',
    ]),
  );
}
