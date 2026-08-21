import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiClientError } from '@/api';
import type { Event, Hostel, Mess, MyEventRegistration } from '@/api/types';
import { currentParticipant, currentStaff } from '@/stores/authStore';
import {
  collectAnnouncements,
  participantReader,
  staffReader,
  visibleTo,
  type Announcement,
  type AnnouncementReader,
} from './announcements';
import { dismissAllAnnouncements, dismissAnnouncement, withoutDismissed } from './dismissals';

/**
 * The notices addressed to whoever is signed in — the read half of Stories 8.1
 * and 8.2.
 *
 * One hook serves both audiences, because the only thing that differs is which
 * reader context gets built: a participant's registrations, house, block and hall,
 * or a staff member's team memberships. `matchesAudience` does the rest.
 *
 * Every request here is a catalogue read the app already makes elsewhere, and all
 * of them are non-fatal except the events list — the notices live in that one, so
 * losing it is the only failure worth reporting. A participant with no hostel or
 * no mess allocation simply matches fewer audiences.
 */
export interface AnnouncementInbox {
  /** Addressed to this reader, still live, not dismissed on this device. */
  announcements: Announcement[];
  /** Addressed to this reader before dismissals — so a screen can say "3 dismissed". */
  addressed: number;
  /** Entity id → display name, for `audienceLabel`. */
  names: Record<string, string>;
  /** What this reader matched on, exposed so a screen can explain *why* it is being shown. */
  reader: AnnouncementReader | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  dismiss: (announcementId: string) => void;
  dismissAll: () => void;
}

/** `Promise.allSettled` with a default, so one failed catalogue does not empty the board. */
async function settled<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

interface Loaded {
  events: Event[];
  hostels: Hostel[];
  messHalls: Mess[];
  registrations: MyEventRegistration[];
  hostelId: string | null;
  messId: string | null;
}

const EMPTY: Loaded = {
  events: [],
  hostels: [],
  messHalls: [],
  registrations: [],
  hostelId: null,
  messId: null,
};

export function useAnnouncementInbox(): AnnouncementInbox {
  const participant = currentParticipant();
  const staff = currentStaff();
  const userId = participant?.id ?? staff?.id ?? '';
  const house = participant?.house ?? null;
  const isParticipant = Boolean(participant);

  const [data, setData] = useState<Loaded>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by `dismiss` so the derivation re-runs against the updated record. */
  const [dismissalTick, setDismissalTick] = useState(0);

  // Tracks the live mount so a resolved request cannot set state after unmount,
  // and so a `reload` that overtakes a slower first load cannot be overwritten.
  const generation = useRef(0);

  const load = useCallback(() => {
    const mine = ++generation.current;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        // The events list is the store, so it is the only fatal read.
        const events = await api.listEvents();
        const [hostels, messHalls, registrations, hostel, mess] = await Promise.all([
          settled(api.listHostels(), [] as Hostel[]),
          settled(api.listMess(), [] as Mess[]),
          isParticipant
            ? settled(api.myEventRegistrations(), [] as MyEventRegistration[])
            : Promise.resolve([] as MyEventRegistration[]),
          isParticipant ? settled(api.myHostel(), null) : Promise.resolve(null),
          isParticipant ? settled(api.myMess(), null) : Promise.resolve(null),
        ]);

        if (generation.current !== mine) return;
        setData({
          events,
          hostels,
          messHalls,
          registrations,
          hostelId: hostel?.assigned_hostel ?? null,
          messId: mess?.allotted_mess ?? null,
        });
      } catch (e) {
        if (generation.current !== mine) return;
        setError(e instanceof ApiClientError ? e.message : 'Could not load announcements.');
      } finally {
        if (generation.current === mine) setLoading(false);
      }
    })();
  }, [isParticipant]);

  useEffect(() => {
    load();
    return () => {
      // Invalidate anything in flight; the next mount starts its own generation.
      generation.current += 1;
    };
  }, [load]);

  const reader = useMemo<AnnouncementReader | null>(() => {
    if (participant) {
      return participantReader({
        id: participant.id,
        house,
        registrations: data.registrations,
        hostelId: data.hostelId,
        messId: data.messId,
      });
    }
    if (staff) {
      return staffReader({
        id: staff.id,
        events: data.events,
        hostels: data.hostels,
        messHalls: data.messHalls,
      });
    }
    return null;
    // `participant`/`staff` are fresh object reads from the store on every render,
    // so the primitive identity fields are the honest dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participant?.id, staff?.id, house, data]);

  const names = useMemo(() => {
    const map: Record<string, string> = {};
    for (const event of data.events) map[event.event_id] = event.name;
    for (const hostel of data.hostels) map[hostel.hostel_id] = hostel.name;
    for (const hall of data.messHalls) map[hall.mess_id] = hall.name;
    return map;
  }, [data]);

  const { announcements, addressed } = useMemo(() => {
    if (!reader) return { announcements: [] as Announcement[], addressed: 0 };
    const mine = visibleTo(collectAnnouncements(data.events), reader);
    // Referenced so this recomputes after a dismissal writes to storage.
    void dismissalTick;
    return { announcements: withoutDismissed(userId, mine), addressed: mine.length };
  }, [reader, data.events, userId, dismissalTick]);

  const dismiss = useCallback(
    (announcementId: string) => {
      dismissAnnouncement(userId, announcementId);
      setDismissalTick((n) => n + 1);
    },
    [userId],
  );

  const dismissAll = useCallback(() => {
    dismissAllAnnouncements(userId, announcements);
    setDismissalTick((n) => n + 1);
  }, [userId, announcements]);

  return {
    announcements,
    addressed,
    names,
    reader,
    loading,
    error,
    reload: load,
    dismiss,
    dismissAll,
  };
}
