import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BedDouble,
  Download,
  LayoutGrid,
  List,
  Pencil,
  Save,
  Search,
  UserRound,
  Users,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { ParticipantRecord, ParticipantStatisticsResponse } from '@/api/types';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import { exportParticipants } from '@/features/staff/analyticsExport';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  ResultBanner,
  SectionHeading,
  Select,
  Skeleton,
  StatCard,
  StatusBadge,
  TablePager,
  TextInput,
  ViewToggle,
  sortRows,
  useTableSort,
  usePagedList,
  useViewMode,
  type DataTableColumn,
  type ViewOption,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  changedFields,
  clearedFields,
  displayName,
  EDITABLE_FIELDS,
  editableValue,
  formFrom,
  hasChanges,
  hostelLabel,
  hostelNames,
  signupLabel,
  standingOf,
  type ParticipantForm,
} from '@/features/participants/participantAdmin';
import { ParticipantCards } from '@/features/participants/ParticipantCards';

/**
 * One dashboard for participant records — Story 7.3.
 *
 * The story asked for view *and* update from one place. Viewing was already
 * possible per hall, per block, and per event; what was missing was a fest-wide
 * list and any way at all to correct somebody's record — until this sprint no
 * endpoint wrote to a participant document except that participant's own
 * `PATCH /profile/complete`, so an admin who spotted a misspelled name on a
 * hostel roster could do nothing about it.
 *
 * Two deliberate limits, both stated on the screen rather than in a footnote:
 *
 * * **Only profile fields are editable.** Email and participant id are identity
 *   — the id is derived from the email and is what every roster, log row, and QR
 *   payload joins on. Allocation state belongs to the allocation routes, which
 *   enforce capacity and scan state; writing it here could seat somebody in a
 *   full hall or mark them inside a block the scanner thinks they left.
 * * **Search is server-side.** `GET /participants` takes `q` and `house` and caps
 *   the response, so a fest of thousands is never pulled into the browser to be
 *   filtered there.
 *
 * Layered on top of that server search are three client-side filters — profile
 * status, stay, and mess — plus a Grid/List view toggle, matching the pattern
 * `AdminHostelsPage` and `AdminMessPage` use. Those two narrow a fest-wide
 * collection the browser already holds in full; this page's server search stays
 * exactly as it is, and the extra filters only ever narrow the (already capped)
 * page that search returned.
 */

const PAGE_SIZE = 12;
const FETCH_LIMIT = 200;

type TriState = 'any' | 'yes' | 'no';

const VIEW_OPTIONS: readonly ViewOption<'table' | 'cards'>[] = [
  { value: 'table', label: 'Table view', icon: List },
  { value: 'cards', label: 'Card view', icon: LayoutGrid },
];

export default function AdminParticipantsPage() {
  const [participants, setParticipants] = useState<ParticipantRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Two pieces of state, not one: `search` is what has been typed, `query` is
  // what was actually asked for. Firing a request per keystroke against a
  // server-side search would issue one per character.
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [house, setHouse] = useState('');

  const [editing, setEditing] = useState<ParticipantRecord | null>(null);
  const [form, setForm] = useState<ParticipantForm>({});
  const [original, setOriginal] = useState<ParticipantForm>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(() => {
    // Back to the skeleton for a new search, because a server-side search
    // replaces the list wholesale — leaving the previous page's rows up while a
    // different query runs shows an admin results for something they are no
    // longer asking about.
    setParticipants(null);
    api
      .listParticipants({ q: query || undefined, house: house || undefined }, FETCH_LIMIT)
      .then((response) => {
        setParticipants(response.participants);
        setLoadError(null);
      })
      .catch((e) =>
        setLoadError(e instanceof ApiClientError ? e.message : 'Could not load participants.'),
      );
  }, [query, house]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * The house vocabulary, fetched once and never recomputed from the roster.
   *
   * Deriving it from `participants` made the control delete its own options:
   * selecting a house refetches a roster holding only that house, so every other
   * house vanished from the dropdown that had just been used — and a text search
   * narrowed it the same way. `by_house` carries every house somebody is actually
   * in, so the filter still cannot offer an empty one, but it is counted across
   * the whole collection rather than the capped page this screen holds, and it
   * sits behind the same Super Admin gate as the roster itself.
   *
   * Keys are used exactly as stored, only dropping blanks. `GET /participants`
   * matches `profile.house` exactly, so trimming the value here would silently
   * match nothing for a record saved with stray whitespace.
   */
  const [stats, setStats] = useState<ParticipantStatisticsResponse | null>(null);

  useEffect(() => {
    api
      .participantStatistics()
      .then(setStats)
      // Non-fatal on purpose: losing the dropdown still leaves the roster and its
      // server-side search working, which beats failing the whole screen to the
      // ErrorState over a filter control. The cards fall back to counting the
      // page, which is honest as long as they say so — see `summary` below.
      .catch(() => setStats(null));
  }, []);

  const houses = useMemo(
    () =>
      Object.keys(stats?.by_house ?? {})
        .filter((name) => name.trim())
        .sort((a, b) => a.localeCompare(b)),
    [stats],
  );

  /**
   * The block catalogue, only so the Stay column can name a block.
   *
   * A participant record carries `accommodation.hostel_id` and nothing else —
   * `GET /participants` returns the subdocument verbatim and never joins the
   * hostel collection — so this column used to read `HS01 · 100`, a code an admin
   * has to translate by hand against a list held somewhere else. `GET /hostels`
   * is the catalogue that has the names, it is one request for the whole screen
   * rather than one per row, and it does not move while the roster is open.
   *
   * Fetched once, not per search: the catalogue does not change when `q` or
   * `house` does, and refetching it on every keystroke-committed search would be
   * a request per search for a list that is identical each time.
   *
   * Non-fatal like the statistics fetch above. Losing it costs the names and
   * leaves ids — `hostelLabel` falls back to the id — which is strictly what this
   * screen showed before, so it is not worth failing the roster over.
   */
  const [hostels, setHostels] = useState<Record<string, string>>({});

  useEffect(() => {
    api
      .listHostels()
      .then((rows) => setHostels(hostelNames(rows)))
      .catch(() => setHostels({}));
  }, []);

  const filtered = Boolean(query || house);

  /**
   * Two extra filters over the loaded page — profile completeness and whether a
   * stay has been allotted. Unlike `query`/`house` these narrow the page already
   * in the browser rather than asking the server again, so they are plain
   * component state rather than URL-backed `useListFilters`: the server search
   * and this refinement are two different questions, and conflating them risked
   * the server search silently losing its own params.
   *
   * A third filter — mess allocation — was dropped rather than squeezed onto the
   * row: Stay already answers "has this person been allotted somewhere", and a
   * fifth control (Search, House, Profile, Stay, plus the view toggle) fit one
   * row cleanly where a sixth started to crowd it. `standingOf(row).mess` is
   * still visible in the Stay/Profile columns' neighbourhood via the table, and
   * in the summary cards above, so nothing here is unreachable — only unfiltered.
   */
  const [profileFilter, setProfileFilter] = useState<TriState>('any');
  const [stayFilter, setStayFilter] = useState<TriState>('any');
  const refinementActive = profileFilter !== 'any' || stayFilter !== 'any';
  const toolbarActive = Boolean(query || house) || refinementActive;

  function clearToolbar() {
    setSearch('');
    setQuery('');
    setHouse('');
    setProfileFilter('any');
    setStayFilter('any');
  }

  /**
   * The four stat cards.
   *
   * These used to be `.length` and loop counts over `participants`, which is a
   * page capped at `FETCH_LIMIT`. On a fest of thousands that made every card
   * wrong in the same direction: "Registered" pinned to exactly 200 while the
   * collection held 2,483, and "Profile complete", "In a block" and "In a hall"
   * silently reported the first 200 rows' share instead of the fest's.
   *
   * The exact figures were already on the screen — `/participants/statistics`
   * counts the whole collection server-side and was being fetched here purely to
   * populate the house dropdown. So the unfiltered cards now read from it, and
   * `exact` records which side of that line a given render is on.
   *
   * A filter changes the question. "How many of the people matching this search
   * are in a block" is not answerable from a fest-wide aggregate — the endpoint
   * takes no `q`/`house` — so a filtered view keeps counting the page and the
   * labels below say "matching" rather than implying a total.
   */
  const summary = useMemo(() => {
    const rows = participants ?? [];

    if (!filtered && stats) {
      return {
        exact: true,
        total: stats.total_registered,
        complete: stats.profile_complete,
        incomplete: stats.profile_incomplete,
        hostel: stats.hostel_allotted,
        mess: stats.mess_allotted,
      };
    }

    let complete = 0;
    let hostel = 0;
    let mess = 0;
    for (const participant of rows) {
      const standing = standingOf(participant);
      if (standing.profileComplete) complete += 1;
      if (standing.hostel) hostel += 1;
      if (standing.mess) mess += 1;
    }
    return {
      exact: false,
      total: rows.length,
      complete,
      incomplete: rows.length - complete,
      hostel,
      mess,
    };
  }, [participants, stats, filtered]);

  function beginEdit(participant: ParticipantRecord) {
    const initial = formFrom(participant);
    setEditing(participant);
    setForm(initial);
    setOriginal(initial);
    setSaveError(null);
    setSaved(null);
  }

  function cancelEdit() {
    setEditing(null);
    setForm({});
    setOriginal({});
    setSaveError(null);
  }

  async function save() {
    if (!editing) return;
    const patch = changedFields(original, form);
    if (Object.keys(patch).length === 0) return;

    setSaving(true);
    setSaveError(null);
    try {
      const result = await api.updateParticipant(editing.participant_id, patch);
      // The response is the stored profile, so the row updates from what the
      // server actually saved rather than from what was typed.
      setParticipants((current) =>
        (current ?? []).map((row) =>
          row.participant_id === editing.participant_id ? { ...row, profile: result.profile } : row,
        ),
      );
      setSaved(`${displayName(editing)} updated.`);
      setEditing(null);
      setForm({});
      setOriginal({});
    } catch (e) {
      setSaveError(e instanceof ApiClientError ? e.message : 'Could not save those changes.');
    } finally {
      setSaving(false);
    }
  }

  const columns = useMemo<DataTableColumn<ParticipantRecord>[]>(
    () => [
      {
        key: 'name',
        header: 'Participant',
        sortValue: (row) => displayName(row),
        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{displayName(row)}</p>
            <p className="truncate text-xs text-muted">{row.email}</p>
          </div>
        ),
      },
      {
        key: 'id',
        header: 'ID',
        sortValue: (row) => row.participant_id,
        cell: (row) => (
          <span className="text-xs tabular-nums text-muted">{row.participant_id}</span>
        ),
      },
      {
        key: 'house',
        header: 'House',
        sortValue: (row) => row.profile?.house ?? '',
        cell: (row) => row.profile?.house ?? <span className="text-muted">—</span>,
      },
      {
        key: 'stay',
        header: 'Stay',
        // Sorted by what the cell shows, so the column reads the way it is
        // ordered. Sorting by `hostel_id` while showing names would group
        // Alakananda with Brahmaputra under HS01/HS02 and look arbitrary to
        // anybody reading the names.
        sortValue: (row) => hostelLabel(row, hostels) ?? '',
        cell: (row) => {
          const stay = hostelLabel(row, hostels);
          if (!stay) return <span className="text-xs text-muted">Not allotted</span>;
          return <span className="text-xs text-ink">{stay}</span>;
        },
      },
      {
        key: 'registrations',
        header: 'Signed up',
        align: 'right',
        sortValue: (row) => row.event_count + row.workshop_count,
        // Words, not `ev` / `ws`: the counts are the same figures, spelled out so
        // the cell can be read without a key. `whitespace-nowrap` because the
        // longer text is what would otherwise wrap mid-phrase in a narrow column.
        cell: (row) => (
          <span className="whitespace-nowrap text-xs tabular-nums text-muted">
            {signupLabel(row)}
          </span>
        ),
      },
      {
        key: 'profile',
        header: 'Profile',
        cell: (row) =>
          standingOf(row).profileComplete ? (
            <StatusBadge tone="success">Complete</StatusBadge>
          ) : (
            <StatusBadge tone="warning">Needs detail</StatusBadge>
          ),
      },
      {
        key: 'actions',
        header: 'Actions',
        srOnlyHeader: true,
        align: 'right',
        cell: (row) => (
          <Button variant="secondary" size="sm" onClick={() => beginEdit(row)}>
            <Pencil size={13} strokeWidth={2.5} /> Edit
          </Button>
        ),
      },
    ],
    // `hostels` is a dependency because the Stay column closes over it: without
    // it the columns are built once with an empty catalogue and the roster keeps
    // showing ids after the names have arrived.
    [hostels],
  );

  // The two refinement filters, applied to the loaded (server-searched) page.
  const refined = useMemo(() => {
    const rows = participants ?? [];
    if (!refinementActive) return rows;
    return rows.filter((row) => {
      const standing = standingOf(row);
      if (profileFilter === 'yes' && !standing.profileComplete) return false;
      if (profileFilter === 'no' && standing.profileComplete) return false;
      if (stayFilter === 'yes' && !standing.hostel) return false;
      if (stayFilter === 'no' && standing.hostel) return false;
      return true;
    });
  }, [participants, refinementActive, profileFilter, stayFilter]);

  const sort = useTableSort('name');
  const sorted = useMemo(() => sortRows(refined, columns, sort), [refined, columns, sort]);
  const paged = usePagedList(sorted, {
    pageSize: PAGE_SIZE,
    resetKey: `${query}|${house}|${profileFilter}|${stayFilter}|${sort.signature}`,
  });

  const { view, setView } = useViewMode(VIEW_OPTIONS, 'table');

  if (loadError) {
    return (
      <ErrorState title="Could not load participants" description={loadError} onRetry={load} />
    );
  }

  const cleared = editing ? clearedFields(original, form) : [];

  return (
    <FestivalScreen
      title="Participants"
      subtitle="Every registered participant, and the one place a record can be corrected."
      /* Journey E.10. Exports the sorted set currently loaded, so a search the
         admin typed is honoured — "unfiltered" in the guide means the view is not
         pre-filtered for this role, not that their own narrowing is ignored. */
      actions={
        <Button
          variant="secondary"
          className="gap-1.5"
          disabled={sorted.length === 0}
          onClick={() => exportParticipants(sorted)}
        >
          <Download size={14} /> Export CSV
        </Button>
      }
    >
      {saved && (
        <ResultBanner variant="success" title="Saved">
          {saved} The change is recorded in the audit trail against your account.
        </ResultBanner>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon={Users}
          label={filtered ? 'Matching' : 'Registered'}
          value={summary.total}
          footnote={
            summary.exact
              ? 'across the whole fest'
              : summary.total === FETCH_LIMIT
                ? `first ${FETCH_LIMIT} shown — a floor`
                : undefined
          }
        />
        <StatCard
          icon={UserRound}
          label={filtered ? 'Matching, profile complete' : 'Profile complete'}
          value={summary.complete}
          tone="success"
          footnote={`${summary.incomplete} still to fill in`}
        />
        <StatCard
          icon={BedDouble}
          label={filtered ? 'Matching, in a block' : 'In a block'}
          value={summary.hostel}
          tone="info"
        />
        <StatCard
          icon={UtensilsCrossed}
          label={filtered ? 'Matching, in a hall' : 'In a hall'}
          value={summary.mess}
          tone="accent"
        />
      </div>

      {editing && (
        <Card className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionHeading title="Edit record" meta={displayName(editing)} />
            <Button variant="ghost" size="sm" onClick={cancelEdit}>
              <X size={14} strokeWidth={2.5} /> Close
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {EDITABLE_FIELDS.map((field) => {
              const value = form[field.key] ?? '';
              if (field.options) {
                return (
                  <Select
                    key={field.key}
                    label={field.label}
                    value={value}
                    placeholder="Not set"
                    hint={field.hint}
                    onChange={(e) =>
                      setForm((current) => ({ ...current, [field.key]: e.target.value }))
                    }
                    options={editableValue(field, value).map((option) => ({
                      value: option,
                      label: option,
                    }))}
                  />
                );
              }
              if (field.multiline) {
                return (
                  <div key={field.key} className="flex flex-col gap-1 sm:col-span-2">
                    <label htmlFor={`field-${field.key}`} className="text-sm font-medium text-ink">
                      {field.label}
                    </label>
                    <textarea
                      id={`field-${field.key}`}
                      rows={2}
                      value={value}
                      onChange={(e) =>
                        setForm((current) => ({ ...current, [field.key]: e.target.value }))
                      }
                      className={cn(
                        'w-full resize-y rounded-lg border border-input px-3 py-2.5 text-sm outline-none transition-colors',
                        'focus:border-brand focus:ring-2 focus:ring-brand/30',
                      )}
                    />
                    {field.hint && <p className="text-xs text-muted">{field.hint}</p>}
                  </div>
                );
              }
              return (
                <TextInput
                  key={field.key}
                  label={field.label}
                  value={value}
                  hint={field.hint}
                  onChange={(e) =>
                    setForm((current) => ({ ...current, [field.key]: e.target.value }))
                  }
                />
              );
            })}
          </div>

          {cleared.length > 0 && (
            <ResultBanner variant="warning" title="Cleared fields are not saved">
              {cleared.map((field) => field.label).join(', ')} — emptying a field would overwrite a
              real value with nothing, which this form does not do. Type a replacement, or close
              without saving.
            </ResultBanner>
          )}

          {saveError && (
            <ResultBanner variant="error" title="Not saved">
              {saveError}
            </ResultBanner>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
            <p className="text-xs leading-relaxed text-muted">
              {editing.email} · {editing.participant_id} — neither is editable here. Hostel, mess,
              event and workshop placements belong to the allocation and registration screens, which
              enforce capacity.
            </p>
            <Button onClick={save} loading={saving} disabled={!hasChanges(original, form)}>
              <Save size={15} strokeWidth={2.5} /> Save changes
            </Button>
          </div>
        </Card>
      )}

      {/* One panel holds the search, the filters, the rows, and the pager —
          matching Mess, Hostels, and Staff, which put every control (search,
          the visible filters, and the view toggle) on one wrapped row rather
          than splitting them across a search row and a filters row. `q` and
          `house` stay a server round trip on submit, same as before; Profile
          and Stay narrow the returned page in the browser. Both kinds of
          control sit in the same row because that is what the other three
          admin lists do — an admin who has learned one should not find a
          second layout here. */}
      <div className="flex flex-col gap-4 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-black/[0.03]">
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(search.trim());
          }}
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1">
              <TextInput
                label="Search"
                icon={Search}
                value={search}
                placeholder="Name, email, or participant ID"
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="min-w-36">
              <Select
                label="House"
                value={house}
                placeholder="Every house"
                onChange={(e) => setHouse(e.target.value)}
                options={houses.map((option) => ({ value: option, label: option }))}
              />
            </div>
            <div className="min-w-36">
              <Select
                label="Profile"
                value={profileFilter}
                onChange={(e) => setProfileFilter(e.target.value as TriState)}
                options={[
                  { value: 'any', label: 'Any profile' },
                  { value: 'yes', label: 'Complete' },
                  { value: 'no', label: 'Incomplete profile' },
                ]}
              />
            </div>
            <div className="min-w-36">
              <Select
                label="Stay"
                value={stayFilter}
                onChange={(e) => setStayFilter(e.target.value as TriState)}
                options={[
                  { value: 'any', label: 'Any stay' },
                  { value: 'yes', label: 'In a block' },
                  { value: 'no', label: 'Not allotted' },
                ]}
              />
            </div>
            {/* An invisible label-height spacer, same trick the buttons below
                use: `TextInput`/`Select` are "label + gap + bordered field",
                so a bare button in the same `items-end` row sits a touch high
                and a touch short without one — matching height, matching
                (transparent) border, same baseline as every field beside it. */}
            <div className="flex flex-col gap-1">
              <span aria-hidden className="invisible text-sm font-medium">
                Search
              </span>
              <Button type="submit" className="border border-transparent">
                <Search size={15} strokeWidth={2.5} /> Search
              </Button>
            </div>
            {toolbarActive && (
              <div className="flex flex-col gap-1">
                <span aria-hidden className="invisible text-sm font-medium">
                  Clear
                </span>
                <Button variant="ghost" className="border border-transparent" onClick={clearToolbar}>
                  <X size={13} strokeWidth={2.5} /> Clear
                </Button>
              </div>
            )}
            <div className="ml-auto flex flex-col gap-1">
              <span aria-hidden className="invisible text-sm font-medium">
                View
              </span>
              <ViewToggle options={VIEW_OPTIONS} value={view} onChange={setView} />
            </div>
          </div>
          <p className="text-xs text-muted">
            Matched by the server, so a fest of thousands is never filtered in the browser. Profile
            and Stay narrow what came back.
          </p>
        </form>

        {refinementActive && participants !== null && (
          <p className="text-xs text-muted">
            {refined.length} of {participants.length} shown
          </p>
        )}

        {participants === null ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-12 rounded-xl" />
            ))}
          </div>
        ) : participants.length === 0 ? (
          <EmptyState
            icon={Users}
            title={query || house ? 'Nobody matches that' : 'No participants yet'}
            description={
              query || house
                ? 'Try a different search, or clear the filters.'
                : 'Accounts appear here as soon as people register.'
            }
          />
        ) : refined.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No matching participants"
            description="Try a different profile or stay filter."
          />
        ) : view === 'table' ? (
          <>
            <DataTable
              columns={columns}
              rows={paged.items}
              rowKey={(row) => row.participant_id}
              sort={sort}
              caption="Registered participants with house, stay, registrations, and profile status"
            />
            <TablePager paged={paged} noun="participants" />
          </>
        ) : (
          <>
            <ParticipantCards rows={paged.items} hostels={hostels} onEdit={beginEdit} />
            <TablePager paged={paged} noun="participants" />
          </>
        )}
      </div>
    </FestivalScreen>
  );
}
