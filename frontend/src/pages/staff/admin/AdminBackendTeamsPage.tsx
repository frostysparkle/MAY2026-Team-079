import { useCallback, useEffect, useMemo, useState } from 'react';
import { Briefcase, LayoutGrid, List, Plus, Trash2 } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { BackendTeamCreateRequest, BackendTeamMember } from '@/api/types';
import {
  ANY,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  ListToolbar,
  ResultBanner,
  SectionHeading,
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
import { NewStaffForm } from '@/features/staff/NewStaffForm';
import { StaffCards } from '@/features/staff/StaffCards';
import { StaffSummaryCards } from '@/features/staff/StaffSummaryCards';
import { useStaffColumns } from '@/features/staff/staffColumns';
import { buildStaffRows, summariseStaff, type StaffRow } from '@/features/staff/staffDirectory';

/**
 * Staff accounts: who has access to the staff area, what they are called, and
 * which department they belong to.
 *
 * The real backend provisions staff wholesale — it never promotes a participant —
 * so this creates and removes accounts outright.
 *
 * Laid out like `AdminHostelsPage` and `AdminMessPage`: headline figures, a search
 * and filter toolbar, and a paged list. It differs in one deliberate way. Those
 * two default to a table because their rows are numbers and a column of numbers
 * is what makes them comparable; a staff account is four short strings, so the
 * cards stay the default here and the table sits behind the view toggle for when
 * someone is scanning roles or departments down a column.
 *
 * The filter vocabularies are built from the data rather than hard-coded, because
 * `role` and `department` are free strings the backend does not validate.
 */

/** 10 rows keeps the list roughly one screen tall on a laptop. */
const PAGE_SIZE = 10;

const VIEW_OPTIONS: readonly ViewOption<'cards' | 'table'>[] = [
  { value: 'cards', label: 'Card view', icon: LayoutGrid },
  { value: 'table', label: 'Table view', icon: List },
];

/** Behind the "Filters" disclosure: whether the record is fully filled in. */
const DETAIL_SPEC: FilterSpec = {
  key: 'detail',
  label: 'Record detail',
  anyLabel: 'Any record',
  options: [
    { value: 'complete', label: 'Complete' },
    { value: 'incomplete', label: 'Needs detail' },
  ],
};

export default function AdminBackendTeamsPage() {
  const [team, setTeam] = useState<BackendTeamMember[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<StaffRow | null>(null);

  // The create form is collapsed until asked for: the list of accounts is what an
  // admin comes here to read. Its fields live in the form itself, so closing it is
  // all that is needed to forget a draft.
  const [showCreate, setShowCreate] = useState(false);

  // Clearing the error on success rather than up front keeps this free of a
  // synchronous setState when it runs as the mount effect.
  function load() {
    api
      .listBackendTeams()
      .then((all) => {
        setTeam(all);
        setLoadError(null);
      })
      .catch((e) =>
        setLoadError(e instanceof ApiClientError ? e.message : 'Could not load staff.'),
      );
  }
  useEffect(load, []);

  async function create(req: BackendTeamCreateRequest) {
    setActionError(null);
    setBusy(true);
    try {
      await api.createBackendTeam(req);
      // Only on success: a failed create keeps the form open with what was typed.
      setShowCreate(false);
      load();
    } catch (e) {
      setActionError(e instanceof ApiClientError ? e.message : 'Could not create staff member.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemove() {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await api.deleteBackendTeam(pendingDelete.id);
      setPendingDelete(null);
      load();
    } catch (e) {
      setActionError(e instanceof ApiClientError ? e.message : 'Could not delete staff member.');
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------------------------- filter / sort / page --- */

  const rows = useMemo(() => (team === null ? null : buildStaffRows(team)), [team]);
  const summary = useMemo(() => (rows === null ? null : summariseStaff(rows)), [rows]);

  // Roles and departments are whatever the backend has actually stored, so the
  // options come from the data rather than a hard-coded list that would drift.
  const specs: FilterSpec[] = useMemo(
    () => [
      {
        key: 'role',
        label: 'Filter by role',
        anyLabel: 'All Roles',
        options: (summary?.roles ?? []).map((role) => ({ value: role, label: role })),
      },
      {
        key: 'department',
        label: 'Filter by department',
        anyLabel: 'All Departments',
        options: (summary?.departments ?? []).map((dept) => ({ value: dept, label: dept })),
      },
    ],
    [summary],
  );

  const allSpecs = useMemo(() => [...specs, DETAIL_SPEC], [specs]);
  const filters = useListFilters(allSpecs);

  const visible = useMemo(() => {
    if (!rows) return [];
    const detail = filters.values[DETAIL_SPEC.key] ?? ANY;

    return rows.filter((row) => {
      if (!filters.matches('role', row.role)) return false;
      if (!filters.matches('department', row.department)) return false;

      if (detail === 'complete' && row.incomplete) return false;
      if (detail === 'incomplete' && !row.incomplete) return false;

      if (!filters.needle) return true;
      return `${row.email} ${row.id} ${row.designation} ${row.department} ${row.role}`
        .toLowerCase()
        .includes(filters.needle);
    });
  }, [rows, filters]);

  const sort = useTableSort('member');

  const actionsFor = useCallback(
    (row: StaffRow): ActionMenuItem[] => [
      {
        label: 'Remove',
        icon: Trash2,
        tone: 'danger',
        onSelect: () => setPendingDelete(row),
      },
    ],
    [],
  );

  const columns = useStaffColumns({ actionsFor });

  const sorted = useMemo(() => sortRows(visible, columns, sort), [visible, columns, sort]);

  const paged = usePagedList(sorted, {
    pageSize: PAGE_SIZE,
    resetKey: `${filters.signature}|${sort.signature}`,
  });

  const { view, setView } = useViewMode(VIEW_OPTIONS, 'cards');

  /* ------------------------------------------------------------- render --- */

  if (loadError) {
    return <ErrorState title="Could not load staff" description={loadError} onRetry={load} />;
  }

  const total = rows?.length ?? 0;

  return (
    <FestivalScreen
      title="Staff"
      subtitle={
        summary === null
          ? 'Loading the staff list…'
          : `${summary.accounts} account${summary.accounts === 1 ? '' : 's'} · ${summary.superAdmins} super admin${summary.superAdmins === 1 ? '' : 's'}`
      }
    >
      {actionError && (
        <ResultBanner variant="error" title="Action failed">
          {actionError}
        </ResultBanner>
      )}

      <StaffSummaryCards summary={summary} />

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <SectionHeading title="Accounts" meta={summary === null ? undefined : `${total}`} />
          {/* Hidden while the form is open — Cancel closes it from in there. */}
          {!showCreate && (
            <Button onClick={() => setShowCreate(true)} className="shrink-0 gap-1.5">
              <Plus size={15} strokeWidth={2.5} /> New Staff Account
            </Button>
          )}
        </div>

        {showCreate && (
          <NewStaffForm
            busy={busy}
            onCreate={(req) => void create(req)}
            onCancel={() => setShowCreate(false)}
          />
        )}

        {/* One panel holds the controls, the accounts, and the pager, so filtering
            and paging read as acting on the thing directly below them. */}
        <div className="flex flex-col gap-4 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-black/[0.03]">
          <ListToolbar
            filters={filters}
            specs={specs}
            advancedSpecs={[DETAIL_SPEC]}
            searchLabel="Search accounts"
            searchPlaceholder="Search by email, ID, designation, or department…"
            shown={visible.length}
            total={total}
            noun="accounts"
            trailing={<ViewToggle options={VIEW_OPTIONS} value={view} onChange={setView} />}
          />

          {rows === null ? (
            <div className="grid gap-3 lg:grid-cols-2" aria-busy="true">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-20 rounded-2xl" />
              ))}
            </div>
          ) : total === 0 ? (
            <EmptyState
              title="No staff accounts yet"
              description="Use “New Staff Account” to give someone access to the staff area."
              icon={Briefcase}
            />
          ) : visible.length === 0 ? (
            <EmptyState
              title="No matching accounts"
              description="Try a different search, or clear the filters."
              icon={Briefcase}
            />
          ) : view === 'table' ? (
            <DataTable
              columns={columns}
              rows={paged.items}
              rowKey={(row) => row.id}
              sort={sort}
              caption="Staff accounts with designation, department, and role"
            />
          ) : (
            <StaffCards rows={paged.items} actionsFor={actionsFor} />
          )}

          {rows !== null && visible.length > 0 && <TablePager paged={paged} noun="accounts" />}
        </div>
      </section>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Remove ${pendingDelete?.email}?`}
        description="They will immediately lose staff access. This cannot be undone."
        confirmLabel="Remove staff"
        loading={busy}
        onConfirm={confirmRemove}
        onCancel={() => setPendingDelete(null)}
      />
    </FestivalScreen>
  );
}
