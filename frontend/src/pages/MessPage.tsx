import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api';
import type { Meal, MessMenuItem, MessPass } from '@/api/types';
import { ROUTES } from '@/config/routes';
import { Card, Skeleton, EmptyState, ErrorState } from '@/components/ui';

type Status = 'loading' | 'error' | 'loaded';

const MEAL_LABEL: Record<Meal, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  snacks: 'Snacks',
  dinner: 'Dinner',
};

/**
 * Mess screen (Epic 4): the participant's digital mess pass (FR-4.2) plus the
 * current menu and timings per location (FR-4.1). Reporting an issue jumps to
 * Help with the Mess category pre-filled.
 */
export default function MessPage() {
  const [status, setStatus] = useState<Status>('loading');
  const [menu, setMenu] = useState<MessMenuItem[]>([]);
  const [pass, setPass] = useState<MessPass | null>(null);

  async function load() {
    setStatus('loading');
    try {
      const [m, p] = await Promise.all([api.listMessMenu(), api.getMessPass()]);
      setMenu(m.items);
      setPass(p);
      setStatus('loaded');
    } catch {
      setStatus('error');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // Group menu by location, preserving the server's sorted order.
  const byLocation = menu.reduce<Record<string, MessMenuItem[]>>((acc, item) => {
    (acc[item.location] ??= []).push(item);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-5 p-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900">Mess</h1>
        <p className="text-sm text-muted">Your mess pass, menu, and timings.</p>
      </div>

      {status === 'loading' && <Skeleton className="h-24" />}
      {status === 'error' && (
        <ErrorState description="Could not load mess info." onRetry={() => void load()} />
      )}

      {status === 'loaded' && (
        <>
          {/* Digital mess pass (FR-4.2). */}
          <Card
            className={
              pass?.eligible ? 'border-green-300 bg-green-50' : 'border-line bg-gray-50'
            }
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-gray-900">Digital Mess Pass</p>
                <p className="text-sm text-muted">
                  {pass?.eligible
                    ? 'Active — show your QR at the mess checkpoint.'
                    : 'No active mess pass. Contact the mess desk to enroll.'}
                </p>
              </div>
              {pass?.eligible && (
                <Link
                  to={ROUTES.myQr}
                  className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Show QR
                </Link>
              )}
            </div>
          </Card>

          {/* Menu (FR-4.1). */}
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-gray-800">Menu &amp; timings</h2>
            {menu.length === 0 ? (
              <EmptyState title="No menu published" description="Check back closer to mealtime." icon="🍽️" />
            ) : (
              Object.entries(byLocation).map(([location, items]) => (
                <Card key={location} className="flex flex-col gap-3">
                  <p className="font-semibold text-gray-900">{location}</p>
                  {items.map((item) => (
                    <div key={item.id} className="border-t border-line pt-2 first:border-0 first:pt-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-800">
                          {MEAL_LABEL[item.meal]}
                        </span>
                        <span className="text-xs text-muted">
                          {item.startTime}–{item.endTime}
                        </span>
                      </div>
                      <p className="mt-0.5 text-sm text-muted">{item.items}</p>
                    </div>
                  ))}
                </Card>
              ))
            )}
          </section>

          <Link
            to={ROUTES.help}
            state={{ category: 'mess' }}
            className="text-center text-sm font-medium text-brand hover:underline"
          >
            Report a mess issue
          </Link>
        </>
      )}
    </div>
  );
}
