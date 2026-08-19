import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * The rendered pixel width of an element, tracked as it changes.
 *
 * The board's trend chart draws its axis labels at real pixel sizes rather than
 * scaling an SVG viewBox to fit, because a uniformly-scaled chart makes 10px
 * tick labels illegible on a phone and oversized on a wide monitor. That means
 * the chart has to know how wide it actually is.
 *
 * `fallback` is returned until the first measurement lands, and permanently in
 * environments with no `ResizeObserver` — jsdom under test being the one that
 * matters here. Without it a chart would measure zero and render its
 * "not enough data" state in every test that mounts the board, which would make
 * the fallback path, not the real one, the thing under test.
 */
export function useElementWidth<T extends HTMLElement>(
  fallback = 640,
): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0;
      // A hidden or not-yet-laid-out element measures zero; keeping the fallback
      // is better than collapsing the chart to nothing.
      if (measured > 0) setWidth(measured);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
