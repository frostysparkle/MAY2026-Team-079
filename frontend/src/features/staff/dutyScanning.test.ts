import { attendanceState, loggingState, mayOpenScanner } from './dutyScanning';

describe('loggingState', () => {
  it('reads the mess/hostel logging flag', () => {
    expect(loggingState({ logging: true })).toBe('on');
    expect(loggingState({ logging: false })).toBe('off');
  });

  it('reads a missing flag or a missing member as unknown, never as off', () => {
    // `off` withholds the scanner link, so guessing it would strand a volunteer
    // whose scanner is in fact live.
    expect(loggingState({})).toBe('unknown');
    expect(loggingState(undefined)).toBe('unknown');
  });
});

describe('attendanceState', () => {
  it('reads the workshop attendance flag', () => {
    expect(attendanceState({ attendance: true })).toBe('on');
    expect(attendanceState({ attendance: false })).toBe('off');
  });

  it('reads unknown when `workshop_team` was projected out of the response', () => {
    expect(attendanceState({})).toBe('unknown');
    expect(attendanceState(undefined)).toBe('unknown');
  });
});

describe('mayOpenScanner', () => {
  it('offers the scanner unless scanning is definitely off', () => {
    expect(mayOpenScanner('on')).toBe(true);
    expect(mayOpenScanner('unknown')).toBe(true);
    expect(mayOpenScanner('off')).toBe(false);
  });
});
