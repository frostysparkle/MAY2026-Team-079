import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import { api } from '@/api';
import type { EventItem } from '@/api/types';
import { CHECKPOINT_TYPES, type CheckpointType } from '@/config/constants';
import { ROUTES } from '@/config/routes';
import { decodeQrPayload } from '@/features/qr/payload';
import type { PendingScan } from '@/features/scan/types';
import { Button, Select, TextInput } from '@/components/ui';
import { cn } from '@/lib/cn';

const READER_ID = 'qr-reader';
const CHECKPOINT_LABELS: Record<CheckpointType, string> = {
  event: 'Event',
  mess: 'Mess',
  hostel: 'Hostel',
  workshop: 'Workshop',
};

/**
 * Staff QR scanner. The organizer picks which checkpoint this device is scanning
 * for (that context is sent with verification — it is not in the QR). Unrelated
 * QR codes are ignored silently; if the camera is unavailable or denied, staff
 * fall back to manual entry (participant ID + the 6-digit code read aloud).
 */
export default function ScannerPage() {
  const navigate = useNavigate();
  const [checkpoint, setCheckpoint] = useState<CheckpointType>('event');
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Event attribution for attendance (Epic 3) — only relevant for the event
  // checkpoint. Populated from published events.
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventId, setEventId] = useState('');

  // Manual fallback fields.
  const [manualId, setManualId] = useState('');
  const [manualCode, setManualCode] = useState('');

  // Keep the latest checkpoint/event readable inside the scan callback without
  // restarting the camera each time they change.
  const checkpointRef = useRef(checkpoint);
  useEffect(() => {
    checkpointRef.current = checkpoint;
  }, [checkpoint]);
  const eventIdRef = useRef(eventId);
  useEffect(() => {
    eventIdRef.current = eventId;
  }, [eventId]);

  useEffect(() => {
    api
      .listEvents()
      .then((r) => {
        setEvents(r.events);
        setEventId((current) => current || r.events[0]?.id || '');
      })
      .catch(() => undefined);
  }, []);

  function goToResult(scan: PendingScan) {
    navigate(ROUTES.scanResult, { state: scan });
  }

  useEffect(() => {
    const scanner = new Html5Qrcode(READER_ID);
    let stopped = false;

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 220 },
        (decodedText) => {
          const payload = decodeQrPayload(decodedText);
          if (!payload) return; // ignore unrelated/invalid QR silently
          if (checkpointRef.current === 'event' && !eventIdRef.current) return;
          if (stopped) return;
          stopped = true;
          scanner
            .stop()
            .catch(() => undefined)
            .finally(() =>
              goToResult({
                participantId: payload.pid,
                currentCode: payload.code,
                checkpoint: checkpointRef.current,
                eventId:
                  checkpointRef.current === 'event' ? eventIdRef.current || undefined : undefined,
              }),
            );
        },
        () => undefined, // per-frame decode failures are normal; ignore
      )
      .catch(() =>
        setCameraError('Camera unavailable or permission denied. Use manual entry below.'),
      );

    return () => {
      stopped = true;
      scanner.stop().catch(() => undefined);
    };
    // Start the camera once on mount; checkpoint is read via ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col gap-5 p-4">
      <div>
        <h1 className="text-xl font-black tracking-tight text-ink">Scan Participant QR</h1>
        <p className="text-sm text-muted">Point the camera at the participant&apos;s digital ID.</p>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-ink">Checkpoint</p>
        <div className="flex gap-2 overflow-x-auto">
          {CHECKPOINT_TYPES.map((c) => (
            <button
              key={c}
              onClick={() => setCheckpoint(c)}
              aria-pressed={checkpoint === c}
              className={cn(
                'rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap',
                checkpoint === c ? 'bg-brand text-white' : 'bg-surface-2 text-muted',
              )}
            >
              {CHECKPOINT_LABELS[c]}
            </button>
          ))}
        </div>
      </div>

      {checkpoint === 'event' && (
        <Select
          label="Event"
          placeholder="Select an event"
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
          options={events.map((e) => ({ value: e.id, label: `${e.title} · ${e.eventDate}` }))}
        />
      )}

      {/* html5-qrcode renders the camera preview into this element. */}
      <div id={READER_ID} className="overflow-hidden rounded-xl bg-black/5" />

      {cameraError && (
        <p role="alert" className="text-sm text-danger">
          {cameraError}
        </p>
      )}

      <div className="flex flex-col gap-3 rounded-xl border border-dashed border-line p-4">
        <p className="text-sm font-medium text-ink">Manual entry (fallback)</p>
        <TextInput
          label="Participant ID"
          value={manualId}
          onChange={(e) => setManualId(e.target.value)}
        />
        <TextInput
          label="6-digit code"
          inputMode="numeric"
          value={manualCode}
          onChange={(e) => setManualCode(e.target.value)}
        />
        <Button
          disabled={
            !manualId.trim() ||
            manualCode.trim().length !== 6 ||
            (checkpoint === 'event' && !eventId)
          }
          onClick={() =>
            goToResult({
              participantId: manualId.trim(),
              currentCode: manualCode.trim(),
              checkpoint,
              eventId: checkpoint === 'event' ? eventId || undefined : undefined,
            })
          }
        >
          Verify manually
        </Button>
      </div>
    </main>
  );
}
