import { useState, type ReactNode } from 'react';
import { Backpack, Clock, FileText, IdCard, ListChecks, MapPin, Ticket } from 'lucide-react';
import type { EventView } from '@/features/events/eventView';
import { hasEntryInfo, type EventEntryInfo } from '@/features/events/eventExtras';

/**
 * The one renderer for an event detail page. Both the hardcoded festival
 * catalogue and Super-Admin-created events resolve to `EventView` first, so a
 * new event is visually indistinguishable from a hardcoded one — no
 * source-specific branching happens below this line.
 *
 * `action` is the caller's registration control, which is the only part that
 * genuinely differs: catalogue events point at the app, backend events register
 * against the live API.
 */
export function EventDetailView({
  view,
  action,
  crowd,
}: {
  view: EventView;
  action?: ReactNode;
  /**
   * How busy the event is right now — Story 3.3. Optional because it needs a
   * signed-in call: the pre-login brochure and the admin preview both render
   * this same component without one.
   */
  crowd?: ReactNode;
}) {
  const { category } = view;

  return (
    <div className="flex flex-col gap-6">
      {/* Hero: poster + title/meta */}
      <div className="animate-rise grid gap-6 sm:grid-cols-[minmax(0,300px)_1fr] sm:items-start">
        <div className="mx-auto w-full max-w-xs overflow-hidden rounded-2xl shadow-lift ring-1 ring-black/[0.06]">
          <div className="aspect-[4/5] w-full bg-surface-2">
            {view.poster ? (
              <img
                src={view.poster}
                alt={view.name}
                onError={(e) => {
                  const img = e.currentTarget;
                  // Nothing to swap to when the category has no artwork either.
                  if (category.image && !img.src.endsWith(category.image)) img.src = category.image;
                }}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand to-accent">
                <Ticket size={48} strokeWidth={1.5} className="text-white/90" />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <span
              className="inline-block rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.15em] text-white"
              style={{ backgroundColor: category.accent }}
            >
              {category.label}
            </span>
            <h1 className="mt-3 text-3xl font-black uppercase leading-tight tracking-tight text-ink sm:text-4xl">
              {view.name}
            </h1>
          </div>

          <MetaGrid view={view} />

          {crowd}

          {action}

          <p className="text-xs italic text-muted">Schedule is tentative and subject to change.</p>
        </div>
      </div>

      {view.description && (
        <Section title="Event Detail">
          <p className="whitespace-pre-line leading-relaxed text-ink/90">{view.description}</p>
        </Section>
      )}

      {hasEntryInfo(view.entry) && (
        <Section title="Before You Go">
          <EntryRequirements entry={view.entry} accent={category.accent} />
        </Section>
      )}

      {view.prizes.length > 0 && (
        <Section title="Prizes">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {view.prizes.map((p) => (
              <div
                key={p.label}
                className="rounded-2xl bg-surface p-4 text-center shadow-card ring-1 ring-black/[0.04]"
              >
                <p className="text-lg font-black text-ink">{p.amount}</p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted">
                  {p.label}
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {view.timeline.length > 0 && (
        <Section title="Rounds & Timeline">
          <ol className="flex flex-col gap-3">
            {view.timeline.map((r, i) => (
              <li
                key={`${r.name}-${i}`}
                className="relative rounded-2xl bg-surface p-4 shadow-card ring-1 ring-black/[0.04]"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h3 className="flex items-center gap-2 font-bold text-ink">
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                      style={{ backgroundColor: category.accent }}
                    >
                      {i + 1}
                    </span>
                    {r.name}
                  </h3>
                  {r.when && <span className="text-xs font-semibold text-brand">{r.when}</span>}
                </div>
                {r.venue && (
                  <p className="mt-1 flex items-center gap-1 pl-8 text-xs font-medium uppercase tracking-wide text-muted">
                    <MapPin size={12} className="shrink-0" /> {r.venue}
                  </p>
                )}
                {r.description && (
                  <p className="mt-2 pl-8 text-sm leading-relaxed text-ink/85">{r.description}</p>
                )}
              </li>
            ))}
          </ol>
        </Section>
      )}

      {view.faqs.length > 0 && (
        <Section title="Frequently Asked Questions">
          <Faq items={view.faqs} />
        </Section>
      )}

      {!view.description &&
        view.timeline.length === 0 &&
        view.prizes.length === 0 &&
        !hasEntryInfo(view.entry) && (
          <div className="rounded-2xl bg-surface p-6 text-center shadow-card ring-1 ring-black/[0.04]">
            <p className="text-sm text-muted">
              Full details for this event are coming soon. Sign in to register and get your pass.
            </p>
          </div>
        )}
    </div>
  );
}

/* --------------------------------------------------------------- helpers --- */

function MetaGrid({ view }: { view: EventView }) {
  // Capacity is a structured field an admin edits, but it renders as one more
  // tile. Skipped when the author's curated list already labels one, so the
  // grid never shows "Capacity" twice — nor repeats a React key.
  const authored = view.meta.some((m) => m.label.trim().toLowerCase() === 'capacity');
  const tiles =
    view.capacity && !authored
      ? [...view.meta, { label: 'Capacity', value: view.capacity.toLocaleString('en-IN') }]
      : view.meta;

  if (!view.rulebook && tiles.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {view.rulebook && (
        <a
          href={view.rulebook}
          target="_blank"
          rel="noreferrer noopener"
          className="tap inline-flex w-fit items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white hover:opacity-90 active:scale-95"
        >
          <FileText size={14} /> Rulebook
        </a>
      )}
      {tiles.length > 0 && (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {tiles.map((it) => (
            <div
              key={it.label}
              className="rounded-xl bg-surface px-3 py-2 shadow-card ring-1 ring-black/[0.04]"
            >
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                {it.label}
              </dt>
              <dd className="text-sm font-bold text-ink">{it.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/**
 * What to bring and when to turn up — the gate-side half of an event page.
 *
 * Every part is independently optional, because organisers fill these in at
 * different times: a reporting time may be known weeks before anyone has
 * decided what participants may carry in.
 */
function EntryRequirements({ entry, accent }: { entry: EventEntryInfo; accent: string }) {
  return (
    <div className="flex flex-col gap-3">
      {(entry.reportingTime || entry.idProof) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {entry.reportingTime && (
            <EntryFact
              icon={<Clock size={14} strokeWidth={2.5} />}
              label="Reporting time"
              value={entry.reportingTime}
              accent={accent}
            />
          )}
          {entry.idProof && (
            <EntryFact
              icon={<IdCard size={14} strokeWidth={2.5} />}
              label="ID proof required"
              value={entry.idProof}
              accent={accent}
            />
          )}
        </div>
      )}

      {entry.allowedItems.length > 0 && (
        <EntryPanel icon={<Backpack size={12} className="shrink-0" />} label="Allowed items">
          <ul className="mt-2 flex flex-wrap gap-2">
            {entry.allowedItems.map((item, i) => (
              <li
                key={`${item}-${i}`}
                className="rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-ink"
              >
                {item}
              </li>
            ))}
          </ul>
        </EntryPanel>
      )}

      {entry.rules.length > 0 && (
        <EntryPanel icon={<ListChecks size={12} className="shrink-0" />} label="Entry rules">
          <ul className="mt-2 flex flex-col gap-2">
            {entry.rules.map((rule, i) => (
              <li key={`${rule}-${i}`} className="flex gap-2 text-sm leading-relaxed text-ink/85">
                <span
                  aria-hidden
                  className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: accent }}
                />
                {rule}
              </li>
            ))}
          </ul>
        </EntryPanel>
      )}
    </div>
  );
}

/** One short labelled fact, badged in the category colour. */
function EntryFact({
  icon,
  label,
  value,
  accent,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-black/[0.04]">
      <span
        aria-hidden
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white"
        style={{ backgroundColor: accent }}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</p>
        <p className="text-sm font-bold text-ink">{value}</p>
      </div>
    </div>
  );
}

/** A titled card holding a list — allowed items, entry rules. */
function EntryPanel({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-card ring-1 ring-black/[0.04]">
      <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
        {icon} {label}
      </p>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-black tracking-tight text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Faq({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div
            key={item.q}
            className="overflow-hidden rounded-2xl bg-surface shadow-card ring-1 ring-black/[0.04]"
          >
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : i)}
              className="tap flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
            >
              <span className="text-sm font-semibold text-ink">{item.q}</span>
              <span
                aria-hidden
                className={`shrink-0 text-lg text-brand transition-transform duration-300 ${isOpen ? 'rotate-45' : ''}`}
              >
                +
              </span>
            </button>
            {isOpen && <p className="px-4 pb-4 text-sm leading-relaxed text-ink/85">{item.a}</p>}
          </div>
        );
      })}
    </div>
  );
}
