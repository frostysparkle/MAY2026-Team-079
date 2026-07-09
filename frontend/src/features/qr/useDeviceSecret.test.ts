import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDeviceSecret } from './useDeviceSecret';
import { mockApi } from '@/api/mock/mockApi';
import { clearSecrets } from '@/lib/secretStore';

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

describe('useDeviceSecret', () => {
  beforeEach(async () => {
    setOnline(true);
    await clearSecrets();
    // A signed-in participant is required for provisioning.
    await mockApi.loginWithGoogle({ idToken: 'student@mg.study.iitm.ac.in' });
  });
  afterEach(() => setOnline(true));

  it('provisions a secret online, then serves it from cache when offline', async () => {
    const first = renderHook(() => useDeviceSecret('event'));
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    expect(first.result.current.secret).toBeTruthy();

    // Go offline and mount again for the same checkpoint — must load from cache.
    setOnline(false);
    const second = renderHook(() => useDeviceSecret('event'));
    await waitFor(() => expect(second.result.current.status).toBe('ready'));
    expect(second.result.current.secret).toBe(first.result.current.secret);
  });

  it('errors when a checkpoint has no cached secret and the device is offline', async () => {
    setOnline(false);
    const { result } = renderHook(() => useDeviceSecret('hostel'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toMatch(/Connect to the internet/i);
  });
});
