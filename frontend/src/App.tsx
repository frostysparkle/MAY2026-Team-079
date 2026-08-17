import { RouterProvider } from 'react-router-dom';
import { router } from '@/router';
import { ToastHost } from '@/components/ui';
import { Announcer } from '@/components/a11y/Announcer';

export default function App() {
  return (
    <>
      <Announcer />
      <ToastHost />
      <RouterProvider router={router} />
    </>
  );
}
