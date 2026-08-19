/**
 * Session-only cache of this participant's successful workshop registrations,
 * used purely as a UX hint for greying out slot conflicts in the list. There
 * is no `GET /workshops/my_registrations` endpoint to ask the server, so this
 * cache can be stale or empty after a fresh reload — the server's 400 on
 * register is the real gate, this only saves a wasted tap in the common case.
 */
const registeredWorkshopBySlot = new Map<string, string>();

export function rememberWorkshopRegistration(slotId: string, workshopId: string): void {
  registeredWorkshopBySlot.set(slotId, workshopId);
}

/** 'own' = registered for this exact workshop; 'conflict' = registered for a different one in the same slot. */
export function slotStatus(slotId: string, workshopId: string): 'own' | 'conflict' | 'none' {
  const registered = registeredWorkshopBySlot.get(slotId);
  if (!registered) return 'none';
  return registered === workshopId ? 'own' : 'conflict';
}
