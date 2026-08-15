import { useEffect, useId, useRef, useState } from 'react';
import { MoreVertical, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * The "⋮" overflow menu — a compact way to hang several actions off a card
 * without covering its artwork in buttons.
 *
 * Built to be safe on top of a clickable card: the trigger stops click
 * propagation, so opening the menu never also activates the card underneath.
 *
 * Keyboard support is the whole point of hand-rolling this: the trigger opens on
 * ArrowUp/ArrowDown, focus rovers through the items (skipping disabled ones),
 * Home/End jump to the ends, and Escape or Tab closes and hands focus back to
 * the trigger.
 */

export interface ActionMenuItem {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  /** `danger` tints a destructive action, e.g. Delete. */
  tone?: 'default' | 'danger';
  disabled?: boolean;
}

export function ActionMenu({
  label,
  items,
  align = 'right',
  className,
}: {
  /** Accessible name for the trigger, e.g. `Actions for Last1Standing`. */
  label: string;
  items: ActionMenuItem[];
  /** Which edge the panel is anchored to. Defaults to `right`. */
  align?: 'left' | 'right';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // -1 means "open, but focus is still on the trigger" (mouse users).
  const [activeIndex, setActiveIndex] = useState(-1);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function close({ restoreFocus = false }: { restoreFocus?: boolean } = {}) {
    setOpen(false);
    setActiveIndex(-1);
    if (restoreFocus) triggerRef.current?.focus();
  }

  /** First non-disabled index at or after `from`, walking by `step`. */
  function findEnabled(from: number, step: number): number {
    for (let i = from; i >= 0 && i < items.length; i += step) {
      if (!items[i].disabled) return i;
    }
    return -1;
  }

  function openAt(edge: 'first' | 'last') {
    setOpen(true);
    setActiveIndex(edge === 'first' ? findEnabled(0, 1) : findEnabled(items.length - 1, -1));
  }

  /** Step focus from `from` by `delta`, wrapping around the ends. */
  function moveFocus(from: number, delta: number) {
    const next = findEnabled(from + delta, delta);
    setActiveIndex(next !== -1 ? next : findEnabled(delta > 0 ? 0 : items.length - 1, delta));
  }

  useEffect(() => {
    if (!open) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close({ restoreFocus: true });
      }
    }
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close();
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  // Move real DOM focus to follow `activeIndex`.
  useEffect(() => {
    if (open && activeIndex >= 0) itemRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  function onItemKeyDown(e: React.KeyboardEvent, index: number) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveFocus(index, 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveFocus(index, -1);
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(findEnabled(0, 1));
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(findEnabled(items.length - 1, -1));
        break;
      case 'Tab':
        close();
        break;
      default:
        break;
    }
  }

  return (
    <div
      ref={rootRef}
      className={cn('relative', className)}
      // Keep the menu from doubling as a click on whatever sits beneath it.
      onClick={(e) => e.stopPropagation()}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            openAt('first');
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            openAt('last');
          }
        }}
        className={cn(
          'tap flex h-9 w-9 items-center justify-center rounded-full transition-colors',
          // Sits over poster artwork, so it needs its own opaque-ish chip.
          'bg-surface/95 text-ink shadow-card ring-1 ring-line backdrop-blur',
          'hover:bg-surface active:scale-95',
          open && 'bg-surface ring-brand/40',
        )}
      >
        <MoreVertical size={18} strokeWidth={2.25} />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          // Solid surface rather than glass: this floats over poster art and the
          // aurora backdrop, both of which make translucent labels unreadable.
          className={cn(
            'animate-pop absolute top-[calc(100%+0.5rem)] z-50 w-52 overflow-hidden rounded-2xl bg-surface py-1.5 shadow-lift ring-1 ring-line',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item, i) => (
            <button
              key={item.label}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              tabIndex={i === activeIndex ? 0 : -1}
              onKeyDown={(e) => onItemKeyDown(e, i)}
              onClick={() => {
                close();
                item.onSelect();
              }}
              className={cn(
                'flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-semibold transition-colors',
                'disabled:cursor-not-allowed disabled:opacity-50',
                item.tone === 'danger'
                  ? 'text-danger hover:bg-danger-bg focus-visible:bg-danger-bg'
                  : 'text-ink hover:bg-surface-2 focus-visible:bg-surface-2',
              )}
            >
              {item.icon && <item.icon size={15} strokeWidth={2.25} className="shrink-0" />}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
