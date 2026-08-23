import type { MessSlotEntry } from '@/api/types';
import { groupSlotsByDay, MEAL_SLOTS, MEAL_SLOT_LABEL } from '@/features/mess/mealSlots';
import { cn } from '@/lib/cn';

/**
 * A participant's meal card: one column per fest day, one cell per sitting, tinted
 * where the counter has scanned them in.
 *
 * Shared between the dashboard's mess widget and the Stay screen's mess panel,
 * which had it twice — the same five-column grid, the same `B`/`L`/`D` labels, the
 * same `bg-success-bg` tint, written out in full in both places. Two copies of a
 * grid that appears on two screens a student moves directly between is two chances
 * for the meal card to look like a different object in each.
 *
 * Takes `GET /mess/my_mess`'s real flat `slots` list and groups it into days
 * itself (`groupSlotsByDay`) — the backend has no per-day object shape for this
 * to read directly.
 *
 * Renders nothing when there are no days to show, so a caller can drop it in
 * without guarding — which is what both callers were doing by hand.
 */
export function MealSlotGrid({
  slots,
  className,
}: {
  slots: readonly MessSlotEntry[];
  className?: string;
}) {
  const days = groupSlotsByDay(slots);
  if (days.length === 0) return null;

  return (
    <div className={cn('grid grid-cols-5 gap-1.5 text-center text-xs', className)}>
      {days.map((day, i) => (
        <div key={i} className="flex flex-col gap-1">
          <span className="font-medium uppercase tracking-wide text-muted">Day {i + 1}</span>
          {MEAL_SLOTS.map((slot) => {
            const entry = day.find((e) => e.slot === slot);
            return (
              <span
                key={slot}
                className={cn(
                  'rounded-md py-0.5 font-semibold',
                  entry?.scanned
                    ? 'bg-success-bg text-success'
                    : 'bg-surface-2 font-medium text-muted',
                )}
              >
                {MEAL_SLOT_LABEL[slot]}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}
