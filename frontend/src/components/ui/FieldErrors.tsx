import type { FieldError } from '@/api/errors';

/**
 * The per-field problems from a 422, listed under the failure banner.
 *
 * FastAPI's request-validation errors are the only errors in this API that name
 * *which* input is wrong. Before this they were flattened into the banner's one
 * line — and, while `detail` was mistyped as a string, into the literal text
 * `[object Object]`. Listing them is the difference between "the request was
 * invalid" and "capacity has to be a whole number".
 *
 * Renders nothing when there are none, so a caller can drop it in beside any
 * error banner without checking first.
 */
export function FieldErrors({ errors }: { errors: readonly FieldError[] }) {
  if (errors.length === 0) return null;

  return (
    <ul className="flex flex-col gap-1">
      {errors.map((error, index) => (
        <li key={`${error.field}-${index}`} className="text-sm">
          {error.field ? (
            <>
              <span className="font-semibold">{humaniseField(error.field)}</span>
              {`: ${error.message}`}
            </>
          ) : (
            error.message
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * `team.min` → `Team min`; `course_stage` → `Course stage`.
 *
 * Not exported: this file would then export a non-component alongside one, which
 * breaks fast refresh for it.
 */
function humaniseField(field: string): string {
  const words = field.replace(/[._]/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : field;
}
