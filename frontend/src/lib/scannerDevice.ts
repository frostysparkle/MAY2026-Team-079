const STORAGE_KEY = 'pc_scanner_device_id';

function newDeviceId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Stable, non-secret browser identifier used only as one rate-limit dimension. */
export function getScannerDeviceId(): string {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const created = newDeviceId();
  localStorage.setItem(STORAGE_KEY, created);
  return created;
}
