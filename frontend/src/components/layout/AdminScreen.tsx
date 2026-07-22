import type { ReactNode } from 'react';
import { PageHeader } from '@/components/ui';

/**
 * Layout for standalone (non-shell) management screens: a sticky frosted
 * PageHeader plus an animated, width-capped content column. Gives admin/staff
 * screens the same native, app-like feel as the participant shell.
 */
export function AdminScreen({
  title,
  subtitle,
  onBack,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-full bg-canvas pb-16">
      <PageHeader title={title} subtitle={subtitle} onBack={onBack} right={right} />
      <div className="animate-rise mx-auto flex max-w-2xl flex-col gap-5 p-4">{children}</div>
    </div>
  );
}
