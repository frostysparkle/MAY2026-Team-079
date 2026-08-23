import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Eye,
  LayoutGrid,
  List,
  Plus,
  RefreshCw,
  Shuffle,
  UtensilsCrossed,
} from 'lucide-react';
import { api } from '@/api';
import { reportApiError } from '@/api/report';
import type { MessCreateRequest } from '@/api/types';
import {
  ANY,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  ListToolbar,
  ResultBanner,
  Skeleton,
  TablePager,
  ViewToggle,
  sortRows,
  useListFilters,
  usePagedList,
  useTableSort,
  useViewMode,
  type ActionMenuItem,
  type FilterSpec,
  type ViewOption,
} from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import { MESS_CUISINE_OPTIONS } from '@/config/constants';
import { path, ROUTES } from '@/config/routes';
import { MessCards } from '@/features/mess/MessCards';
import { MessDetailDialog } from '@/features/mess/MessDetailDialog';
import { MessSummaryCards } from '@/features/mess/MessSummaryCards';
import { NewMessForm } from '@/features/mess/NewMessForm';
import { useMessColumns } from '@/features/mess/messColumns';
import { type MessRow } from '@/features/mess/messOccupancy';
import { useMessInventory } from '@/features/mess/useMessInventory';
import { OCCUPANCY_STATUS, type OccupancyStatus } from '@/features/occupancy';

/**
 * Mess halls: the campus catering inventory as a set of headline figures over a
 * sortable, filterable table.
 *
 * This replaced a grid of cards that each carried their own team roster, an "add
 * team member" field, and a button to fetch that hall's statistics. The figures an
 * admin comes here for — how many seats exist, how they split across veg,
 * non-veg, and jain, which halls still have room — were only visible one hall at
 * a time, and only after clicking. Occupancy is now loaded for every hall up
 * front (see `useMessInventory`) and laid out in columns that can be compared and
 * sorted, while per-hall management moved into the row's detail dialog.
 *
 * Deliberately the same shape as `AdminHostelsPage`: the two sections answer the
 * same questions about the same kind of inventory, and an admin who has learned
 * one should not have to learn the other. The occupancy arithmetic they share
 * lives in `features/occupancy`.
 *
 * Creating a hall and running allocation are unchanged.
 */

/** 10 rows keeps the table roughly one screen tall on a laptop. */
const PAGE_SIZE = 10;

const VIEW_OPTIONS: readonly ViewOption<'table' | 'cards'>[] = [
  { value: 'cards', label: 'Card view', icon: LayoutGrid },
  { value: 'table', label: 'Table view', icon: List },
];

// Filter labels are visually hidden, and deliberately not bare nouns: "Preference"
// alone would collide with the create form's own Preference field for anyone
// navigating by label, and read as a field to fill in rather than a filter.
const TYPE_SPEC: FilterSpec = {
  key: 'type',
  label: 'Filter by type',
  anyLabel: 'All Type',
  options: [
    { value: 'veg', label: 'Veg' },
    { value: 'non_veg', label: 'Non-Veg' },
    { value: 'jain', label: 'Jain' },
    { value: 'other', label: 'Unspecified' },
  ],
};

const STATUS_SPEC: FilterSpec = {
  key: 'status',
  label: 'Filter by status',
  anyLabel: 'All Status',
  options: (Object.keys(OCCUPANCY_STATUS) as OccupancyStatus[]).map((value) => ({
    value,
    label: OCCUPANCY_STATUS[value].label,
  })),
};

/** Behind the "Filters" disclosure: the regional menu and who staffs the hall. */
const REGION_SPEC: FilterSpec = {
  key: 'region',
  label: 'Region',
  anyLabel: 'Any region',
  options: [
    ...MESS_CUISINE_OPTIONS,
    // Halls with nothing declared are worth being able to find: that is usually
    // a gap in the catalogue rather than a deliberate choice.
    { value: 'none', label: 'None declared' },
  ],
};

const TEAM_SPEC: FilterSpec = {
  key: 'team',
  label: 'Staffing',
  anyLabel: 'Any staffing',
  options: [
    { value: 'staffed', label: 'Has a team' },
    { value: 'unstaffed', label: 'No team yet' },
    { value: 'scanning', label: 'Scanning enabled' },
  ],
};

const SPECS = [TYPE_SPEC, STATUS_SPEC];
const ADVANCED_SPECS = [REGION_SPEC, TEAM_SPEC];
const ALL_SPECS = [...SPECS, ...ADVANCED_SPECS];

export default function AdminMessPage() {
  const inventory = useMessInventory();
  const navigate = useNavigate();

  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  // The create form is collapsed until asked for: the list of halls is what an
  // admin comes here to read. Its fields live in the form itself, so closing it is
  // all that is needed to forget a draft.
  const [showCreate, setShowCreate] = useState(false);

  /* ------------------------------------------------------------ actions --- */

  /** Run an action, surface its failure, and re-read whatever it changed. */
  async function run(work: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    try {
      await work();
      await inventory.load();
    } catch (e) {
      setActionError(reportApiError(e, fallback));
    } finally {
      setBusy(false);
    }
  }

  async function create(req: MessCreateRequest) {
    setActionError(null);
    setBusy(true);
    try {
      await api.createMess(req);
      // Only on success: a failed create keeps the form open with what was typed.
      setShowCreate(false);
      await inventory.load();
    } catch (e) {
      setActionError(reportApiError(e, 'Could not create mess.'));
    } finally {
      setBusy(false);
    }
  }

  async function allocate() {
    setBusy(true);
    try {
      const res = await api.allocateMess();
      setActionError(res.message);
      // Allocation moves participants into halls, so every figure just changed.
      await inventory.load();
    } catch (e) {
      setActionError(reportApiError(e, 'Could not allocate.'));
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------------------------- filter / sort / page --- */

  const filters = useListFilters(ALL_SPECS);

  const visible = useMemo(() => {
    if (!inventory.rows) return [];
    const region = filters.values[REGION_SPEC.key] ?? ANY;
    const staffing = filters.values[TEAM_SPEC.key] ?? ANY;

    return inventory.rows.filter((row) => {
      if (!filters.matches(TYPE_SPEC.key, row.diet)) return false;
      if (!filters.matches(STATUS_SPEC.key, row.status)) return false;

      if (region === 'none' && row.cuisine !== null) return false;
      if (region !== ANY && region !== 'none' && row.cuisine !== region) return false;

      if (staffing === 'staffed' && !row.staffed) return false;
      if (staffing === 'unstaffed' && row.staffed) return false;
      if (staffing === 'scanning' && !row.scanning) return false;

      if (!filters.needle) return true;
      return `${row.name} ${row.id} ${row.typeLabel} ${row.cuisineLabel ?? ''}`
        .toLowerCase()
        .includes(filters.needle);
    });
  }, [inventory.rows, filters]);

  // Measures default to "worst first": the useful question is which halls are
  // fullest, not which are emptiest. Names default A→Z.
  const sort = useTableSort('hall', {
    capacity: 'desc',
    occupancy: 'desc',
    available: 'desc',
    percent: 'desc',
  });

  const openDetail = useCallback((row: MessRow) => setDetailId(row.id), []);

  const actionsFor = useCallback(
    (row: MessRow): ActionMenuItem[] => [
      { label: 'View details', icon: Eye, onSelect: () => setDetailId(row.id) },
      // Super Admins reach any hall's menu desk; its own team reaches it from
      // their duty list. Same screen, same edits — only the way in differs.
      {
        label: 'Edit menu',
        icon: BookOpen,
        onSelect: () => navigate(path(ROUTES.messMenu, { messId: row.id })),
      },
      {
        label: 'Refresh occupancy',
        icon: RefreshCw,
        onSelect: () => void inventory.refreshOne(row.id),
      },
    ],
    [inventory, navigate],
  );

  const columns = useMessColumns({ onView: openDetail, actionsFor });

  const sorted = useMemo(() => sortRows(visible, columns, sort), [visible, columns, sort]);

  const paged = usePagedList(sorted, {
    pageSize: PAGE_SIZE,
    resetKey: `${filters.signature}|${sort.signature}`,
  });

  const { view, setView } = useViewMode(VIEW_OPTIONS, 'table');

  /* ------------------------------------------------------------- render --- */

  if (inventory.error) {
    return (
      <ErrorState
        title="Could not load mess"
        description={inventory.error}
        onRetry={() => void inventory.load()}
      />
    );
  }

  const total = inventory.rows?.length ?? 0;
  const detailRow = inventory.rows?.find((row) => row.id === detailId) ?? null;

  return (
    <FestivalScreen
      title="Mess"
      subtitle={
        inventory.summary === null
          ? 'Loading the mess halls…'
          : `${inventory.summary.halls} hall${inventory.summary.halls === 1 ? '' : 's'} · ${inventory.summary.seats.toLocaleString()} total seats`
      }
      actions={
        <>
          {/* Hidden while the form is open — Cancel closes it from in there. */}
          {!showCreate && (
            <Button onClick={() => setShowCreate(true)} className="gap-1.5">
              <Plus size={15} strokeWidth={2.5} /> New Mess
            </Button>
          )}
          <Button variant="secondary" loading={busy} onClick={allocate} className="gap-1.5">
            <Shuffle size={14} /> Allocate unassigned participants
          </Button>
        </>
      }
    >
      {actionError && (
        <ResultBanner variant="warning" title="Notice">
          {actionError}
        </ResultBanner>
      )}

      <MessSummaryCards summary={inventory.loading ? null : inventory.summary} />

      {showCreate && (
        <NewMessForm
          busy={busy}
          onCreate={(req) => void create(req)}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* One panel holds the controls, the rows, and the pager, so filtering and
          paging read as acting on the thing directly below them. */}
      <section className="flex flex-col gap-4 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-black/[0.03]">
        <ListToolbar
          filters={filters}
          specs={SPECS}
          advancedSpecs={ADVANCED_SPECS}
          searchLabel="Search mess halls"
          searchPlaceholder="Search mess halls by name or ID…"
          shown={visible.length}
          total={total}
          noun="mess halls"
          trailing={<ViewToggle options={VIEW_OPTIONS} value={view} onChange={setView} />}
        />

        {inventory.loading ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : total === 0 ? (
          <EmptyState
            title="No mess halls yet"
            description="Use “New Mess” to add one, then assign the staff who scan for it."
            icon={UtensilsCrossed}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title="No matching mess halls"
            description="Try a different search, or clear the filters."
            icon={UtensilsCrossed}
          />
        ) : view === 'table' ? (
          <DataTable
            columns={columns}
            rows={paged.items}
            rowKey={(row) => row.id}
            sort={sort}
            caption="Mess halls with dietary type, regional menu, capacity, and occupancy"
          />
        ) : (
          <MessCards rows={paged.items} onView={openDetail} actionsFor={actionsFor} />
        )}

        {!inventory.loading && visible.length > 0 && <TablePager paged={paged} noun="mess halls" />}
      </section>

      {detailRow && (
        <MessDetailDialog
          row={detailRow}
          stat={inventory.stats[detailRow.id]}
          loading={inventory.loading}
          busy={busy}
          onClose={() => setDetailId(null)}
          onAssignTeam={(userId, role) =>
            void run(
              () => api.assignMessTeam(detailRow.id, { user_id: userId, role }),
              'Could not assign team member.',
            )
          }
          onToggleScan={(userId, logging) =>
            void run(
              () => api.toggleMessScan(detailRow.id, userId, logging),
              'Could not toggle scanning.',
            )
          }
        />
      )}
    </FestivalScreen>
  );
}
