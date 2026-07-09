/**
 * QR payload format. The QR encodes only { participant_id, current_code } — never
 * the secret, and never the checkpoint context (the organizer app supplies that
 * at scan time). Kept compact and versioned for forward compatibility.
 */
export interface QrPayload {
  pid: string; // participant id
  code: string; // current 6-digit TOTP code
}

export function encodeQrPayload(payload: QrPayload): string {
  return JSON.stringify({ v: 1, ...payload });
}

/** Parse a scanned string. Returns null for anything that isn't our payload. */
export function decodeQrPayload(raw: string): QrPayload | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (typeof obj.pid === 'string' && typeof obj.code === 'string') {
      return { pid: obj.pid, code: obj.code };
    }
    return null;
  } catch {
    return null;
  }
}
