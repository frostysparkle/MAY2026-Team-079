import { cn } from '@/lib/cn';

function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

/** Profile avatar — a photo when available, otherwise a brand-gradient initial. */
export function Avatar({
  src,
  name,
  size = 44,
  className,
}: {
  src?: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size };

  if (src) {
    return (
      <img
        src={src}
        alt={`${name}'s profile`}
        style={style}
        className={cn('shrink-0 rounded-full object-cover ring-2 ring-white', className)}
      />
    );
  }

  return (
    <div
      aria-hidden
      style={style}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-accent font-bold text-white ring-2 ring-white',
        className,
      )}
    >
      <span style={{ fontSize: size * 0.42 }}>{initialOf(name)}</span>
    </div>
  );
}
