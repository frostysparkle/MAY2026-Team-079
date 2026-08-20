import { PHOTO } from '@/config/constants';

/** Validate a chosen photo against the type/size rules. Returns an error string or null. */
export function validatePhoto(file: File): string | null {
  if (!(PHOTO.acceptedTypes as readonly string[]).includes(file.type)) {
    return 'Photo must be a JPG or PNG image.';
  }
  if (file.size > PHOTO.maxBytes) {
    const kb = Math.round(PHOTO.maxBytes / 1024);
    return `Photo must be ${kb} KB or smaller.`;
  }
  return null;
}

/** Read a File into a base64 data URL (what we send to the backend). */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
  });
}
