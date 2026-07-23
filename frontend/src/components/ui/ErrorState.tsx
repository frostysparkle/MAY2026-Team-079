import { Button } from './Button';

/** Error state with an optional Retry action, for failed data loads. */
export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center"
    >
      <div className="text-4xl" aria-hidden>
        ⚠️
      </div>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {description && <p className="max-w-xs text-sm text-muted">{description}</p>}
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
