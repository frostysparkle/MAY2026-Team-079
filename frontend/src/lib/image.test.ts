import { describe, it, expect } from 'vitest';
import { validatePhoto } from './image';

function makeFile(type: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], 'photo', { type });
}

describe('validatePhoto', () => {
  it('accepts a small JPG', () => {
    expect(validatePhoto(makeFile('image/jpeg', 1024))).toBeNull();
  });

  it('rejects a non-image type', () => {
    expect(validatePhoto(makeFile('application/pdf', 1024))).toMatch(/JPG or PNG/);
  });

  it('rejects a file over the size limit', () => {
    expect(validatePhoto(makeFile('image/png', 800 * 1024))).toMatch(/KB or smaller/);
  });
});
