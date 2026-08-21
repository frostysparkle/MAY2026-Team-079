/**
 * The glyph size that belongs with each `Button` size, and the stroke weight they
 * are all drawn at.
 *
 * Buttons carry a leading Lucide icon all over the app, and every call site was
 * choosing the number itself: 13, 14, 15 and 16 were all in use, sometimes on two
 * buttons sitting side by side in the same `actions` row, at two different stroke
 * weights. The difference is small on one button and obvious across a row of them —
 * one glyph reads a weight lighter than the one next to it.
 *
 * Half a step under the label's own size on each rung, which is what keeps the
 * glyph reading as a mark beside the word rather than as a second word.
 *
 * Note the sibling problem this does *not* solve: the gap between glyph and label
 * belongs to `Button`'s own size classes, and call sites should leave it there
 * rather than passing `className="gap-1.5"` — which most of them were doing,
 * overriding the medium button's gap with the small button's.
 *
 * A module of its own rather than an export of `Button.tsx` so that file stays
 * component-only, which is what `react-refresh/only-export-components` wants: the
 * rule's `allowConstantExport` covers a literal but not an object.
 */
export const BUTTON_ICON = { sm: 14, md: 15, lg: 16 } as const;

/** The one stroke weight every button glyph is drawn at. */
export const BUTTON_ICON_STROKE = 2.5;
