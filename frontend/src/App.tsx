import { RouterProvider } from 'react-router-dom';
import { router } from '@/router';
import { ToastHost } from '@/components/ui';
import { AccountSwitcher } from '@/features/devtools/AccountSwitcher';

export default function App() {
  return (
    <>
      <ToastHost />
      <RouterProvider router={router} />
      {/* Dev-only; renders nothing in production builds. */}
      <AccountSwitcher />
    </>
  );
}
