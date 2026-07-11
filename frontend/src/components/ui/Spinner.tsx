import { cn } from '@/lib/cn';

/** Accessible loading spinner. Decorative when inside a button; standalone use
 *  gets a role/label so screen readers announce the loading state. */
export function Spinner({
  size = 20,
  className,
  label,
}: {
  size?: number;
  className?: string;
  label?: string;
}) {
  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        'inline-block animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
      style={{ width: size, height: size }}
    />
  );
}
