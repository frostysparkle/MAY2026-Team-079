import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { saveSecret, loadSecret, clearSecrets } from './secretStore';

describe('secretStore', () => {
  it('round-trips an encrypted secret through IndexedDB', async () => {
    await saveSecret('event', 'JBSWY3DPEHPK3PXP');
    expect(await loadSecret('event')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('keeps secrets isolated per checkpoint context', async () => {
    await saveSecret('mess', 'AAAAAAAAAAAAAAAA');
    await saveSecret('hostel', 'BBBBBBBBBBBBBBBB');
    expect(await loadSecret('mess')).toBe('AAAAAAAAAAAAAAAA');
    expect(await loadSecret('hostel')).toBe('BBBBBBBBBBBBBBBB');
  });

  it('returns null for a context with no stored secret and after clearing', async () => {
    await saveSecret('workshop', 'CCCCCCCCCCCCCCCC');
    await clearSecrets();
    expect(await loadSecret('workshop')).toBeNull();
  });
});
