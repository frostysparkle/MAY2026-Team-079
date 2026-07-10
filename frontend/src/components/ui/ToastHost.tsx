import { useEffect } from 'react';
import { useUiStore, type Toast } from '@/stores/uiStore';
import { cn } from '@/lib/cn';

const variantClasses = {
  success: 'bg-success text-white',
  error: 'bg-danger text-white',
  warning: 'bg-warning text-white',
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
      className={cn('rounded-lg px-4 py-2 text-sm shadow-lg', variantClasses[toast.variant])}
    >
      {toast.message}
    </div>
  );
}

/** Renders transient toasts from the UI store. Mounted once at the app root. */
export function ToastHost() {
  const toasts = useUiStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="fixed inset-x-0 top-3 z-50 mx-auto flex max-w-md flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
