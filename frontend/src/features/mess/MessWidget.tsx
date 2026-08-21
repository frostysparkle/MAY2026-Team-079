import { useEffect, useState } from 'react';
import { UtensilsCrossed } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { MyMessResponse } from '@/api/types';
import { Card, IconTile, ProgressBar, Skeleton, StatusBadge } from '@/components/ui';
import { MealSlotGrid } from '@/features/mess/MealSlotGrid';
import { loggedMeals } from '@/features/mess/mealSlots';

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
  // The same helper the Stay screen's mess panel counts with, so the two cannot
  // report different figures for the same meal card.
  const { logged, total } = loggedMeals(slots);

  // `Card` rather than the surface this used to write out, which was `Card`'s
  // exact declaration — radius, background, padding, shadow and ring — retyped.
  // Two of them, in fact: this and `HostelWidget`, sitting one under the other in
  // the same dashboard panel.
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <IconTile icon={UtensilsCrossed} tone="warning" />
        <div className="min-w-0 flex-1">
          {/* `text-sm`, matching `CardRow`'s title: these widgets sit directly
              under the dashboard's own rows, and a base-size title beside a
              small one is a step in what should be one list. */}
          <p className="truncate text-sm font-semibold text-ink">
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

      <MealSlotGrid slots={slots} />
    </Card>
  );
}

/** A panel-shaped line for the cases with no figures to show. */
function PanelNote({ children }: { children: string }) {
  return (
    <Card>
      <p className="text-sm text-muted">{children}</p>
    </Card>
  );
}
