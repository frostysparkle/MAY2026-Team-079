/**
 * Decorative festival "sky" backdrop — layered gradient blobs, a soft dotted
 * grid, and floating orbs, all pure CSS/SVG (no image downloads, GPU-friendly
 * transforms). Purely presentational: `aria-hidden` and non-interactive. Nods to
 * the reference site's dreamy sky/cloud theme without copying its artwork.
 */
export function AuroraBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Base wash */}
      <div className="absolute inset-0 bg-gradient-to-b from-brand-50 via-canvas to-canvas" />

      {/* Drifting colour blobs */}
      <div className="animate-blob absolute -left-24 -top-24 h-80 w-80 rounded-full bg-brand/25 blur-3xl" />
      <div
        className="animate-blob absolute -right-20 top-10 h-96 w-96 rounded-full bg-accent/20 blur-3xl"
        style={{ animationDelay: '-6s' }}
      />
      <div
        className="animate-blob absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-violet-400/20 blur-3xl"
        style={{ animationDelay: '-12s' }}
      />

      {/* Dotted grid */}
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(20,20,31,0.12) 1px, transparent 0)',
          backgroundSize: '26px 26px',
          maskImage: 'radial-gradient(ellipse 80% 60% at 50% 30%, black, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 30%, black, transparent 75%)',
        }}
      />

      {/* Floating orbs */}
      <span className="animate-float absolute left-[12%] top-[28%] h-3 w-3 rounded-full bg-brand/60" />
      <span
        className="animate-float-slow absolute right-[16%] top-[22%] h-2.5 w-2.5 rounded-full bg-accent/70"
        style={{ animationDelay: '-3s' }}
      />
      <span
        className="animate-float absolute left-[22%] top-[62%] h-2 w-2 rounded-full bg-violet-500/60"
        style={{ animationDelay: '-1.5s' }}
      />
      <span
        className="animate-float-slow absolute right-[26%] top-[68%] h-3.5 w-3.5 rounded-full bg-brand/40"
        style={{ animationDelay: '-5s' }}
      />
    </div>
  );
}
