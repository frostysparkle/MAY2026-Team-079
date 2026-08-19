import { GitBranch } from 'lucide-react';
import { StatusBadge } from '@/components/ui';
import { ROUTES } from '@/config/routes';
import { orDash } from '../format';
import type { TierState } from '../useFestSnapshot';
import { BoardPanel } from './BoardPanel';
import type { PipelineStage } from './boardSeries';

/**
 * The participant pipeline: how far the fest's registrations have actually got.
 *
 * Every stage is drawn as a share of registrations rather than of the stage
 * before it, because the funnel is not nested — somebody can enter an event
 * without ever asking for a bed, and a hall can be allotted before a profile is
 * finished. Chaining the bars would imply an order the data does not have. What
 * the shared denominator buys instead is that the bars are directly comparable:
 * the gap between "Registered" and "Profile complete" is the size of the problem,
 * read straight off the chart.
 *
 * A stage whose figure could not be read shows "—" and an empty track, never a
 * zero-length bar that would read as "nobody".
 */
export function PipelinePanel({
  stages,
  registered,
  tier,
  className,
}: {
  stages: PipelineStage[];
  /** The denominator, for the panel's subtitle. `null` when unreadable. */
  registered: number | null;
  tier: TierState;
  className?: string;
}) {
  const unreadable = stages.filter((stage) => stage.value === null).length;

  return (
    <BoardPanel
      title="Participant pipeline"
      subtitle={
        registered === null
          ? 'Share of all registrations'
          : `Share of ${registered.toLocaleString()} registrations`
      }
      lead={
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-brand-light text-brand-700"
        >
          <GitBranch size={17} strokeWidth={2.25} />
        </span>
      }
      controls={
        unreadable > 0 ? (
          <StatusBadge tone="neutral">
            {unreadable} {unreadable === 1 ? 'figure' : 'figures'} unreadable
          </StatusBadge>
        ) : (
          <StatusBadge tone="success">All figures read</StatusBadge>
        )
      }
      tier={tier}
      to={ROUTES.adminHostels}
      toLabel="Open Hostels"
      fill
      className={className}
    >
      <ul className="my-auto flex list-none flex-col gap-3.5 p-0">
        {stages.map((stage) => {
          const percent =
            stage.value === null || stage.of <= 0
              ? null
              : Math.min(100, Math.max(0, (stage.value / stage.of) * 100));

          return (
            <li key={stage.key} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className="block h-2 w-2 shrink-0 rounded-full"
                    style={{ background: stage.color }}
                  />
                  <span className="truncate text-xs font-semibold text-ink">{stage.label}</span>
                  <span className="hidden truncate text-[11px] text-muted sm:inline">
                    {stage.note}
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums">
                  <b className="font-bold text-ink">{orDash(stage.value)}</b>
                  <span className="ml-1.5 text-muted">
                    {percent === null ? '' : `${Math.round(percent)}%`}
                  </span>
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={`${stage.label}, ${stage.note}`}
                aria-valuemin={0}
                aria-valuemax={stage.of}
                aria-valuenow={stage.value ?? undefined}
                aria-valuetext={
                  stage.value === null
                    ? 'Could not be read'
                    : `${stage.value.toLocaleString()} of ${stage.of.toLocaleString()}`
                }
                className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
              >
                {percent !== null && (
                  <div
                    className="h-full rounded-full transition-[width] duration-700"
                    style={{ width: `${percent}%`, background: stage.color }}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </BoardPanel>
  );
}
