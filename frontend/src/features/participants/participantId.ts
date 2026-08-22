/**
 * What a `participant_id` tells you about the person holding it.
 *
 * The id is `generate_participant_id`'s output — the programme letters from the
 * institute email followed by the uppercased roll number, which the student
 * dataset guarantees to be `YYF<term><six digits>`. That makes it the one piece of
 * profile information every roster in the API carries, whatever else it projects
 * away, and it is therefore the only thing a caller who cannot read
 * `GET /participants` can still learn about a registrant.
 *
 * This lives here, rather than in the workshop module where it started, because
 * both the workshop roster and the event roster read it and neither owns it. The
 * workshop module re-exports it so its own call sites and tests keep working.
 *
 * Note what is deliberately *not* derivable: the academic level (Foundation /
 * Diploma / Degree). It lives in `profile.course_stage`, and the only endpoints
 * that return it are `GET /workshops/{id}/participation` and the Super Admin-only
 * `GET /participants` — the event participation route does not carry it. Entry year
 * is the closest real signal the id holds, and it is a cohort, not a level. Every
 * screen that shows it must say so.
 */

/** The four BS programmes, keyed by the prefix `participant_id` carries. */
export const PROGRAM_LABEL: Record<string, string> = {
  DS: 'Data Science',
  ES: 'Electronic Systems',
  MS: 'Management & Data Science',
  AE: 'Aeronautics & Space Tech',
};

/**
 * `DS23F3001726` → programme `DS`, entry year 2023.
 *
 * An id that does not match — a staff account, or a participant who registered
 * with a non-IITM address — yields nulls rather than a guess.
 */
export function parseParticipantId(participantId: string): {
  program: string | null;
  entryYear: number | null;
} {
  const match = /^([A-Z]{2})(\d{2})[A-Z]\d{7}$/.exec(participantId.trim().toUpperCase());
  if (!match) return { program: null, entryYear: null };
  const program = match[1];
  const year = Number.parseInt(match[2], 10);
  return {
    program: program in PROGRAM_LABEL ? program : null,
    // Two-digit years in this dataset are all 20xx: the earliest programme
    // opened in 2020 and the fest runs in 2026.
    entryYear: Number.isFinite(year) ? 2000 + year : null,
  };
}

/** `DS23F3001726` → `Data Science`, or `null` when the id does not parse. */
export function programmeLabelOf(participantId: string): string | null {
  const { program } = parseParticipantId(participantId);
  return program ? (PROGRAM_LABEL[program] ?? program) : null;
}
