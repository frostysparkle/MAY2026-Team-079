import { ApiClientError } from './ApiClient';
import { fieldPath, parseApiError } from './errors';

describe('fieldPath', () => {
  it('drops FastAPI’s request-part prefix', () => {
    expect(fieldPath(['body', 'team', 'min'])).toBe('team.min');
    expect(fieldPath(['query', 'limit'])).toBe('limit');
    expect(fieldPath(['path', 'event_id'])).toBe('event_id');
  });

  it('keeps a path that does not start with a request part', () => {
    expect(fieldPath(['team', 'min'])).toBe('team.min');
  });

  it('reads a whole-body error as the empty path rather than as "body"', () => {
    expect(fieldPath(['body'])).toBe('');
  });

  it('renders array indexes as they appear', () => {
    expect(fieldPath(['body', 'schedule', 0, 'round'])).toBe('schedule.0.round');
  });
});

describe('parseApiError', () => {
  it('uses a string detail as the message — every hand-raised HTTPException', () => {
    expect(
      parseApiError({ detail: 'Registration is closed for this event' }, 'Bad Request'),
    ).toEqual({ message: 'Registration is closed for this event', fieldErrors: [] });
  });

  it('falls back when the body has no usable detail', () => {
    expect(parseApiError({}, 'Bad Gateway').message).toBe('Bad Gateway');
    expect(parseApiError(null, 'Bad Gateway').message).toBe('Bad Gateway');
    expect(parseApiError({ detail: '   ' }, 'Bad Gateway').message).toBe('Bad Gateway');
    // A proxy's HTML page parses to nothing useful.
    expect(parseApiError('<html>502</html>', 'Bad Gateway').message).toBe('Bad Gateway');
  });

  it('reads a 422 validation array into field errors', () => {
    const parsed = parseApiError(
      {
        detail: [
          {
            loc: ['body', 'capacity'],
            msg: 'Input should be a valid integer',
            type: 'int_parsing',
          },
          { loc: ['body', 'name'], msg: 'Field required', type: 'missing' },
        ],
      },
      'Unprocessable Entity',
    );

    expect(parsed.fieldErrors).toEqual([
      { field: 'capacity', message: 'Input should be a valid integer' },
      { field: 'name', message: 'Field required' },
    ]);
    expect(parsed.message).toBe('2 fields need attention: capacity, name');
  });

  it('reads a single validation problem as a sentence, not a list of one', () => {
    const parsed = parseApiError(
      { detail: [{ loc: ['body', 'dob'], msg: 'Invalid date', type: 'date_parsing' }] },
      'Unprocessable Entity',
    );
    expect(parsed.message).toBe('dob: Invalid date');
    expect(parsed.fieldErrors).toHaveLength(1);
  });

  it('never produces "[object Object]" from an array detail', () => {
    // The exact regression this exists for: `detail` was typed as a string, so a
    // 422 stringified the array into the user's banner.
    const parsed = parseApiError(
      { detail: [{ loc: ['body', 'x'], msg: 'nope', type: 't' }] },
      'Unprocessable Entity',
    );
    expect(parsed.message).not.toContain('[object Object]');
  });

  it('ignores malformed entries in the array rather than throwing', () => {
    const parsed = parseApiError(
      { detail: [null, 'oops', { nope: true }] },
      'Unprocessable Entity',
    );
    expect(parsed.fieldErrors).toEqual([]);
    expect(parsed.message).toBe('Unprocessable Entity');
  });
});

describe('ApiClientError', () => {
  it('carries field errors and can be asked about one field', () => {
    const error = new ApiClientError(422, '2 fields need attention: a, b', [
      { field: 'a', message: 'Field required' },
      { field: 'b', message: 'Too long' },
    ]);
    expect(error.status).toBe(422);
    expect(error.fieldError('a')).toBe('Field required');
    expect(error.fieldError('missing')).toBeUndefined();
  });

  it('defaults to no field errors for every non-422 status', () => {
    const error = new ApiClientError(403, 'Not authorized');
    expect(error.fieldErrors).toEqual([]);
    expect(error.fieldError('anything')).toBeUndefined();
  });
});
