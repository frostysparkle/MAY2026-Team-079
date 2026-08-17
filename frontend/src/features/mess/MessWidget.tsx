import { useEffect, useState } from 'react';
import { UtensilsCrossed } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { MessDayEntry, MyMessResponse } from '@/api/types';
import { IconTile, ProgressBar, Skeleton, StatusBadge } from '@/components/ui';
import { cn } from '@/lib/cn';

const SLOTS: (keyof MessDayEntry)[] = ['breakfast', 'lunch', 'dinner'];
const SLOT_LABELS: Record<keyof MessDayEntry, string> = {
  breakfast: 'B',
  lunch: 'L',
  dinner: 'D',
};

/**
 * Mess status panel for the participant dashboard: which hall, and how many of
 * the week's meal slots have been scanned.
 *
 * Dressed as one of the dashboard's panels rather than as its own kind of card —
 * the same surface, the same `IconTile` + `StatusBadge` header, and the same
 * `ProgressBar` the admin hostel and mess screens use for a "how full is this"
 * readout. The figure it reports is the participant's own check-in count.
 *
 * `mess_details` may include the full `mess_team` array (the backend doesn't
 * strip it for participants like it does for workshops) — deliberately never
 * rendered here.
 */
export function MessWidget() {
  const [data, setData] = useState<MyMessResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .myMess()
      .then((res) => !cancelled && setData(res))
      .catch(
        (e) =>
          !cancelled &&
          setError(e instanceof ApiClientError ? e.message : 'Could not load mess status.'),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <Skeleton className="h-40 w-full rounded-2xl" />;

  // Says so rather than vanishing: a panel that renders nothing leaves its
  // heading standing over a gap, and "no mess yet" is itself the answer a
  // participant came here for.
  if (error) return <PanelNote>{error}</PanelNote>;
  if (!data?.allotted_mess) {
    return <PanelNote>No mess allotted yet. It appears here once allocation runs.</PanelNote>;
  }

  const slots = data.slots ?? [];
  const total = slots.length * SLOTS.length;
  const logged = slots.reduce(
    (sum, day) => sum + SLOTS.filter((slot) => day[slot].logged).length,
    0,
  );

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-black/[0.03]">
      <div className="flex items-center gap-3">
        <IconTile icon={UtensilsCrossed} tone="warning" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-ink">
            {data.mess_details?.name ?? 'Your Mess'}
          </p>
          <p className="text-xs text-muted">Meal check-ins this week</p>
        </div>
        <StatusBadge tone={logged > 0 ? 'warning' : 'neutral'}>
          {logged}/{total}
        </StatusBadge>
      </div>

      {total > 0 && (
        <ProgressBar
          value={logged}
          max={total}
          tone="warning"
          label="Meal slots checked in this week"
        />
      )}

      {slots.length > 0 && (
        <div className="grid grid-cols-5 gap-1.5 text-center text-xs">
          {slots.map((day, i) => (
            <div key={i} className="flex flex-col gap-1">
              <span className="font-medium uppercase tracking-wide text-muted">Day {i + 1}</span>
              {SLOTS.map((slot) => (
                <span
                  key={slot}
                  className={cn(
                    'rounded-md py-0.5 font-semibold',
                    day[slot].logged
                      ? 'bg-success-bg text-success'
                      : 'bg-surface-2 font-medium text-muted',
                  )}
                >
                  {SLOT_LABELS[slot]}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A panel-shaped line for the cases with no figures to show. */
function PanelNote({ children }: { children: string }) {
  return (
    <p className="rounded-2xl bg-surface p-4 text-sm text-muted shadow-card ring-1 ring-black/[0.03]">
      {children}
    </p>
  );
}
