import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Shows a spinner and disables the button; keeps width stable. */
  loading?: boolean;
  fullWidth?: boolean;
  children: ReactNode;
  /** React 19 ref-as-prop — no forwardRef needed. */
  ref?: Ref<HTMLButtonElement>;
}

const variantClasses: Record<Variant, string> = {
  primary: 'bg-brand text-white shadow-brand hover:bg-brand-dark active:shadow-none',
  secondary: 'bg-surface text-brand ring-1 ring-inset ring-brand/25 hover:bg-brand-50',
  danger: 'bg-danger text-white shadow-danger hover:brightness-95 active:shadow-none',
  ghost: 'bg-transparent text-ink hover:bg-surface-2',
};

const sizeClasses: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2.5 text-sm gap-2',
  lg: 'px-5 py-3 text-base gap-2',
};

/**
 * Primary action button with Normal / Loading / Disabled states.
 * A disabled or loading button is non-interactive and announced to AT via the
 * native `disabled` attribute.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  className,
  children,
  ref,
  ...props
}: ButtonProps) {
  return (
    <button
      ref={ref}
      // Default to type="button" so a button inside a form doesn't submit by accident.
      type={props.type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'tap inline-flex select-none items-center justify-center rounded-xl font-semibold',
        'active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100',
        variantClasses[variant],
        sizeClasses[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading && <Spinner size={16} />}
      {children}
    </button>
  );
}
