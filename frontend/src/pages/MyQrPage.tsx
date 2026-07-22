import { DigitalIdCard } from '@/features/qr/DigitalIdCard';

/**
 * My QR ID. Thin wrapper around the shared DigitalIdCard — the identity is
 * generated entirely on-device from the cached per-checkpoint secret (no server
 * call on refresh) and works offline once the secret has been provisioned.
 */
export default function MyQrPage() {
  return (
    <div className="flex flex-col gap-5 p-4">
      <div>
        <h1 className="text-xl font-black tracking-tight text-ink">My Digital ID</h1>
        <p className="text-sm text-muted">Show this QR at the checkpoint to be scanned.</p>
      </div>
      <DigitalIdCard />
    </div>
  );
}
