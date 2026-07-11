/**
 * Lightweight UI store for transient toasts/banners. Screens dispatch a toast
 * instead of managing their own notification state.
 */
import { create } from 'zustand';

export type ToastVariant = 'success' | 'error' | 'warning';

export interface Toast {
  id: string;
  variant: ToastVariant;
  message: string;
}

interface UiState {
  toasts: Toast[];
  addToast: (variant: ToastVariant, message: string) => void;
  removeToast: (id: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  toasts: [],
  addToast: (variant, message) =>
    set((s) => ({
      toasts: [...s.toasts, { id: crypto.randomUUID(), variant, message }],
    })),
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Convenience helpers usable outside React components. */
export const toast = {
  success: (m: string) => useUiStore.getState().addToast('success', m),
  error: (m: string) => useUiStore.getState().addToast('error', m),
  warning: (m: string) => useUiStore.getState().addToast('warning', m),
};
