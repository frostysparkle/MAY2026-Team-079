import { createBrowserRouter } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { AppShell } from '@/components/layout/AppShell';
import PlaceholderPage from '@/pages/PlaceholderPage';
import SplashPage from '@/pages/SplashPage';
import LoginPage from '@/pages/LoginPage';

/**
 * Route table for the app. Public/auth routes are top-level; participant screens
 * render inside the AppShell layout. Each route's `element` is swapped for the
 * real screen as it lands.
 */
export const router = createBrowserRouter([
  { path: ROUTES.splash, element: <SplashPage /> },
  { path: ROUTES.login, element: <LoginPage /> },
  { path: ROUTES.completeProfile, element: <PlaceholderPage title="Complete Your Profile" /> },

  // Participant area — rendered inside the navigation shell.
  {
    path: ROUTES.home,
    element: <AppShell />,
    children: [
      // Child paths are relative to '/app'.
      { index: true, element: <PlaceholderPage title="Home" /> },
      { path: 'profile', element: <PlaceholderPage title="Profile" /> },
      { path: 'qr', element: <PlaceholderPage title="My QR ID" /> },
    ],
  },

  { path: ROUTES.scanner, element: <PlaceholderPage title="QR Scanner" /> },
  { path: ROUTES.scanResult, element: <PlaceholderPage title="Scan Result" /> },

  { path: ROUTES.users, element: <PlaceholderPage title="User Management" /> },

  { path: ROUTES.accessDenied, element: <PlaceholderPage title="Access Denied" /> },
  { path: '*', element: <PlaceholderPage title="Not Found" /> },
]);
