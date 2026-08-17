import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * Hero paradox devices — the wordplay is *shown*, not just stated.
 *
 * - `ImpossibleTriangle`: a Penrose tribar built from three rotational beams
 *   with a cyclic over/under (0→2→1→0) that can't exist in 3D. Pure SVG, brand
 *   gradient, slow spin. Decorative → aria-hidden.
 * - `WordCycler`: a single slot that can't settle on one word, cycling opposites
 *   (order↔chaos…). Screen readers get one stable phrase; the animation is
 *   aria-hidden and pauses under prefers-reduced-motion.
 * - `ParadoxWord`: "paradox" set with a mirrored reflection reading the opposite
 *   direction — the word contradicts itself.
 *
 * All motion is GPU-friendly and reduced-motion aware (no downloads).
 */

/** One-shot + live prefers-reduced-motion listener. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return reduced;
}

/* ----------------------------------------------- impossible triangle --- */

const BEAMS = [
  'M 44.0 8.6 L 84.6 78.9 L 74.2 84.9 L 33.6 14.6 Z', // B0 (right)
  'M 90.6 68.5 L 9.4 68.5 L 9.4 56.5 L 90.6 56.5 Z', // B1 (bottom)
  'M 15.4 78.9 L 56.0 8.6 L 66.4 14.6 L 25.8 84.9 Z', // B2 (left)
  'M 44.0 8.6 L 62.0 39.8 L 51.6 45.8 L 33.6 14.6 Z', // CAP flips top corner
] as const;

export function ImpossibleTriangle({ className, label }: { className?: string; label?: string }) {
  const reduced = useReducedMotion();
  const gid = useId().replace(/:/g, '');
  // Decorative by default; pass `label` only where it carries meaning.
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
  return (
    <svg
      viewBox="0 0 100 100"
      {...a11y}
      className={cn(!reduced && 'animate-spin-slow', className)}
      style={{ transformOrigin: '50% 52%' }}
    >
      <defs>
        <linearGradient id={`pt-${gid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-brand)" />
          <stop offset="55%" stopColor="#7c6cf5" />
          <stop offset="100%" stopColor="var(--color-accent)" />
        </linearGradient>
      </defs>
      {/* Beams share one gradient; the canvas-coloured stroke opens the gaps
          that read as depth. Draw order + CAP make the over/under cyclic. */}
      <g stroke="var(--color-canvas)" strokeWidth={2.4} strokeLinejoin="round">
        {BEAMS.map((d, i) => (
          <path key={i} d={d} fill={`url(#pt-${gid})`} />
        ))}
      </g>
    </svg>
  );
}

/* ------------------------------------------------------- word cycler --- */

const CYCLE_WORDS = ['curiosity', 'order', 'chaos', 'wonder', 'logic'] as const;
const SR_PHRASE = `Where ${CYCLE_WORDS[0]} meets paradox.`;

function WordCycler() {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (reduced) return;
    timer.current = setInterval(() => {
      setActive((i) => (i + 1) % CYCLE_WORDS.length);
    }, 2100);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [reduced]);

  // Under reduced motion, always rest on the first word (no state churn).
  const shown = reduced ? 0 : active;

  return (
    <span className="inline-grid align-baseline">
      {CYCLE_WORDS.map((word, i) => (
        <span
          key={word}
          className={cn(
            'col-start-1 row-start-1 whitespace-nowrap text-brand transition-all duration-500 ease-out',
            i === shown ? 'opacity-100 blur-0' : 'translate-y-1 opacity-0 blur-[2px]',
          )}
        >
          {word}
        </span>
      ))}
    </span>
  );
}

/* -------------------------------------------------------- paradox word --- */

function ParadoxWord() {
  return (
    <span className="relative inline-block align-baseline">
      <span className="text-gradient">paradox</span>
      {/* Mirrored reflection reading the opposite way — the word contradicts
          itself. Decorative, fades out downward. */}
      <span
        aria-hidden
        className="text-gradient pointer-events-none absolute left-0 top-full block -translate-y-[0.12em] select-none opacity-40"
        style={{
          transform: 'scaleY(-1)',
          WebkitMaskImage: 'linear-gradient(to bottom, black, transparent 70%)',
          maskImage: 'linear-gradient(to bottom, black, transparent 70%)',
        }}
      >
        paradox
      </span>
    </span>
  );
}

/* ----------------------------------------------------------- headline --- */

export function ParadoxHeadline({ className }: { className?: string }) {
  return (
    <h1
      className={cn(
        'text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl',
        className,
      )}
    >
      {/* Stable phrase for assistive tech; the animated version is decorative. */}
      <span className="sr-only">{SR_PHRASE}</span>
      <span aria-hidden className="animate-rise block">
        Where <WordCycler />
        <br />
        meets <ParadoxWord />.
      </span>
    </h1>
  );
}
