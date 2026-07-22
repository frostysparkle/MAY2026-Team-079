import { useEffect, useRef, useState } from 'react';
import { env } from '@/config/env';

/**
 * Renders the official Google Identity Services (GIS) button and returns the
 * ID token (`credential`) via `onCredential`. The token is a signed JWT that
 * the backend verifies at `POST /auth/google`.
 *
 * The GIS client script is loaded on demand (not in index.html) so it only
 * loads on the login screen and only in real-API mode.
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client';

interface CredentialResponse {
  credential?: string;
}

interface GoogleAccountsId {
  initialize(config: {
    client_id: string;
    callback: (response: CredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      theme?: 'outline' | 'filled_blue' | 'filled_black';
      size?: 'small' | 'medium' | 'large';
      width?: number;
      text?: 'signin_with' | 'signup_with' | 'continue_with';
      shape?: 'rectangular' | 'pill';
      logo_alignment?: 'left' | 'center';
    },
  ): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

/** Load the GIS script once; resolve when `window.google` is available. */
function loadGis(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('gis_load_failed')));
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('gis_load_failed'));
    document.head.appendChild(script);
  });
}

interface Props {
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
}

export function GoogleSignInButton({ onCredential, onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!env.googleClientId) {
      onError('Google sign-in is not configured (missing VITE_GOOGLE_CLIENT_ID).');
      return;
    }

    loadGis()
      .then(() => {
        if (cancelled || !containerRef.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: env.googleClientId,
          callback: (response) => {
            if (response.credential) {
              onCredential(response.credential);
            } else {
              onError('Google did not return a credential. Please try again.');
            }
          },
          cancel_on_tap_outside: true,
        });
        window.google.accounts.id.renderButton(containerRef.current, {
          theme: 'outline',
          size: 'large',
          width: 320,
          text: 'continue_with',
          shape: 'pill',
          logo_alignment: 'left',
        });
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) onError('Could not load Google sign-in. Check your connection.');
      });

    return () => {
      cancelled = true;
    };
    // onCredential/onError are stable enough for this one-time setup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={containerRef} />
      {!ready && <p className="text-sm text-muted">Loading Google sign-in…</p>}
    </div>
  );
}
