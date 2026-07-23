import { useRef, useState } from 'react';
import { PHOTO } from '@/config/constants';
import { validatePhoto, fileToDataUrl } from '@/lib/image';

/**
 * Photo picker with client-side type/size validation and a preview before
 * submit. Emits the base64 data URL (or null) to the parent form. The photo is
 * later stored server-side in the separate `photos` collection.
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

  const shownError = localError ?? error;

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-ink">
        Photo <span className="text-danger">*</span>
      </span>
      <div className="flex items-center gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-surface-2 text-xs text-muted">
          {value ? (
            <img
              src={value}
              alt="Selected profile preview"
              className="h-full w-full object-cover"
            />
          ) : (
            'No photo'
          )}
        </div>
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="w-fit rounded-lg border border-brand px-3 py-2 text-sm font-semibold text-brand hover:bg-brand/5"
          >
            {value ? 'Change photo' : 'Upload photo'}
          </button>
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
