import { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { AppShell } from '@/components/layout/AppShell';
import { Spinner } from '@/components/ui';
import PlaceholderPage from '@/pages/PlaceholderPage';
import SplashPage from '@/pages/SplashPage';
import LoginPage from '@/pages/LoginPage';
import HomePage from '@/pages/HomePage';
import ProfilePage from '@/pages/ProfilePage';
import MyQrPage from '@/pages/MyQrPage';

// Complete Your Profile pulls in the large country/state/city dataset. Lazy-load
// it so that dataset is split out of the main bundle — keeping the offline app
// shell (including My QR) small and precacheable by the service worker.
const CompleteProfilePage = lazy(() => import('@/pages/CompleteProfilePage'));

function Lazy({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-full items-center justify-center p-10">
          <Spinner size={28} label="Loading" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

/**
 * Route table for the app. Public/auth routes are top-level; participant screens
 * render inside the AppShell layout.
 */
export const router = createBrowserRouter([
  { path: ROUTES.splash, element: <SplashPage /> },
  { path: ROUTES.login, element: <LoginPage /> },
  {
    path: ROUTES.completeProfile,
    element: (
      <Lazy>
        <CompleteProfilePage />
      </Lazy>
    ),
  },

  // Participant area — rendered inside the navigation shell.
  {
    path: ROUTES.home,
    element: <AppShell />,
    children: [
      // Child paths are relative to '/app'.
      { index: true, element: <HomePage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'qr', element: <MyQrPage /> },
    ],
  },

  { path: ROUTES.scanner, element: <PlaceholderPage title="QR Scanner" /> },
  { path: ROUTES.scanResult, element: <PlaceholderPage title="Scan Result" /> },

  { path: ROUTES.users, element: <PlaceholderPage title="User Management" /> },

  { path: ROUTES.accessDenied, element: <PlaceholderPage title="Access Denied" /> },
  { path: '*', element: <PlaceholderPage title="Not Found" /> },
]);
