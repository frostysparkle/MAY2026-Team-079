import { readHostelScanFailure, readHostelScanSuccess } from './hostelScanOutcome';

describe('readHostelScanSuccess', () => {
  it('reports the state the action produced', () => {
    // Sound rather than a guess: the route refuses an entry for somebody already
    // inside, so a 200 on `entry` can only mean they are now inside.
    const entry = readHostelScanSuccess('entry', 'Scan successful, entry allowed');
    expect(entry.kind).toBe('logged');
    expect(entry.tone).toBe('success');
    expect(entry.title).toBe('Now Inside');
    expect(entry.state).toBe('inside');

    const exit = readHostelScanSuccess('exit', 'Scan successful, exit allowed');
    expect(exit.title).toBe('Now Outside');
    expect(exit.state).toBe('outside');
  });
});

describe('readHostelScanFailure', () => {
  it('treats "already inside" as a warning carrying the participant’s state', () => {
    const outcome = readHostelScanFailure('entry', 'Participant is already inside');
    expect(outcome.kind).toBe('already-inside');
    // Not an error: nobody is being turned away, the desk pressed the wrong side.
    expect(outcome.tone).toBe('warning');
    expect(outcome.title).toBe('Already Inside');
    expect(outcome.state).toBe('inside');
  });

  it('treats "already outside" the same way, with the opposite state', () => {
    const outcome = readHostelScanFailure('exit', 'Participant is already outside');
    expect(outcome.kind).toBe('already-outside');
    expect(outcome.tone).toBe('warning');
    expect(outcome.state).toBe('outside');
  });

  it('keeps "not allotted" a hard error, because that is somebody to turn away', () => {
    const outcome = readHostelScanFailure('entry', 'Participant not allotted to this hostel');
    expect(outcome.kind).toBe('not-allotted');
    expect(outcome.tone).toBe('error');
    expect(outcome.state).toBe('unknown');
  });

  it('names the invalid action, quoting what the desk sent', () => {
    const outcome = readHostelScanFailure('exit', "Invalid action. Must be 'entry' or 'exit'");
    expect(outcome.kind).toBe('invalid-action');
    expect(outcome.description).toContain('"exit"');
  });

  it('falls back to the server’s own words for anything unrecognised', () => {
    const outcome = readHostelScanFailure('entry', 'QR Code expired');
    expect(outcome.kind).toBe('unknown');
    expect(outcome.tone).toBe('error');
    expect(outcome.description).toBe('QR Code expired');
    // Must not claim a state it cannot know.
    expect(outcome.state).toBe('unknown');
  });

  it('is insensitive to case and whitespace', () => {
    expect(readHostelScanFailure('entry', '  PARTICIPANT IS ALREADY INSIDE  ').kind).toBe(
      'already-inside',
    );
  });
});
