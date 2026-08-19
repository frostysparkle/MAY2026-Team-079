import type { ScheduleRound } from '@/api/types';

/**
 * Public (pre-login) fest schedule, mirrored from the reference site
 * (iitmparadox.org/schedule). Grouped by day; each entry has a time, title,
 * and venue. Static data so the schedule works without a backend.
 */

export interface ScheduleItem {
  time: string;
  title: string;
  venue: string;
}

export interface ScheduleDay {
  /** Display label, e.g. "9 June". */
  date: string;
  /**
   * The same day as ISO `YYYY-MM-DD`.
   *
   * `date` alone carries no year and cannot be sorted or compared, which is why
   * the landing page could only show "9 June – 14 June" with no year while the
   * workshop data said 2026. Anything computed from the schedule should use
   * `iso`; `date` is for display only.
   */
  iso: string;
  items: ScheduleItem[];
}

export const PUBLIC_SCHEDULE: ScheduleDay[] = [
  {
    date: '9 June',
    iso: '2026-06-09',
    items: [
      {
        time: '4:00 PM',
        title: 'The Hoop Hustle 2.0 - Trials',
        venue: 'Basketball Court (Gymkhana)',
      },
      { time: '4:30 PM', title: 'VolleyVibes - Trials', venue: 'Volleyball Court (Gymkhana)' },
      { time: '6:30 PM', title: 'Instructors vs Organizers (Cricket)', venue: 'Sangam Ground' },
      { time: '7:00 PM', title: 'Under the Stars', venue: 'Himalaya Lawn' },
    ],
  },
  {
    date: '10 June',
    iso: '2026-06-10',
    items: [
      {
        time: '6:00 AM',
        title: 'Paradox Champions League - Trials',
        venue: 'Football Ground (Gymkhana)',
      },
      { time: '6:00 AM', title: 'Paradox Premier League 3.0 - Trials', venue: 'Sangam Ground' },
      { time: '6:00 AM', title: 'Sprintsaga - 100m, 400m', venue: 'Manohar C Watsa Stadium' },
      { time: '9:30 AM', title: 'Opening Ceremony', venue: 'SAC' },
      {
        time: '12:00 PM',
        title: 'Paradox Badminton League - Trials',
        venue: 'Sitara Indoor Sports Complex (Gymkhana)',
      },
      {
        time: '12:30 PM',
        title: 'RoboSoccer 5.0 - Initial Rounds',
        venue: 'ICSR Hall 4 (Exhibition Hall)',
      },
      { time: '12:30 PM', title: 'Chronos Crossfire - Round Robin Day 1', venue: 'Chess Hall' },
      { time: '12:30 PM', title: 'Unwind - Vocal', venue: 'HSB355' },
      { time: '1:00 PM', title: 'Python Coding Challenge 5.0 - Round 1', venue: 'NAC 2 - 633' },
      {
        time: '1:00 PM',
        title: 'CrashLab: Collegiate Air Crash Investigation Challenge - Round 1',
        venue: 'NAC 2 - 631',
      },
      {
        time: '1:00 PM',
        title: 'Probably Paradoxical - Round 1 - Problem Statement Release',
        venue: 'NAC 2 - 632',
      },
      { time: '1:00 PM', title: 'Samvaad 2.0 - Interaction Session', venue: 'NAC 2 - 532' },
      { time: '1:00 PM', title: 'IPL Auction Showdown 4.0 - Day 1', venue: 'Bio Tech Hall 108' },
      { time: '1:30 PM', title: 'Capitol Conclave - Debate Rounds', venue: 'NAC 1 - 204, 205' },
      { time: '1:30 PM', title: 'Youth Parliament', venue: 'NAC 2 - 531' },
      { time: '2:00 PM', title: 'Ranneeti 5.0 BGMI - Finals 1', venue: 'NAC 2 - 534' },
      { time: '3:30 PM', title: 'Last1Standing - Task Rush', venue: 'KV Ground' },
      { time: '3:30 PM', title: 'Anubhuti Semi Final', venue: 'HSB334' },
      { time: '3:30 PM', title: 'Dream2Dance 5.0 - Workshop Round', venue: 'UTIL' },
      {
        time: '4:00 PM',
        title: 'The Hoop Hustle 2.0 - Knockout Round',
        venue: 'Basketball Court (Gymkhana)',
      },
      { time: '4:30 PM', title: 'Anime Jeopardy Initial Rounds (2-3)', venue: 'NAC 2 - 531' },
      { time: '4:30 PM', title: 'VolleyVibes - Group Stage', venue: 'Volleyball Court (Gymkhana)' },
      { time: '4:30 PM', title: 'Paradox Premier League 3.0 - Trials', venue: 'Sangam Ground' },
      { time: '5:00 PM', title: 'Sach, Scroll aur Shuturmurg Street Play', venue: 'Outside SAC' },
      { time: '7:00 PM', title: 'Sufi Night', venue: 'SAC' },
    ],
  },
  {
    date: '11 June',
    iso: '2026-06-11',
    items: [
      { time: '5:00 AM', title: 'The Burn Club - Zumba Workshop', venue: 'OAT' },
      { time: '5:00 AM', title: 'Kampus Run', venue: 'Campus' },
      { time: '7:00 AM', title: 'Paradox Premier League 3.0 - Knockouts', venue: 'Sangam Ground' },
      {
        time: '9:00 AM',
        title: 'RoboSoccer 5.0 - Semi-finals and Final Rounds',
        venue: 'ICSR Hall 4 (Exhibition Hall)',
      },
      { time: '9:00 AM', title: 'Squid Games - Treasure Hunt', venue: 'KV Ground' },
      { time: '9:00 AM', title: 'Syngenta Hackathon', venue: 'ICSR Hall 3' },
      { time: '10:00 AM', title: 'Quotopia - Prelims', venue: 'CLT' },
      {
        time: '10:00 AM',
        title: 'Circuit Design Competition 2.0 - First Round (Simulation)',
        venue: 'NAC 2 - 532',
      },
      {
        time: '10:00 AM',
        title: 'CrashLab: Collegiate Air Crash Investigation Challenge - Final Round',
        venue: 'ICSR Hall 2',
      },
      {
        time: '10:00 AM',
        title: 'Probably Paradoxical - Round 1 Invigilation',
        venue: 'NAC 2 - 631',
      },
      {
        time: '10:00 AM',
        title: 'Python Coding Challenge 5.0 - Round 2 & Final Round',
        venue: 'NAC 2 - 534',
      },
      { time: '10:00 AM', title: 'We Found You Online - Round Progression', venue: 'NAC 2 - 632' },
      { time: '10:00 AM', title: 'Deeptech Ventures - Speaker Session', venue: 'TTJ' },
      { time: '10:00 AM', title: 'Chronos Crossfire - Round Robin Day 2', venue: 'Chess Hall' },
      {
        time: '10:00 AM',
        title: 'Paradox Badminton League - Group Stage',
        venue: 'Sitara Indoor Sports Complex (Gymkhana)',
      },
      {
        time: '10:00 AM',
        title: 'Research: To Infinity & Beyond - Finals',
        venue: 'Bio Tech Hall 108 & 110',
      },
      { time: '10:30 AM', title: 'Escape Room - Semi Finals', venue: 'HSB 352' },
      { time: '11:00 AM', title: 'IPL Auction Showdown 4.0 - Day 2 (Final)', venue: 'NAC 2 - 633' },
      { time: '11:30 AM', title: 'Unwind - Instrumental', venue: 'Music Room' },
      { time: '11:30 AM', title: 'Rants and Riffs (All Rounds)', venue: 'HSB334' },
      {
        time: '12:00 PM',
        title: 'Ranneeti 5.0 Pocket Arcade - Precision Pulse (Angry Birds)',
        venue: 'NAC 1 - 204, 205',
      },
      { time: '12:00 PM', title: 'Sach, Scroll aur Shuturmurg Stage Play', venue: 'CLT' },
      {
        time: '2:00 PM',
        title: 'Research: To Infinity & Beyond - Guest Session',
        venue: 'ICSR Hall 1',
      },
      { time: '2:00 PM', title: 'Ranneeti 5.0 Valorant - Bracket Stage', venue: 'HSB 352' },
      { time: '2:00 PM', title: 'Manch of Traders', venue: 'TTJ' },
      { time: '2:30 PM', title: 'Stand Up Comedy Showdown', venue: 'CLT' },
      { time: '2:30 PM', title: 'Anime Jeopardy Final Rounds (4-5)', venue: 'NAC 2 - 531' },
      { time: '3:00 PM', title: 'Sprintsaga - Shot Put, Discus Throw', venue: 'KV Ground' },
      { time: '3:00 PM', title: 'Squid Games - Game Rounds', venue: 'KV Ground' },
      { time: '3:00 PM', title: 'Paradox Premier League 3.0 - Knockouts', venue: 'Sangam Ground' },
      {
        time: '3:30 PM',
        title: "The Hoop Hustle 2.0 - Men's Quarter & Semi Final, Women's Finals",
        venue: 'Basketball Court (Gymkhana)',
      },
      {
        time: '3:30 PM',
        title: 'Paradox Champions League - Group Stage',
        venue: 'Football Ground (Gymkhana)',
      },
      {
        time: '5:00 PM',
        title: "VolleyVibes - Men's Semi Finals",
        venue: 'Volleyball Court (Gymkhana)',
      },
      { time: '7:00 PM', title: 'DJ Night', venue: 'OAT' },
    ],
  },
  {
    date: '12 June',
    iso: '2026-06-12',
    items: [
      { time: '6:00 AM', title: 'Sprintsaga - Relays', venue: 'Manohar C Watsa Stadium' },
      {
        time: '6:30 AM',
        title: 'Paradox Premier League 3.0 - Super Knockouts',
        venue: 'Sangam Ground',
      },
      {
        time: '7:00 AM',
        title: 'Paradox Champions League - Semi-Finals',
        venue: 'Football Ground (Gymkhana)',
      },
      { time: '8:00 AM', title: 'Last1Standing - Dual Challenge', venue: 'KV Ground' },
      {
        time: '9:00 AM',
        title: 'Compassion-A-Thon 3.0 - Final Presentation Round',
        venue: 'ICSR Hall 2',
      },
      {
        time: '9:00 AM',
        title: 'RoboSoccer 5.0 - Final Round (ext) + Free Play',
        venue: 'ICSR Hall 4 (Exhibition Hall)',
      },
      { time: '10:00 AM', title: 'Escape Room - Finals', venue: 'SAC Lobby' },
      { time: '10:00 AM', title: 'Chronos Crossfire - Finals', venue: 'Chess Hall' },
      {
        time: '10:00 AM',
        title: 'Paradox Badminton League - Semi-Finals',
        venue: 'Sitara Indoor Sports Complex (Gymkhana)',
      },
      { time: '10:00 AM', title: 'Interaction Session with Professors', venue: 'CLT' },
      { time: '10:00 AM', title: 'GoBoxD Systems and Security Hackathon', venue: 'NAC 2 - 534' },
      { time: '11:00 AM', title: 'Last1Standing - Steal or No Steal', venue: 'HSB352' },
      { time: '12:30 PM', title: 'DSA Triathlon 3.0 - Initial Round', venue: 'NAC 2 - 531' },
      {
        time: '12:30 PM',
        title: 'Circuit Design Competition 2.0 - Final Round (Hardware Demo)',
        venue: 'New IE Lab',
      },
      {
        time: '12:30 PM',
        title: 'Echo//Prometheus - Investigation Rounds',
        venue: 'NAC 2 - 633 & Campus',
      },
      { time: '12:30 PM', title: 'Probably Paradoxical - Final Round', venue: 'NAC 2 - 631' },
      { time: '12:30 PM', title: 'We Found You Online - Round Progression', venue: 'NAC 2 - 632' },
      { time: '12:30 PM', title: 'Final Lap: Formula Racing - Round Progression', venue: 'UTIL' },
      { time: '12:30 PM', title: 'Capitol Conclave - Finale', venue: 'NAC 1 - 204' },
      { time: '12:30 PM', title: 'Youth Parliament - Finale', venue: 'NAC 1 - 205' },
      { time: '12:30 PM', title: 'Anubhuti - Finale', venue: 'HSB334' },
      { time: '12:30 PM', title: 'GadgetXpo 2.0 - Finals', venue: 'Bio Tech Hall 108' },
      { time: '12:30 PM', title: 'RopeWalker - Round Progression', venue: 'UTIL' },
      {
        time: '1:00 PM',
        title: 'Ranneeti 5.0 Pocket Arcade - Agility Ascension (Subway Surfers)',
        venue: 'HSB352',
      },
      {
        time: '1:30 PM',
        title: 'Paradox Badminton League - Finals',
        venue: 'Sitara Indoor Sports Complex (Gymkhana)',
      },
      { time: '3:00 PM', title: 'Quotopia - Finale', venue: 'NAC 1 - 204' },
      { time: '3:00 PM', title: 'Pictionary Art Relay', venue: 'NAC 1 - 205' },
      { time: '4:00 PM', title: 'Ranneeti 5.0 Valorant - Semi-Finals', venue: 'HSB352' },
      {
        time: '4:30 PM',
        title: 'Paradox Champions League - Finals',
        venue: 'Football Ground (Gymkhana)',
      },
      { time: '4:30 PM', title: 'Dream2Dance 5.0 - Street Dance Battle', venue: 'Himalaya Lawn' },
      {
        time: '5:00 PM',
        title: "The Hoop Hustle 2.0 - Men's Finals",
        venue: 'Basketball Court (Gymkhana)',
      },
      {
        time: '5:00 PM',
        title: 'Paradox Premier League 3.0 - Eliminators',
        venue: 'Sangam Ground',
      },
      {
        time: '5:00 PM',
        title: "VolleyVibes - Women's Matches & Men's Finals",
        venue: 'Volleyball Court (Gymkhana)',
      },
      { time: '6:00 PM', title: 'Unwind - Finale', venue: 'OAT' },
    ],
  },
  {
    date: '13 June',
    iso: '2026-06-13',
    items: [
      {
        time: '8:00 AM',
        title: 'Paradox Premier League 3.0 - Eliminators',
        venue: 'Sangam Ground',
      },
      { time: '10:00 AM', title: 'Echo//Prometheus - Finals', venue: 'NAC 2 - 633' },
      { time: '10:00 AM', title: 'Last1Standing - Points Championship', venue: 'NAC 1 - 204' },
      { time: '10:30 AM', title: 'Paradox Premier League 3.0 - Finals', venue: 'Sangam Ground' },
      { time: '11:00 AM', title: 'Paradox Got Talent - Finale', venue: 'CLT' },
      { time: '11:00 AM', title: 'Mr & Mrs Paradox', venue: 'SAC' },
      { time: '11:30 AM', title: 'Shutter Safari', venue: 'HSB334' },
      {
        time: '12:00 PM',
        title: 'Robo Dominion (Pilot Event)',
        venue: 'ICSR Hall 4 (Exhibition Hall)',
      },
      {
        time: '12:00 PM',
        title: 'Hustlepreneurs By Escape Room',
        venue: 'ICSR Hall 3 (A.M.M Arunachalam)',
      },
      { time: '1:00 PM', title: 'DSA Triathlon 3.0 - Final Round', venue: 'ICSR Hall 2' },
      {
        time: '1:00 PM',
        title: 'Ranneeti 5.0 Pocket Arcade - Skill Saga (Hill Climb Racing)',
        venue: 'NAC 1 - 204',
      },
      { time: '2:30 PM', title: 'Dream2Dance 5.0 - Finale Round', venue: 'SAC' },
      { time: '3:00 PM', title: 'Ranneeti 5.0 Valorant - Finals', venue: 'NAC 1 - 204' },
      { time: '6:00 PM', title: 'Movie Premiere', venue: 'CLT' },
      { time: '7:00 PM', title: 'Rapadox', venue: 'Himalaya Lawn' },
    ],
  },
  {
    date: '14 June',
    iso: '2026-06-14',
    items: [
      { time: '2:00 PM', title: 'Closing Ceremony', venue: 'SAC' },
      { time: '2:00 PM', title: 'Chromatix - Showcase', venue: 'SAC' },
    ],
  },
];

/* ------------------------------------------------------ festival dates --- */

/**
 * The festival's own days, in ISO order, derived from the schedule above so the
 * two can never disagree.
 *
 * Every workshop date now falls inside this span. One (`w03`) used to sit on
 * 2026-06-08, a day before the schedule starts; that was an OCR misread of the
 * flyer, which prints 13 June, and it has been corrected. Nothing here overrides
 * workshop dates, and the workshop day filter is derived from the data, so a
 * future out-of-span date would again surface rather than hide.
 */
export const FESTIVAL_DAYS: readonly string[] = PUBLIC_SCHEDULE.map((day) => day.iso)
  .slice()
  .sort();

/**
 * Public-facing date span, e.g. `9 – 14 June 2026`.
 *
 * Formatted from the ISO days rather than the display labels, so the year is
 * always present. The landing page previously rendered "9 June – 14 June" with no
 * year at all, because the schedule only carried day-and-month strings.
 */
export function festivalDateRange(): string | null {
  if (FESTIVAL_DAYS.length === 0) return null;

  const first = new Date(`${FESTIVAL_DAYS[0]}T00:00:00`);
  const last = new Date(`${FESTIVAL_DAYS[FESTIVAL_DAYS.length - 1]}T00:00:00`);
  const monthYear = last.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  if (FESTIVAL_DAYS.length === 1) return `${first.getDate()} ${monthYear}`;

  // Same month is the normal case: "9 – 14 June 2026".
  if (first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear()) {
    return `${first.getDate()} – ${last.getDate()} ${monthYear}`;
  }
  const firstMonth = first.toLocaleDateString('en-IN', { month: 'long' });
  return `${first.getDate()} ${firstMonth} – ${last.getDate()} ${monthYear}`;
}

/**
 * Build the day-grouped schedule from the published programme.
 *
 * Every event carries its own `schedule` rounds, so "the schedule" is the
 * flattening of all of them — the same idea as `features/schedule/festSchedule`,
 * but shaped as `ScheduleDay[]` so the public page can render either this or the
 * static `PUBLIC_SCHEDULE` without knowing which it got.
 *
 * Rounds with no parseable `start_time` are skipped rather than bucketed under a
 * fake date: a round whose time nobody recorded should be absent from a timetable,
 * not shown at midnight on the wrong day.
 */
export function buildScheduleDays(
  events: { name: string; schedule?: ScheduleRound[] | null }[],
): ScheduleDay[] {
  const byDay = new Map<string, (ScheduleItem & { at: Date })[]>();

  for (const event of events) {
    for (const round of event.schedule ?? []) {
      const raw = (round.start_time ?? '').trim();
      if (!raw) continue;
      const at = new Date(raw);
      if (Number.isNaN(at.getTime())) continue;

      const iso = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(
        at.getDate(),
      ).padStart(2, '0')}`;

      const list = byDay.get(iso) ?? [];
      list.push({
        at,
        time: at
          .toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
          .toUpperCase(),
        // Matches how the static dataset reads: the event, then which round of it.
        title: round.name ? `${event.name} - ${round.name}` : event.name,
        venue: round.venue?.trim() || 'Venue to be announced',
      });
      byDay.set(iso, list);
    }
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([iso, items]) => ({
      iso,
      date: new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
      }),
      items: items
        .sort((x, y) => x.at.getTime() - y.at.getTime())
        .map(({ at: _at, ...item }) => item),
    }));
}
