import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';
import { IconTile } from './IconTile';

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
      <IconTile icon={AlertTriangle} tone="danger" size="lg" />
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
