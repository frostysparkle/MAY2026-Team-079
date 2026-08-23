import { Link, Navigate, useParams } from 'react-router-dom';
import { path, ROUTES } from '@/config/routes';
import { PublicPageChrome } from '@/features/landing/PublicPageChrome';
import { EventDetailView } from '@/components/events/EventDetailView';
import { Skeleton } from '@/components/ui';
import { getPublicEventCategory } from '@/features/events/publicEvents';
import { usePublicCategoryEvents } from '@/features/events/usePublicEvents';
import { PublicRegistrationAction } from '@/features/events/PublicRegistrationAction';

/**
 * Public event detail page. The event is resolved from the published programme
 * (`GET /events/public`), so what a visitor reads here is whatever the Super
 * Admin created in the dashboard — there is no built-in copy of it in the app.
 */
export default function PublicEventDetailPage() {
  const { category: categorySlug = '', eventId = '' } = useParams<{
    category: string;
    eventId: string;
  }>();
  const category = getPublicEventCategory(categorySlug);
  const { views, loading } = usePublicCategoryEvents(category?.slug);

  if (!category) return <Navigate to={ROUTES.publicEvents} replace />;

  const backTo = path(ROUTES.publicEventCategory, { category: category.slug });
  const view = views.find((v) => v.id === eventId);

  if (!view) {
    // Only give up on the id once the programme has actually arrived.
    if (loading) {
      return (
        <PublicPageChrome active="Events" width="xl">
          <Skeleton className="mt-10 h-96" />
        </PublicPageChrome>
      );
    }
    return <Navigate to={backTo} replace />;
  }

  return (
    <PublicPageChrome active="Events" width="xl">
      <div className="mb-6">
        <Link
          to={backTo}
          className="tap inline-flex items-center gap-2 rounded-full bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-card ring-1 ring-line transition hover:bg-surface-2 active:scale-95"
        >
          ← {category.label}
        </Link>
      </div>

      {/* This page's chrome renders no `title`, so this component's own heading
          is the page's only one and must be the `<h1>`. */}
      <EventDetailView
        view={view}
        action={<PublicRegistrationAction view={view} />}
        headingLevel="h1"
      />
    </PublicPageChrome>
  );
}
