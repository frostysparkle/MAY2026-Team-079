import type { MealSlot, ScanQRRequest } from '@/api/types';

export interface PendingMessScan {
  qr: ScanQRRequest;
  messId: string;
  slot: MealSlot;
  day: number;
}

export interface PendingHostelScan {
  qr: ScanQRRequest;
  hostelId: string;
  action: 'entry' | 'exit';
}

export interface PendingEventScan {
  qr: ScanQRRequest;
  eventId: string;
}

export interface PendingWorkshopScan {
  qr: ScanQRRequest;
  workshopId: string;
  scanType: 'pre-registered' | 'on-spot';
}
