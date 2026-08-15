import { useEffect } from 'react';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { useUiStore, type Toast } from '@/stores/uiStore';
import { cn } from '@/lib/cn';

const variantClasses = {
  success: 'bg-success-bg text-success ring-1 ring-inset ring-success/20',
  error: 'bg-danger-bg text-danger ring-1 ring-inset ring-danger/20',
  warning: 'bg-warning-bg text-warning ring-1 ring-inset ring-warning/20',
};

const icons = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
};

function ToastItem({ toast }: { toast: Toast }) {
  const removeToast = useUiStore((s) => s.removeToast);
  const Icon = icons[toast.variant];
  useEffect(() => {
    const id = setTimeout(() => removeToast(toast.id), 3000);
    return () => clearTimeout(id);
  }, [toast.id, removeToast]);

  return (
    <div
      role={toast.variant === 'error' ? 'alert' : 'status'}
      className={cn(
        'animate-toast flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium shadow-lift',
        variantClasses[toast.variant],
      )}
    >
      <Icon size={16} strokeWidth={2.25} className="shrink-0" />
      {toast.message}
    </div>
  );
}

/** Renders transient toasts from the UI store. Mounted once at the app root. */
export function ToastHost() {
  const toasts = useUiStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="safe-top fixed inset-x-0 top-3 z-50 mx-auto flex max-w-md flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
