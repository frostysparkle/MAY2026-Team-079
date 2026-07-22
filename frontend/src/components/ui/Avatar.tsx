import { cn } from '@/lib/cn';

/** Round avatar with a photo, or a gradient initials fallback. */
export function Avatar({
  src,
  name,
  size = 44,
  className,
}: {
  src?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const initial = (name?.trim()?.[0] ?? '?').toUpperCase();
  return (
    <div
      className={cn(
        'shrink-0 overflow-hidden rounded-full ring-2 ring-white/70',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {src ? (
        <img src={src} alt={name ? `${name}'s photo` : 'Profile photo'} className="h-full w-full object-cover" />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand to-accent font-bold text-white"
          style={{ fontSize: size * 0.4 }}
          aria-hidden
        >
          {initial}
        </div>
      )}
    </div>
  );
}
