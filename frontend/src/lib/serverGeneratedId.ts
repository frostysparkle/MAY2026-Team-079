/**
 * A stand-in for an id that the server mints itself.
 *
 * `POST /mess`, `POST /workshops` and `POST /events` each generate their own id
 * — `MESS111`, `WKSP111`, `EVTEC1111` — and overwrite whatever the request body
 * carried. Nothing an admin types has ever reached the stored record.
 *
 * Their request schemas nonetheless declare `mess_id` / `workshop_id` /
 * `event_id` as required strings, so dropping the key outright is a 422 rather
 * than a server-assigned id. The create forms therefore stopped *asking* for an
 * id and send this instead.
 *
 * Derived from the name rather than a constant or a random string because two of
 * the three handlers pass the request's id straight to `log_audit` as the audit
 * target. A slug leaves those rows traceable to the thing that was created;
 * a fixed placeholder on every row would not.
 */
export function serverGeneratedIdPlaceholder(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  // A name made only of punctuation would slug to nothing. The field is typed as
  // a plain `str`, so "" would pass validation and land in an audit row blank.
  return slug || 'pending';
}
