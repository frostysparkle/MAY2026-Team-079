import { useRef, useState } from 'react';
import { ImagePlus, Trash2, UserRound } from 'lucide-react';
import { PHOTO } from '@/config/constants';
import { validatePhoto, fileToDataUrl } from '@/lib/image';
import { Button } from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * Photo picker with client-side type/size validation and a preview before
 * submit. Emits the base64 data URL (or null) to the parent form. The photo is
 * later stored server-side in the separate `photos` collection.
 *
 * Styled with the app's design tokens — a ringed circular preview in the same
 * treatment as <Avatar>, and the shared Button primitive for its actions — so it
 * reads as part of the surrounding form card rather than a one-off control.
 *
 * `required` gives it the same required marking every other field on a form
 * carries: the red asterisk on the label, `aria-required` on the control, and —
 * because a file picker has no empty state of its own to speak of — a dashed
 * placeholder ring until a photo is actually chosen.
 */
export function PhotoUpload({
  value,
  onChange,
  error,
  required = false,
}: {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  error?: string;
  /** Marks the picker as mandatory, visually and to assistive tech. */
  required?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    setLocalError(null);
    if (!file) return;
    const validationError = validatePhoto(file);
    if (validationError) {
      setLocalError(validationError);
      onChange(null);
      return;
    }
    onChange(await fileToDataUrl(file));
  }

  function clear() {
    setLocalError(null);
    onChange(null);
    // Reset the input so re-picking the same file still fires a change event.
    if (inputRef.current) inputRef.current.value = '';
  }

  const shownError = localError ?? error;

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-ink">
        Profile photo
        {required && (
          <span className="text-danger" aria-hidden>
            {' '}
            *
          </span>
        )}
      </span>
      <div className="flex items-center gap-4">
        <div
          className={cn(
            'flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2 text-muted',
            value
              ? 'ring-1 ring-line'
              : shownError
                ? 'border-2 border-dashed border-danger'
                : 'border-2 border-dashed border-line',
          )}
        >
          {value ? (
            <img
              src={value}
              alt="Selected profile preview"
              className="h-full w-full object-cover"
            />
          ) : (
            <UserRound size={30} strokeWidth={1.75} aria-hidden />
          )}
        </div>
        <div className="flex min-w-0 flex-col items-start gap-2">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
              <ImagePlus size={14} strokeWidth={2.25} />
              {value ? 'Change photo' : 'Upload photo'}
            </Button>
            {value && (
              <Button variant="ghost" size="sm" onClick={clear}>
                <Trash2 size={14} strokeWidth={2.25} />
                Remove
              </Button>
            )}
          </div>
          <p className="text-xs leading-relaxed text-muted">
            JPG or PNG, up to {Math.round(PHOTO.maxBytes / 1024)} KB.
          </p>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={PHOTO.acceptAttr}
        aria-required={required || undefined}
        aria-invalid={shownError ? true : undefined}
        className="sr-only"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      {shownError && (
        <p role="alert" className="text-xs text-danger">
          {shownError}
        </p>
      )}
    </div>
  );
}
