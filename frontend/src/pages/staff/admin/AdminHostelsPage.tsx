import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Eye, LayoutGrid, List, Plus, RefreshCw, ScanLine, Shuffle } from 'lucide-react';
import { api } from '@/api';
import { reportApiError } from '@/api/report';
import type { HostelCreateRequest } from '@/api/types';
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
import { path, ROUTES } from '@/config/routes';
import { HostelCards } from '@/features/hostels/HostelCards';
import { HostelDetailDialog } from '@/features/hostels/HostelDetailDialog';
import { HostelSummaryCards } from '@/features/hostels/HostelSummaryCards';
import { NewHostelForm } from '@/features/hostels/NewHostelForm';
import { useHostelColumns } from '@/features/hostels/hostelColumns';
import { type HostelRow } from '@/features/hostels/hostelOccupancy';
import { OCCUPANCY_STATUS, type OccupancyStatus } from '@/features/occupancy';
import { useHostelInventory } from '@/features/hostels/useHostelInventory';

/**
 * Hostels: the campus inventory as a set of headline figures over a sortable,
 * filterable table of blocks.
 *
 * This replaced a grid of 22 cards that each carried their own team roster, an
 * "add team member" field, and a button to fetch that block's statistics. The
 * figures an admin actually comes here for — how full is the campus, which blocks
 * still have beds — were only visible one block at a time, and only after
 * clicking. Occupancy is now loaded for every block up front (see
 * `useHostelInventory`) and laid out in columns that can be compared and sorted,
 * while per-block management moved into the row's detail dialog.
 *
 * Creating a block and running allocation are unchanged.
 */

/** 10 rows keeps the table roughly one screen tall on a laptop. */
const PAGE_SIZE = 10;

const VIEW_OPTIONS: readonly ViewOption<'table' | 'cards'>[] = [
  { value: 'cards', label: 'Card view', icon: LayoutGrid },
  { value: 'table', label: 'Table view', icon: List },
];

// Filter labels are visually hidden, and deliberately not bare nouns: "Gender"
// alone would collide with the create form's own Gender field for anyone
// navigating by label, and read as a field to fill in rather than a filter.
const GENDER_SPEC: FilterSpec = {
  key: 'gender',
  label: 'Filter by gender',
  anyLabel: 'All Gender',
  options: [
    { value: 'men', label: "Men's" },
    { value: 'women', label: "Women's" },
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

/** Behind the "Filters" disclosure: who staffs the block, not how full it is. */
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

const SPECS = [GENDER_SPEC, STATUS_SPEC];
const ADVANCED_SPECS = [TEAM_SPEC];
const ALL_SPECS = [...SPECS, ...ADVANCED_SPECS];

export default function AdminHostelsPage() {
  const navigate = useNavigate();
  const inventory = useHostelInventory();

  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  // The create form is collapsed until asked for: the list is what an admin
  // comes here to read, and 22 blocks already fill the screen. Its fields live in
  // the form itself, so closing it is all that is needed to forget a draft.
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

  async function create(req: HostelCreateRequest) {
    setActionError(null);
    setBusy(true);
    try {
      await api.createHostel(req);
      // Only on success: a failed create keeps the form open with what was typed.
      setShowCreate(false);
      await inventory.load();
    } catch (e) {
      setActionError(reportApiError(e, 'Could not create hostel.'));
    } finally {
      setBusy(false);
    }
  }

  async function allocate() {
    setBusy(true);
    try {
      const res = await api.allocateHostels();
      setActionError(res.message);
      // Allocation moves participants into blocks, so every figure just changed.
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
    const staffing = filters.values[TEAM_SPEC.key] ?? ANY;

    return inventory.rows.filter((row) => {
      if (!filters.matches(GENDER_SPEC.key, row.category)) return false;
      if (!filters.matches(STATUS_SPEC.key, row.status)) return false;

      if (staffing === 'staffed' && !row.staffed) return false;
      if (staffing === 'unstaffed' && row.staffed) return false;
      if (staffing === 'scanning' && !row.scanning) return false;

      if (!filters.needle) return true;
      return `${row.name} ${row.id} ${row.categoryLabel}`.toLowerCase().includes(filters.needle);
    });
  }, [inventory.rows, filters]);

  // Measures default to "worst first": the useful question is which blocks are
  // fullest, not which are emptiest. Names default A→Z.
  const sort = useTableSort('hostel', {
    capacity: 'desc',
    occupancy: 'desc',
    available: 'desc',
    percent: 'desc',
  });

  const openDetail = useCallback((row: HostelRow) => setDetailId(row.id), []);

  const actionsFor = useCallback(
    (row: HostelRow): ActionMenuItem[] => [
      { label: 'View details', icon: Eye, onSelect: () => setDetailId(row.id) },
      {
        label: 'Refresh occupancy',
        icon: RefreshCw,
        onSelect: () => void inventory.refreshOne(row.id),
      },
      {
        label: 'Open scanner',
        icon: ScanLine,
        onSelect: () => navigate(path(ROUTES.scanHostel, { hostelId: row.id })),
      },
    ],
    [inventory, navigate],
  );

  const columns = useHostelColumns({ onView: openDetail, actionsFor });

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
        title="Could not load hostels"
        description={inventory.error}
        onRetry={() => void inventory.load()}
      />
    );
  }

  const total = inventory.rows?.length ?? 0;
  const detailRow = inventory.rows?.find((row) => row.id === detailId) ?? null;

  return (
    <FestivalScreen
      title="Hostels"
      // "blocks", not "hostels": the table's own footer counts hostels, and two
      // counts of the same thing in the same words invite them to disagree.
      subtitle={
        inventory.summary === null
          ? 'Loading the hostels…'
          : `${inventory.summary.hostels} block${inventory.summary.hostels === 1 ? '' : 's'} · ${inventory.summary.beds.toLocaleString()} beds`
      }
      actions={
        <>
          {/* Hidden while the form is open — Cancel closes it from in there. */}
          {!showCreate && (
            <Button onClick={() => setShowCreate(true)} className="gap-1.5">
              <Plus size={15} strokeWidth={2.5} /> New Hostel
            </Button>
          )}
          <Button variant="secondary" loading={busy} onClick={allocate} className="gap-1.5">
            <Shuffle size={14} /> Allocate registered participants
          </Button>
        </>
      }
    >
      {actionError && (
        <ResultBanner variant="warning" title="Notice">
          {actionError}
        </ResultBanner>
      )}

      <HostelSummaryCards summary={inventory.loading ? null : inventory.summary} />

      {showCreate && (
        <NewHostelForm
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
          searchLabel="Search hostels"
          searchPlaceholder="Search hostels by name or ID…"
          shown={visible.length}
          total={total}
          noun="hostels"
          trailing={<ViewToggle options={VIEW_OPTIONS} value={view} onChange={setView} />}
        />

        {inventory.loading ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            {Array.from({ length: PAGE_SIZE }, (_, i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : total === 0 ? (
          <EmptyState
            title="No hostels yet"
            description="Use “New Hostel” to add one, then assign the staff who scan entry and exit."
            icon={Building2}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title="No matching hostels"
            description="Try a different search, or clear the filters."
            icon={Building2}
          />
        ) : view === 'table' ? (
          <DataTable
            columns={columns}
            rows={paged.items}
            rowKey={(row) => row.id}
            sort={sort}
            caption="Hostel blocks with capacity, occupancy, and available beds"
          />
        ) : (
          <HostelCards rows={paged.items} onView={openDetail} actionsFor={actionsFor} />
        )}

        {!inventory.loading && visible.length > 0 && <TablePager paged={paged} noun="hostels" />}
      </section>

      {detailRow && (
        <HostelDetailDialog
          row={detailRow}
          stat={inventory.stats[detailRow.id]}
          loading={inventory.loading}
          busy={busy}
          onClose={() => setDetailId(null)}
          onAssignTeam={(userId, role) =>
            void run(
              () => api.assignHostelTeam(detailRow.id, { user_id: userId, role }),
              'Could not assign team member.',
            )
          }
          onToggleScan={(userId, logging) =>
            void run(
              () => api.toggleHostelScan(detailRow.id, userId, logging),
              'Could not toggle scanning.',
            )
          }
          onOpenScanner={() => navigate(path(ROUTES.scanHostel, { hostelId: detailRow.id }))}
        />
      )}
    </FestivalScreen>
  );
}
