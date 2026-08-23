import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Crown, Phone, ShieldAlert, Users, Wand2 } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import { reportApiError } from '@/api/report';
import type { Event, EventParticipant, EventParticipationResponse } from '@/api/types';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  ResultBanner,
  SectionHeading,
  Select,
  Spinner,
  StatusBadge,
  TextInput,
} from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import { currentStaff } from '@/stores/authStore';
import {
  eventHeads,
  eventTeamRoleLabel,
  eventTeamRoleOf,
  isEventHead,
  isReachablePhone,
  readAllocationOutcome,
  type AllocationOutcome,
} from '@/features/events/eventTeam';
import {
  existingTeamIds,
  groupParticipantsByTeam,
  teamRoleOptions,
  teamSizeWarning,
} from '@/features/events/participantTeams';

/**
 * Team allocation for a team event: auto-allocate solo entries into teams, or
 * move somebody by hand.
 *
 * **Both writes are Event Head-only.** `POST /events/{id}/allocate_teams` and
 * `PUT /events/{id}/participant_teams/{pid}` each check for `role ===
 * "event_head"` on this event's `event_team` and refuse everybody else — a Super
 * Admin included. So this screen reads the team first and renders read-only for
 * anybody who is not the head, rather than offering buttons that are certain to
 * 403. The roster stays visible either way, because a Super Admin or Domain Admin
 * looking at team composition is a legitimate thing to be doing; only the
 * controls go away.
 *
 * Participants are grouped by team rather than listed flat, since the question
 * being asked here is "is this team full, and who is still loose?" — see
 * `features/events/participantTeams.ts`.
 */

/** A pending edit for one participant, before it is saved. */
interface TeamEdit {
  team_id: string;
  team_role: string;
}

const NEW_TEAM = '__new__';

export default function EventTeamsPage() {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();
  const staff = currentStaff();

  const [data, setData] = useState<EventParticipationResponse | null>(null);
  const [event, setEvent] = useState<Event | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** A failed write. Red, and never mixed with the two below. */
  const [actionError, setActionError] = useState<string | null>(null);
  /** A write that landed. Green. */
  const [success, setSuccess] = useState<string | null>(null);
  /** A 200 that changed nothing, e.g. "Not a team event". Amber. */
  const [notice, setNotice] = useState<AllocationOutcome | null>(null);

  const [busy, setBusy] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, TeamEdit>>({});
  /** Participants whose team picker is on "New team…". */
  const [newTeamFor, setNewTeamFor] = useState<Record<string, boolean>>({});

  function load() {
    api
      .eventParticipation(eventId)
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((e) =>
        setError(e instanceof ApiClientError ? e.message : 'Could not load participation.'),
      );
  }
  useEffect(load, [eventId]);

  useEffect(() => {
    // For the event's name, its team rule, and — when participation omits it —
    // the team roster. Never block the page on it.
    api
      .listEvents()
      .then((events) => setEvent(events.find((e) => e.event_id === eventId) ?? null))
      .catch(() => undefined);
  }, [eventId]);

  /**
   * Whether this account may write.
   *
   * `participation.event_team` is the enriched list and is preferred; the record
   * off `GET /events` is the fallback for the window before it arrives. Both
   * carry `user_id` and `role`, which is all the check needs.
   */
  const team = data?.event_team ?? event?.event_team;
  const mayManage = isEventHead(team, staff?.id);
  const myRole = eventTeamRoleOf(team, staff?.id);
  const heads = eventHeads(data?.event_team ?? []);

  const groups = useMemo(() => (data ? groupParticipantsByTeam(data.participants) : []), [data]);
  const teamIds = useMemo(() => (data ? existingTeamIds(data.participants) : []), [data]);

  /** Clears all three banners. Every write starts from a clean slate. */
  function resetBanners() {
    setActionError(null);
    setSuccess(null);
    setNotice(null);
  }

  async function allocate() {
    resetBanners();
    setBusy(true);
    try {
      const res = await api.allocateEventTeams(eventId);
      // The route answers 200 for "it worked", "nothing to do", and "nothing
      // formed" alike, distinguished only by prose — so read the message rather
      // than assuming success.
      const outcome = readAllocationOutcome(res.message);
      if (outcome.tone === 'success') setSuccess(outcome.title);
      else setNotice(outcome);
      load();
    } catch (e) {
      setActionError(reportApiError(e, 'Could not allocate teams. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveTeam(participant: EventParticipant) {
    const edit = edits[participant.participant_id];
    if (!edit) return;
    resetBanners();
    setSavingId(participant.participant_id);
    try {
      await api.updateParticipantTeam(eventId, participant.participant_id, {
        team_id: edit.team_id.trim(),
        team_role: edit.team_role.trim(),
      });
      setSuccess(
        edit.team_id.trim()
          ? `${participant.name || participant.participant_id} moved to ${edit.team_id.trim()}`
          : `${participant.name || participant.participant_id} is now unassigned`,
      );
      // Drop the pending edit so the row goes back to reflecting the server.
      setEdits((prev) => {
        const next = { ...prev };
        delete next[participant.participant_id];
        return next;
      });
      setNewTeamFor((prev) => ({ ...prev, [participant.participant_id]: false }));
      load();
    } catch (e) {
      setActionError(reportApiError(e, 'Could not update this participant’s team.'));
    } finally {
      setSavingId(null);
    }
  }

  const back = { label: 'Back', onClick: () => navigate(-1) };

  if (error) {
    return (
      <FestivalScreen title="Teams" back={back}>
        <ErrorState title="Could not load participation" description={error} onRetry={load} />
      </FestivalScreen>
    );
  }

  if (!data) {
    return (
      <FestivalScreen title="Teams" back={back}>
        <div className="flex h-64 items-center justify-center">
          <Spinner label="Loading" />
        </div>
      </FestivalScreen>
    );
  }

  const rule = event?.team;
  const isTeamEvent = (rule?.max ?? 1) > 1;

  return (
    <FestivalScreen
      title="Teams"
      eyebrow={event?.name ?? 'Event'}
      subtitle={teamSubtitle(data.participants.length, groups.length, isTeamEvent)}
      back={back}
      actions={
        mayManage && (
          <Button
            loading={busy}
            disabled={busy || savingId !== null}
            onClick={allocate}
            className="gap-1.5"
          >
            <Wand2 size={14} /> Allocate teams
          </Button>
        )
      }
    >
      {/* Three separate channels. These used to be one amber banner, which meant
          a successful allocation looked like a problem and a 403 looked like a
          note. */}
      {actionError && (
        <ResultBanner variant="error" title="Action failed">
          {actionError}
        </ResultBanner>
      )}
      {success && <ResultBanner variant="success" title={success} />}
      {notice && (
        <ResultBanner variant="warning" title={notice.title}>
          {notice.description}
        </ResultBanner>
      )}

      {!mayManage && <ReadOnlyNotice myRole={myRole} heads={heads} />}

      {mayManage && !isTeamEvent && (
        <ResultBanner variant="warning" title="This is an individual event">
          Its maximum team size is {rule?.max ?? 1}, so allocation has nothing to group. Raise the
          team size on the event itself to use it.
        </ResultBanner>
      )}

      {isTeamEvent && rule && (
        <p className="text-sm text-muted">
          Teams of {rule.min === rule.max ? rule.max : `${rule.min}–${rule.max}`}
          {rule.house_vs_house_event ? ', grouped within a house' : ', mixed across houses'}.
          Allocation only groups entries that have no team yet — it never breaks up a team that
          already exists.
        </p>
      )}

      {data.participants.length === 0 ? (
        <EmptyState
          title="Nobody has registered yet"
          description="Teams can be allocated once participants sign up."
          icon={Users}
        />
      ) : (
        groups.map((group) => {
          const warning =
            group.teamId === null ? null : teamSizeWarning(group.members.length, rule);
          return (
            <section key={group.teamId ?? '__unassigned__'} className="flex flex-col gap-3">
              <SectionHeading
                title={group.teamId ?? 'Not on a team yet'}
                meta={`${group.members.length} ${group.members.length === 1 ? 'person' : 'people'}`}
              />
              {warning && (
                <p className="text-xs font-semibold text-warning">
                  Outside the event’s team rule — {warning}.
                </p>
              )}
              <ul className="grid gap-3 lg:grid-cols-2">
                {group.members.map((participant) => (
                  <li key={participant.participant_id}>
                    <ParticipantTeamCard
                      participant={participant}
                      mayManage={mayManage}
                      teamIds={teamIds}
                      edit={edits[participant.participant_id]}
                      isNewTeam={newTeamFor[participant.participant_id] ?? false}
                      saving={savingId === participant.participant_id}
                      disabled={busy}
                      onEdit={(changes) =>
                        setEdits((prev) => ({
                          ...prev,
                          [participant.participant_id]: {
                            ...currentEdit(prev, participant),
                            ...changes,
                          },
                        }))
                      }
                      onNewTeam={(on) => {
                        setNewTeamFor((prev) => ({ ...prev, [participant.participant_id]: on }));
                        setEdits((prev) => ({
                          ...prev,
                          [participant.participant_id]: {
                            ...currentEdit(prev, participant),
                            team_id: on ? '' : (participant.team_id ?? ''),
                          },
                        }));
                      }}
                      onSave={() => void saveTeam(participant)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </FestivalScreen>
  );
}

/* --------------------------------------------------------------- helpers --- */

/** The pending edit for a participant, or one seeded from what the server holds. */
function currentEdit(edits: Record<string, TeamEdit>, participant: EventParticipant): TeamEdit {
  return (
    edits[participant.participant_id] ?? {
      team_id: participant.team_id ?? '',
      team_role: participant.team_role ?? 'member',
    }
  );
}

function teamSubtitle(registered: number, groupCount: number, isTeamEvent: boolean): string {
  const people = `${registered} registered`;
  if (!isTeamEvent) return `${people} · individual entries`;
  return `${people} · ${groupCount} group${groupCount === 1 ? '' : 's'}`;
}

/**
 * Why the controls are missing, and who to ask instead.
 *
 * Doubles as the contact card for this event's leadership: `event_team` off the
 * participation route carries a name and phone per member, which is the only
 * place in the app they are readable.
 */
function ReadOnlyNotice({
  myRole,
  heads,
}: {
  myRole: string | undefined;
  heads: { user_id: string; role: string; name: string; phone: string }[];
}) {
  return (
    <ResultBanner variant="warning" title="Only this event’s Event Head can change teams">
      <div className="flex flex-col gap-2">
        <p>
          {myRole
            ? `You are on this event's team as ${eventTeamRoleLabel(myRole)}, which can see the roster but not allocate or move anybody.`
            : 'Allocation and participant-team edits are restricted to the Event Head named on this event — a Super Admin cannot run them either.'}
        </p>
        {heads.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {heads.map((head) => (
              <li key={head.user_id} className="flex flex-wrap items-center gap-2 text-sm">
                <Crown size={13} strokeWidth={2.25} className="shrink-0" />
                <span className="font-semibold">{head.name || head.user_id}</span>
                {isReachablePhone(head.phone) && (
                  <a
                    href={`tel:${head.phone}`}
                    className="inline-flex items-center gap-1 font-medium underline"
                  >
                    <Phone size={12} strokeWidth={2.25} />
                    {head.phone}
                  </a>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-1.5 font-semibold">
            <ShieldAlert size={14} strokeWidth={2.25} />
            No Event Head is assigned, so nobody can allocate teams yet. A Super Admin can appoint
            one from the event’s editor.
          </p>
        )}
      </div>
    </ResultBanner>
  );
}

/** One registrant: who they are, and — for the head — where to move them. */
function ParticipantTeamCard({
  participant,
  mayManage,
  teamIds,
  edit,
  isNewTeam,
  saving,
  disabled,
  onEdit,
  onNewTeam,
  onSave,
}: {
  participant: EventParticipant;
  mayManage: boolean;
  teamIds: string[];
  edit: TeamEdit | undefined;
  isNewTeam: boolean;
  saving: boolean;
  disabled: boolean;
  onEdit: (changes: Partial<TeamEdit>) => void;
  onNewTeam: (on: boolean) => void;
  onSave: () => void;
}) {
  const value = edit ?? {
    team_id: participant.team_id ?? '',
    team_role: participant.team_role ?? 'member',
  };
  const dirty =
    edit !== undefined &&
    (value.team_id !== (participant.team_id ?? '') ||
      value.team_role !== (participant.team_role ?? 'member'));

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-ink">
            {participant.name || participant.participant_id}
          </p>
          <p className="truncate text-xs text-muted">
            {[participant.email, participant.phone].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {participant.house && <StatusBadge tone="neutral">{participant.house}</StatusBadge>}
          {participant.team_role === 'leader' && <StatusBadge tone="info">Leader</StatusBadge>}
        </div>
      </div>

      {mayManage && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {/* A picker over the teams that exist, not a free-text box: the old
                one silently created a new team on a typo, and there was no way to
                see which ids were real. */}
            {isNewTeam ? (
              <TextInput
                label="New team ID"
                autoFocus
                value={value.team_id}
                onChange={(e) => onEdit({ team_id: e.target.value })}
                placeholder="e.g. TE_MX_0001"
                hint="Anything not already in use."
              />
            ) : (
              <Select
                label="Team"
                value={value.team_id}
                onChange={(e) => {
                  if (e.target.value === NEW_TEAM) onNewTeam(true);
                  else onEdit({ team_id: e.target.value });
                }}
                options={[
                  { value: '', label: 'No team' },
                  ...teamIds.map((id) => ({ value: id, label: id })),
                  { value: NEW_TEAM, label: 'New team…' },
                ]}
              />
            )}
            <Select
              label="Role in team"
              value={value.team_role}
              onChange={(e) => onEdit({ team_role: e.target.value })}
              options={teamRoleOptions(participant.team_role).map((role) => ({
                value: role,
                label: role[0].toUpperCase() + role.slice(1),
              }))}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              className="w-fit"
              loading={saving}
              // Nothing to save until something actually changed — the old page
              // let you POST the values already on screen.
              disabled={!dirty || saving || disabled}
              onClick={onSave}
            >
              Save
            </Button>
            {isNewTeam && (
              <Button
                size="sm"
                variant="ghost"
                className="w-fit"
                disabled={saving}
                onClick={() => onNewTeam(false)}
              >
                Cancel
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
