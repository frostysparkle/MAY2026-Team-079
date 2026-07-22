import { useEffect, useState } from 'react';
import { api } from '@/api';
import type { TestAccount } from '@/api/types';
import { env } from '@/config/env';
import { ROLE_LABELS, type Role } from '@/config/constants';
import { useAuthStore } from '@/stores/authStore';
import { resolvePostLoginRoute } from '@/features/auth/postLoginRoute';

const GROUP_ORDER: Role[] = ['participant', 'organizer', 'admin', 'super_admin'];

/**
 * Dev-only account switcher (spec: student-experience-redesign, Req 10). Lists
 * the seeded test accounts and swaps into any of them via `devLogin` so QA can
 * walk every journey state without hand-crafting data. Rendered only when
 * `env.enableDevSwitcher` (dev builds) — never shipped to production.
 */
export function AccountSwitcher() {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<TestAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const setSession = useAuthStore((s) => s.setSession);
  const current = useAuthStore((s) => s.participant);

  useEffect(() => {
    if (!open || accounts !== null) return;
    api
      .listTestAccounts()
      .then(setAccounts)
      .catch(() => {
        setAccounts([]);
        setError('Test accounts are unavailable. Is dev-login enabled on the backend?');
      });
  }, [open, accounts]);

  async function switchTo(account: TestAccount) {
    setBusy(account.email);
    setError(null);
    try {
      const { session } = await api.devLogin(account.email);
      setSession(session.token, session.participant);
      const route = await resolvePostLoginRoute(session.participant);
      // Hard navigation so every screen refetches cleanly for the new identity.
      window.location.assign(route);
    } catch {
      setError('Could not switch to that account.');
      setBusy(null);
    }
  }

  if (!env.enableDevSwitcher) return null;

  const grouped = GROUP_ORDER.map((role) => ({
    role,
    items: (accounts ?? []).filter((a) => a.role === role),
  })).filter((g) => g.items.length > 0);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-24 right-3 z-50 rounded-full bg-ink/90 px-3 py-2 text-xs font-bold text-white shadow-lift backdrop-blur"
        aria-label="Switch test account"
      >
        🧪 Test user
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div
            className="max-h-[70vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-surface p-4 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-base font-black text-ink">Switch test account</p>
                <p className="text-xs text-muted">
                  {current ? `Signed in as ${current.email}` : 'Not signed in'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full px-2 py-1 text-sm text-muted hover:bg-surface-2"
              >
                Close
              </button>
            </div>

            {error && <p className="mb-3 text-xs text-danger">{error}</p>}

            {accounts === null && <p className="py-6 text-center text-sm text-muted">Loading…</p>}
            {accounts !== null && accounts.length === 0 && !error && (
              <p className="py-6 text-center text-sm text-muted">No test accounts seeded.</p>
            )}

            <div className="flex flex-col gap-4">
              {grouped.map((group) => (
                <div key={group.role} className="flex flex-col gap-2">
                  <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">
                    {ROLE_LABELS[group.role]}
                  </p>
                  {group.items.map((a) => (
                    <button
                      key={a.email}
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void switchTo(a)}
                      className="tap flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5 text-left hover:bg-surface-2 disabled:opacity-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-ink">
                          {a.label ?? a.fullName ?? a.email}
                        </span>
                        <span className="block truncate text-xs text-muted">{a.email}</span>
                      </span>
                      {busy === a.email ? (
                        <span className="text-xs text-muted">…</span>
                      ) : (
                        <span aria-hidden className="text-muted">→</span>
                      )}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
