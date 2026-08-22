/**
 * Turning a FastAPI error body into something a screen can show.
 *
 * Two jobs, both of which used to be missing:
 *
 *  1. `detail` is a string for every hand-raised `HTTPException` but an *array*
 *     for a 422 from request validation. The old reader assumed a string, so a
 *     422 rendered as `[object Object]`.
 *  2. Field-level errors need to survive as fields, not be flattened into one
 *     sentence, so a form can mark the input that is actually wrong.
 *
 * Pure and dependency-free, so both the client wrapper and its tests can use it.
 */
import type { FastApiErrorBody, FastApiValidationError } from './types';

/** One field that failed validation, ready to attach to an input. */
export interface FieldError {
  /** Dotted field path with FastAPI's request-part prefix removed, e.g. `team.min`. */
  field: string;
  message: string;
}

export interface ParsedApiError {
  /** What to show as the banner text. Never empty. */
  message: string;
  /** Present only for a 422. Empty array means "none could be read". */
  fieldErrors: FieldError[];
}

const REQUEST_PARTS = new Set(['body', 'query', 'path', 'header', 'cookie']);

/**
 * `["body","team","min"]` → `team.min`.
 *
 * `["body"]` → `''`: FastAPI always leads with the request part, so a `loc` of
 * just `body` means the body as a whole was rejected rather than a field named
 * "body". The empty path is how callers recognise that and show the message on
 * its own instead of against an input.
 */
export function fieldPath(loc: readonly (string | number)[]): string {
  const parts = [...loc];
  if (typeof parts[0] === 'string' && REQUEST_PARTS.has(parts[0])) {
    parts.shift();
  }
  return parts.join('.');
}

function isValidationError(value: unknown): value is FastApiValidationError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<FastApiValidationError>;
  return typeof candidate.msg === 'string' && Array.isArray(candidate.loc);
}

/**
 * Read a parsed error body into a message plus, for a 422, its field errors.
 *
 * `fallback` is used when the body carries nothing usable — a proxy's HTML error
 * page, an empty body, or a `detail` of an unexpected shape. Callers pass the
 * response's `statusText`.
 */
export function parseApiError(body: unknown, fallback: string): ParsedApiError {
  const detail = (body as FastApiErrorBody | null)?.detail;

  if (typeof detail === 'string' && detail.trim() !== '') {
    return { message: detail, fieldErrors: [] };
  }

  if (Array.isArray(detail)) {
    const fieldErrors = detail.filter(isValidationError).map((entry) => ({
      field: fieldPath(entry.loc),
      message: entry.msg,
    }));

    if (fieldErrors.length === 0) return { message: fallback, fieldErrors: [] };

    // A single problem reads better as a sentence than as a list of one.
    const message =
      fieldErrors.length === 1
        ? describe(fieldErrors[0])
        : `${fieldErrors.length} fields need attention: ${fieldErrors
            .map((error) => error.field || 'request')
            .join(', ')}`;

    return { message, fieldErrors };
  }

  return { message: fallback, fieldErrors: [] };
}

/** `team.min` + `Input should be a valid integer` → `team.min: Input should be…`. */
function describe(error: FieldError): string {
  return error.field ? `${error.field}: ${error.message}` : error.message;
}
