import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Clock, QrCode, RotateCcw, Save, UtensilsCrossed } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { MealSlot, Mess } from '@/api/types';
import { path, ROUTES } from '@/config/routes';
import { currentStaff, isSuperAdmin } from '@/stores/authStore';
import {
  DEFAULT_TIMINGS,
  MENU_SLOTS,
  SLOT_LABEL,
  clearMenuOverride,
  currentMenuDay,
  formatDishes,
  menuRequestFrom,
  minutesOf,
  overrideFor,
  parseDishes,
  resolveMenu,
  withDishes,
  withTiming,
  type MenuOverride,
} from '@/features/mess/messMenu';
import { MessMenuBoard } from '@/features/mess/MessMenuBoard';
import {
  Button,
  ConfirmDialog,
  DetailPanel,
  ErrorState,
  ResultBanner,
  Spinner,
  StatusBadge,
  TextInput,
} from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import { cn } from '@/lib/cn';

/**
 * The mess team's menu desk: what this hall is serving on each of the six fest
 * days, the window each sitting runs in, and one line of notice for everyone
 * eating there.
 *
 * Open to anyone on the hall's `mess_team` — a volunteer as much as a manager —
 * and to Super Admins, who can reach it for any hall from the mess list. The
 * check is the same one the scanner makes: `session.id` against the hall's team
 * array, read from `GET /mess`, rather than a role table.
 *
 * ── What "save" means here ──────────────────────────────────────────────────
 * Save sends the whole menu to `PUT /mess/{id}/menu`, so a correction typed here
 * reaches every participant allotted to this hall, not just this browser. If the
 * hall still carries a menu left on this device from before that route existed,
 * it is loaded as the starting draft and cleared once a save lands, so nothing
 * anyone typed is lost on the way across.
 *
 * A failed save is reported and the draft is kept — it is never silently
 * downgraded to a device-local write, which would look like success and reach
 * nobody.
 *
 * Editing is a draft: nothing is sent until Save, Discard puts the draft back to
 * what is stored, and a slot that has been reset falls all the way back to the
 * published sheet rather than to a blank list.
 */
export default function MessMenuPage() {
  const { messId = '' } = useParams();
  const navigate = useNavigate();
  const staff = currentStaff();

  const [mess, setMess] = useState<Mess | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [draft, setDraft] = useState<MenuOverride>({});
  const [saved, setSaved] = useState<MenuOverride>({});
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [day, setDay] = useState(() => currentMenuDay());

  /**
   * The raw text of each textarea being typed into, keyed `day:slot`.
   *
   * The dish list cannot be the textarea's only state. Round-tripping every
   * keystroke through `parseDishes` drops the trailing blank line — which is
   * exactly the state the box is in the instant Enter is pressed — so the
   * newline was swallowed and a second dish could never be started. The parsed
   * list still drives the draft and the preview; this only remembers what was
   * literally typed, and is dropped whenever the draft is reset from elsewhere.
   */
  const [typed, setTyped] = useState<Record<string, string>>({});

  useEffect(() => {
    api
      .listMess()
      .then((all) => {
        const hall = all.find((m) => m.mess_id === messId) ?? null;
        setMess(hall);
        // Whatever this hall's menu currently is — its published one, or the copy
        // left on this device before the route existed.
        const stored = overrideFor(hall) ?? {};
        setDraft(stored);
        setSaved(stored);
        setTyped({});
      })
      .catch((e) =>
        setLoadError(e instanceof ApiClientError ? e.message : 'Could not load the mess halls.'),
      )
      .finally(() => setLoading(false));
  }, [messId]);

  const membership = mess?.mess_team?.find((t) => t.user_id === staff?.id);
  const mayEdit = Boolean(membership) || isSuperAdmin();

  const preview = useMemo(() => resolveMenu(mess, draft), [mess, draft]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);

  /** A window whose end is at or before its start would swallow the sitting silently. */
  const timingErrors = useMemo(() => {
    const errors: Partial<Record<MealSlot, string>> = {};
    for (const timing of preview.timings) {
      const start = minutesOf(timing.start);
      const end = minutesOf(timing.end);
      if (start === null || end === null) errors[timing.slot] = 'Use a 24-hour time, e.g. 07:30.';
      else if (end <= start) errors[timing.slot] = 'The end has to come after the start.';
    }
    return errors;
  }, [preview.timings]);

  const blocked = Object.keys(timingErrors).length > 0;

  // A menu typed into this browser before the route existed is not "dirty" —
  // draft and saved agree — but it has still never left the device. Publishing
  // has to be reachable without making a pointless edit first.
  const unpublished = !mess?.menu && preview.edited;
  const canPublish = dirty || unpublished;

  const back = { label: 'Duties', onClick: () => navigate(ROUTES.staffDuties) };

  /** Send the whole menu up, then re-read the hall so what is shown is what is stored. */
  async function save(next: MenuOverride) {
    if (blocked) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.updateMessMenu(messId, menuRequestFrom(resolveMenu(mess, next)));
      // The device copy has served its purpose: the hall's menu now lives on the
      // server, and leaving a stale local one would shadow nothing but confuse
      // anyone reading this code later.
      clearMenuOverride(messId);

      const all = await api.listMess();
      const hall = all.find((m) => m.mess_id === messId) ?? null;
      setMess(hall);
      const stored = overrideFor(hall) ?? {};
      setDraft(stored);
      setSaved(stored);
      setTyped({});
      setSavedAt(new Date().toISOString());
    } catch (e) {
      // Deliberately not falling back to a local write: that would report
      // success for a change nobody else can see.
      setSaveError(
        e instanceof ApiClientError ? e.message : 'Could not save the menu. Nothing was sent.',
      );
    } finally {
      setSaving(false);
    }
  }

  function resetAll() {
    setConfirmReset(false);
    setTyped({});
    // Publishing an empty menu is what puts the hall back on the published sheet
    // for everyone — clearing only this device would leave the old menu standing.
    void save({});
  }

  /** Put one sitting back on the published sheet, forgetting what was typed into it. */
  function resetSlot(slot: MealSlot) {
    setDraft((d) => withDishes(d, day, slot, null));
    setTyped(({ [`${day}:${slot}`]: _dropped, ...rest }) => rest);
  }

  /* ------------------------------------------------------------- render --- */

  if (loading) {
    return (
      <FestivalScreen title="Menu" width="lg" back={back}>
        <div className="flex h-64 items-center justify-center">
          <Spinner label="Loading" />
        </div>
      </FestivalScreen>
    );
  }
  if (loadError) {
    return (
      <FestivalScreen title="Menu" width="lg" back={back}>
        <ErrorState title="Could not load mess" description={loadError} />
      </FestivalScreen>
    );
  }
  if (!mess) {
    return (
      <FestivalScreen title="Menu" width="lg" back={back}>
        <ErrorState title="Mess hall not found" description={`No hall with the id ${messId}.`} />
      </FestivalScreen>
    );
  }
  if (!mayEdit) {
    return (
      <FestivalScreen title="Menu" eyebrow={mess.name} width="lg" back={back}>
        <ErrorState
          title="Not on this hall's team"
          description="Only the mess team assigned to this hall, or a Super Admin, can edit its menu."
        />
      </FestivalScreen>
    );
  }

  const dayDraft = draft.days?.[String(day)] ?? {};

  return (
    <FestivalScreen
      title="Menu"
      eyebrow={mess.name}
      subtitle={`${preview.label} · six fest days, three meals a day`}
      width="lg"
      back={back}
      actions={
        membership?.logging ? (
          <Button
            variant="secondary"
            className="gap-1.5"
            onClick={() => navigate(path(ROUTES.scanMess, { messId }))}
          >
            <QrCode size={15} /> Open scanner
          </Button>
        ) : undefined
      }
    >
      {unpublished && !saveError && (
        <ResultBanner variant="warning" title="This menu is only on this device">
          It was saved here before hall menus could be published. Publish it to put it in front of
          everyone allotted to this hall.
        </ResultBanner>
      )}

      {saveError && (
        <ResultBanner variant="error" title="The menu was not saved">
          {saveError} Your changes are still here — try Publish again.
        </ResultBanner>
      )}

      {savedAt && !dirty && !saveError && (
        <ResultBanner variant="success" title="Published to everyone in this hall">
          {preview.edited
            ? 'Participants allotted here now see this menu.'
            : 'Every change has been withdrawn — this hall is back on the published campus menu.'}
        </ResultBanner>
      )}

      {/* ---- service windows ---- */}
      <DetailPanel
        title="Meal timings"
        trailing={
          Object.keys(draft.timings ?? {}).length > 0 ? (
            <StatusBadge tone="warning">Changed</StatusBadge>
          ) : undefined
        }
        footer="These windows are what the scanner uses to work out which meal it is logging, so a change here changes what a swipe counts as. They apply to every fest day."
      >
        <div className="flex flex-col gap-4">
          {MENU_SLOTS.map((slot) => {
            const timing = preview.timings.find((t) => t.slot === slot)!;
            const fallback = DEFAULT_TIMINGS.find((t) => t.slot === slot)!;
            const changed = Boolean(draft.timings?.[slot]);
            return (
              <div key={slot} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Clock size={15} strokeWidth={2.25} aria-hidden className="text-muted" />
                  <span className="flex-1 text-sm font-bold text-ink">{SLOT_LABEL[slot]}</span>
                  {changed && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDraft((d) => withTiming(d, slot, null))}
                    >
                      <RotateCcw size={13} /> Reset to {fallback.start}–{fallback.end}
                    </Button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextInput
                    label={`${SLOT_LABEL[slot]} starts`}
                    type="time"
                    value={timing.start}
                    error={timingErrors[slot]}
                    onChange={(e) =>
                      setDraft((d) =>
                        withTiming(d, slot, { start: e.target.value, end: timing.end }),
                      )
                    }
                  />
                  <TextInput
                    label={`${SLOT_LABEL[slot]} ends`}
                    type="time"
                    value={timing.end}
                    onChange={(e) =>
                      setDraft((d) =>
                        withTiming(d, slot, { start: timing.start, end: e.target.value }),
                      )
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      </DetailPanel>

      {/* ---- per-day dishes ---- */}
      <DetailPanel
        title="Dishes"
        meta={`Day ${day} of ${preview.days.length}`}
        footer="One dish per line. Reset puts a sitting back to the published campus menu for this hall’s dietary category."
      >
        <div
          role="tablist"
          aria-label="Fest day to edit"
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
        >
          {preview.days.map((d) => (
            <button
              key={d.day}
              type="button"
              role="tab"
              aria-selected={d.day === day}
              onClick={() => setDay(d.day)}
              className={cn(
                'tap shrink-0 rounded-xl px-3 py-2 text-left transition-colors',
                d.day === day
                  ? 'bg-brand text-white shadow-card'
                  : 'bg-surface-2 text-muted hover:text-ink',
              )}
            >
              <span className="block text-[11px] font-semibold uppercase tracking-wide opacity-80">
                Day {d.day}
              </span>
              <span className="block text-sm font-bold">{d.weekday}</span>
            </button>
          ))}
        </div>

        {MENU_SLOTS.map((slot) => {
          const resolved = preview.days.find((d) => d.day === day)!;
          const changed = Array.isArray(dayDraft[slot]);
          return (
            <div key={slot} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <label
                  htmlFor={`dishes-${day}-${slot}`}
                  className="flex-1 text-sm font-medium text-ink"
                >
                  {SLOT_LABEL[slot]}
                </label>
                {changed && (
                  <Button size="sm" variant="ghost" onClick={() => resetSlot(slot)}>
                    <RotateCcw size={13} /> Reset
                  </Button>
                )}
              </div>
              <textarea
                id={`dishes-${day}-${slot}`}
                rows={6}
                value={typed[`${day}:${slot}`] ?? formatDishes(resolved[slot])}
                onChange={(e) => {
                  const text = e.target.value;
                  setTyped((t) => ({ ...t, [`${day}:${slot}`]: text }));
                  setDraft((d) => withDishes(d, day, slot, parseDishes(text)));
                }}
                className="w-full rounded-lg border border-input px-3 py-2.5 text-sm leading-relaxed outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
            </div>
          );
        })}
      </DetailPanel>

      {/* ---- notice ---- */}
      <DetailPanel
        title="Notice"
        footer="Shown above the menu to everyone allotted to this hall — a substitution, a delayed sitting, a one-off closure."
      >
        <TextInput
          label="One line for today"
          placeholder="e.g. Dinner runs until 9:30 pm on day 3."
          value={draft.note ?? ''}
          onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
        />
      </DetailPanel>

      {/* ---- preview ---- */}
      <DetailPanel
        title="What participants see"
        trailing={dirty ? <StatusBadge tone="warning">Unsaved draft</StatusBadge> : undefined}
      >
        {/* Keyed on the day so the preview follows the day being edited:
            `initialDay` only seeds the board's own state, so without this it
            would stay on whichever day it first mounted with. */}
        <MessMenuBoard key={day} menu={preview} initialDay={day} />
      </DetailPanel>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => void save(draft)}
          loading={saving}
          disabled={!canPublish || blocked}
          className="gap-1.5"
        >
          <Save size={15} /> Publish menu
        </Button>
        <Button
          variant="secondary"
          disabled={!dirty || saving}
          onClick={() => {
            setDraft(saved);
            setTyped({});
          }}
        >
          Discard changes
        </Button>
        <Button
          variant="ghost"
          disabled={saving || (!preview.edited && !dirty)}
          onClick={() => setConfirmReset(true)}
          className="gap-1.5"
        >
          <UtensilsCrossed size={14} /> Back to the published menu
        </Button>
        {preview.updatedAt && (
          <span className="text-xs text-muted">
            Last saved {new Date(preview.updatedAt).toLocaleString()}
            {preview.updatedBy ? ` by ${preview.updatedBy}` : ''}
          </span>
        )}
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="Drop every change to this menu?"
        description="Timings, dishes and the notice all go back to the published campus menu for this hall, for everyone allotted here. This cannot be undone."
        confirmLabel="Reset menu"
        onConfirm={resetAll}
        onCancel={() => setConfirmReset(false)}
      />
    </FestivalScreen>
  );
}
