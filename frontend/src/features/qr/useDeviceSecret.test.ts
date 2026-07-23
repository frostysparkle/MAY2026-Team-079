import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDeviceSecret } from './useDeviceSecret';
import { api } from '@/api';
import type { ProvisionSecretResponse } from '@/api/types';
import { clearSecrets } from '@/lib/secretStore';

// Provisioning is a real backend call; here we stub it and let the encrypted
// IndexedDB secret store (fake-indexeddb) exercise the real caching path.
vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api/ApiClient')>('@/api/ApiClient');
  return { ApiClientError: actual.ApiClientError, api: { provisionSecret: vi.fn() } };
});

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

describe('useDeviceSecret', () => {
  beforeEach(async () => {
    setOnline(true);
    await clearSecrets();
    vi.mocked(api.provisionSecret).mockReset();
    vi.mocked(api.provisionSecret).mockResolvedValue({
      participantId: 'p_1',
      checkpointContext: 'event',
      secretBase32: 'JBSWY3DPEHPK3PXP',
    } as ProvisionSecretResponse);
  });
  afterEach(() => setOnline(true));

  it('provisions a secret online, then serves it from cache when offline', async () => {
    const first = renderHook(() => useDeviceSecret('event', 'e_keynote'));
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    expect(first.result.current.secret).toBeTruthy();
    expect(api.provisionSecret).toHaveBeenCalledTimes(1);

    // Go offline and mount again for the same checkpoint — must load from cache
    // without hitting the network again.
    setOnline(false);
    const second = renderHook(() => useDeviceSecret('event', 'e_keynote'));
    await waitFor(() => expect(second.result.current.status).toBe('ready'));
    expect(second.result.current.secret).toBe(first.result.current.secret);
    expect(api.provisionSecret).toHaveBeenCalledTimes(1);
  });

  it('errors when a checkpoint has no cached secret and the device is offline', async () => {
    setOnline(false);
    const { result } = renderHook(() => useDeviceSecret('hostel'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toMatch(/Connect to the internet/i);
    expect(api.provisionSecret).not.toHaveBeenCalled();
  });
});
