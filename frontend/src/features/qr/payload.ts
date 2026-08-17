import type { ScanQRRequest } from '@/api/types';

/** Encode the full ScanQRRequest as the QR's raw text payload. */
export function encodeQrPayload(req: ScanQRRequest): string {
  return JSON.stringify(req);
}

/** Parse a scanned string. Returns null for anything that isn't our payload. */
export function decodeQrPayload(raw: string): ScanQRRequest | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof obj.participant_id === 'string' &&
      typeof obj.data === 'string' &&
      typeof obj.timestamp === 'string'
    ) {
      return { participant_id: obj.participant_id, data: obj.data, timestamp: obj.timestamp };
    }
    return null;
  } catch {
    return null;
  }
}
