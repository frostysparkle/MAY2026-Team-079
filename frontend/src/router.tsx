import { createBrowserRouter } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import PlaceholderPage from '@/pages/PlaceholderPage';

/**
 * Route table for the app. Every screen is wired up front as a placeholder so
 * navigation and guards can be built incrementally; each route's `element` is
 * swapped for the real screen as it lands.
 */
export const router = createBrowserRouter([
  { path: ROUTES.splash, element: <PlaceholderPage title="Splash / Role Landing" /> },
  { path: ROUTES.login, element: <PlaceholderPage title="Sign in with Google" /> },
  { path: ROUTES.completeProfile, element: <PlaceholderPage title="Complete Your Profile" /> },

  { path: ROUTES.home, element: <PlaceholderPage title="Home" /> },
  { path: ROUTES.profile, element: <PlaceholderPage title="Profile" /> },
  { path: ROUTES.myQr, element: <PlaceholderPage title="My QR ID" /> },

  { path: ROUTES.scanner, element: <PlaceholderPage title="QR Scanner" /> },
  { path: ROUTES.scanResult, element: <PlaceholderPage title="Scan Result" /> },

  { path: ROUTES.users, element: <PlaceholderPage title="User Management" /> },

  { path: ROUTES.accessDenied, element: <PlaceholderPage title="Access Denied" /> },
  { path: '*', element: <PlaceholderPage title="Not Found" /> },
]);
