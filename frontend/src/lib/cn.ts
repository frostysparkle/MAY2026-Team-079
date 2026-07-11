/** Tiny classnames helper: joins truthy class strings. Keeps JSX readable. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
