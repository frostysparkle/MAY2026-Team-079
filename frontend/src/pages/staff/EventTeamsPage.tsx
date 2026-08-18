import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Users, Wand2 } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { Event, EventParticipationResponse } from '@/api/types';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  ResultBanner,
  SectionHeading,
  Spinner,
  TextInput,
} from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';

/**
 * Team allocation for a team event: auto-allocate everyone into teams, or set a
 * participant's team and role by hand. Themed like the rest of the staff area.
 */
export default function EventTeamsPage() {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<EventParticipationResponse | null>(null);
  const [event, setEvent] = useState<Event | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState<Record<string, { team_id: string; team_role: string }>>({});

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
    // Only for the event's name in the header — never block the page on it.
    api
      .listEvents()
      .then((events) => setEvent(events.find((e) => e.event_id === eventId) ?? null))
      .catch(() => undefined);
  }, [eventId]);

  async function allocate() {
    setInfo(null);
    setBusy(true);
    try {
      const res = await api.allocateEventTeams(eventId);
      setInfo(res.message);
      load();
    } catch (e) {
      setInfo(e instanceof ApiClientError ? e.message : 'Could not allocate teams.');
    } finally {
      setBusy(false);
    }
  }

  async function saveTeam(participantId: string) {
    const edit = edits[participantId];
    if (!edit) return;
    setBusy(true);
    try {
      await api.updateParticipantTeam(eventId, participantId, edit);
      load();
    } catch (e) {
      setInfo(e instanceof ApiClientError ? e.message : 'Could not update team.');
    } finally {
      setBusy(false);
    }
  }

  const back = { label: 'Back', onClick: () => navigate(-1) };

  if (error) {
    return (
      <FestivalScreen title="Teams" back={back}>
        <ErrorState title="Could not load participation" description={error} />
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

  return (
    <FestivalScreen
      title="Teams"
      eyebrow={event?.name ?? 'Event'}
      subtitle={`${data.participants.length} registered`}
      back={back}
      actions={
        <Button loading={busy} onClick={allocate} className="gap-1.5">
          <Wand2 size={14} /> Allocate teams
        </Button>
      }
    >
      {info && <ResultBanner variant="warning" title={info} />}

      <section className="flex flex-col gap-4">
        <SectionHeading title="Participants" meta={`${data.participants.length}`} />

        {data.participants.length === 0 ? (
          <EmptyState
            title="Nobody has registered yet"
            description="Teams can be allocated once participants sign up."
            icon={Users}
          />
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {data.participants.map((p) => {
              const edit = edits[p.participant_id] ?? {
                team_id: p.team_id ?? '',
                team_role: p.team_role ?? '',
              };
              return (
                <li key={p.participant_id}>
                  <Card className="flex flex-col gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink">
                        {p.name || p.participant_id}
                      </p>
                      <p className="truncate text-xs text-muted">{p.email}</p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <TextInput
                        label="Team ID"
                        value={edit.team_id}
                        onChange={(e) =>
                          setEdits((prev) => ({
                            ...prev,
                            [p.participant_id]: { ...edit, team_id: e.target.value },
                          }))
                        }
                      />
                      <TextInput
                        label="Team role"
                        value={edit.team_role}
                        onChange={(e) =>
                          setEdits((prev) => ({
                            ...prev,
                            [p.participant_id]: { ...edit, team_role: e.target.value },
                          }))
                        }
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-fit"
                      onClick={() => saveTeam(p.participant_id)}
                    >
                      Save
                    </Button>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </FestivalScreen>
  );
}
