import { useEffect } from 'react';
import { useUiStore, type Toast } from '@/stores/uiStore';
import { cn } from '@/lib/cn';

const variantClasses = {
  success: 'bg-success text-white',
  error: 'bg-danger text-white',
  warning: 'bg-warning text-white',
};

const variantIcon = {
  success: '✓',
  error: '✕',
  warning: '!',
};

function ToastItem({ toast }: { toast: Toast }) {
  const removeToast = useUiStore((s) => s.removeToast);
  useEffect(() => {
    const id = setTimeout(() => removeToast(toast.id), 3000);
    return () => clearTimeout(id);
  }, [toast.id, removeToast]);

  return (
    <div
      role={toast.variant === 'error' ? 'alert' : 'status'}
      className={cn(
        'animate-toast pointer-events-auto flex items-center gap-2 rounded-full py-2 pl-3 pr-4 text-sm font-medium shadow-lift',
        variantClasses[toast.variant],
      )}
    >
      <span
        aria-hidden
        className="flex h-5 w-5 items-center justify-center rounded-full bg-white/25 text-xs font-bold"
      >
        {variantIcon[toast.variant]}
      </span>
      {toast.message}
    </div>
  );
}

/** Renders transient toasts from the UI store. Mounted once at the app root. */
export function ToastHost() {
  const toasts = useUiStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="safe-top pointer-events-none fixed inset-x-0 top-2 z-[60] mx-auto flex max-w-md flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
