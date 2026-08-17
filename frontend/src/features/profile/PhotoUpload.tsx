import { useRef, useState } from 'react';
import { ImagePlus, Trash2, UserRound } from 'lucide-react';
import { PHOTO } from '@/config/constants';
import { validatePhoto, fileToDataUrl } from '@/lib/image';
import { Button } from '@/components/ui';

/**
 * Photo picker with client-side type/size validation and a preview before
 * submit. Emits the base64 data URL (or null) to the parent form. The photo is
 * later stored server-side in the separate `photos` collection.
 *
 * Styled with the app's design tokens — a ringed circular preview in the same
 * treatment as <Avatar>, and the shared Button primitive for its actions — so it
 * reads as part of the surrounding form card rather than a one-off control.
 */
export function PhotoUpload({
  value,
  onChange,
  error,
}: {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  error?: string;
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
      <span className="text-sm font-medium text-ink">Profile photo</span>
      <div className="flex items-center gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2 text-muted ring-1 ring-line">
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
        <div className="flex min-w-0 flex-col items-start gap-1.5">
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
          <p className="text-xs text-muted">
            JPG or PNG, up to {Math.round(PHOTO.maxBytes / 1024)} KB.
          </p>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={PHOTO.acceptAttr}
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
