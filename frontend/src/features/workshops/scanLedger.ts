import type { WorkshopBooking } from './workshopRoster';

/**
 * Every workshop scan made on this device, kept so the volunteer who made them
 * can still see and export them.
 *
 * This exists because of one gap in the API: `GET /workshops/{id}/logs` is Super
 * Admin-only, so the volunteer at the door — the person who created those very
 * rows — cannot read them back. Without a local record, their dashboard could
 * show counts from `GET /workshops` and not a single name, and the two exports the
 * brief asks for (on-spot admissions, and registered students who attended)
 * would be empty for exactly the role that needs them.
 *
 * It is a *record of scans this device made*, not a copy of the roster: it can
 * never know about somebody scanned at another desk, and the dashboard labels it
 * as such. When the log is readable, the log wins — see `mergeDeviceScans`.
 *
 * Persisted rather than in-memory (unlike `registrationCache`) because a phone
 * at a workshop door gets locked, backgrounded, and reloaded through a two-hour
 * session, and losing the morning's admissions to a refresh would be worse than
 * useless.
 */

const STORAGE_KEY = 'pc_workshop_scans_v1';

/** Keeps one workshop's history bounded; a room holds 100-odd people. */
const MAX_ROWS_PER_WORKSHOP = 400;

/** What the backend said about the scan. Only an admission counts as attendance. */
export type ScanOutcome = 'admitted' | 'already-present' | 'refused';

export interface ScanLedgerRow {
  participantId: string;
  scanType: WorkshopBooking;
  /** ISO timestamp, taken on this device when the scan resolved. */
  at: string;
  /** The staff id that was signed in. */
  scannedBy: string | null;
  outcome: ScanOutcome;
  /** The backend's message or error detail, verbatim. */
  message: string;
}

type LedgerFile = Record<string, ScanLedgerRow[]>;

function readFile(): LedgerFile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as LedgerFile;
  } catch {
    // Unreadable or unavailable storage degrades to "no local history" rather
    // than taking the scanner down with it.
    return {};
  }
}

function writeFile(file: LedgerFile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(file));
  } catch {
    /* private mode, or quota — nothing to do but carry on scanning */
  }
}

/** Rows for one workshop, oldest first. */
export function readScanLedger(workshopId: string): ScanLedgerRow[] {
  const rows = readFile()[workshopId];
  return Array.isArray(rows) ? rows.filter(isRow) : [];
}

function isRow(value: unknown): value is ScanLedgerRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<ScanLedgerRow>;
  return typeof row.participantId === 'string' && typeof row.at === 'string';
}

/**
 * Record one scan. A repeat scan of the same person in the same mode replaces the
 * earlier row instead of adding a second, so the ledger stays one row per person
 * per mode — which is what makes its length a headcount rather than a tap count.
 */
export function recordScan(workshopId: string, row: ScanLedgerRow): void {
  const file = readFile();
  const existing = (Array.isArray(file[workshopId]) ? file[workshopId] : []).filter(
    (r) => isRow(r) && !(r.participantId === row.participantId && r.scanType === row.scanType),
  );
  file[workshopId] = [...existing, row].slice(-MAX_ROWS_PER_WORKSHOP);
  writeFile(file);
}

/**
 * The scans that actually admitted somebody, in the shape `mergeDeviceScans`
 * takes. A refusal (not pre-registered, on-spot cap reached, expired QR) is kept
 * in the ledger for the volunteer to see but is not attendance, so it never
 * reaches the roster.
 */
export function ledgerAdmissions(
  workshopId: string,
): { participantId: string; scanType: WorkshopBooking; at: string; scannedBy?: string }[] {
  return readScanLedger(workshopId)
    .filter((row) => row.outcome === 'admitted' || row.outcome === 'already-present')
    .map((row) => ({
      participantId: row.participantId,
      scanType: row.scanType,
      at: row.at,
      scannedBy: row.scannedBy ?? undefined,
    }));
}

/** Forget one workshop's local history — offered on the dashboard, never automatic. */
export function clearScanLedger(workshopId: string): void {
  const file = readFile();
  delete file[workshopId];
  writeFile(file);
}
