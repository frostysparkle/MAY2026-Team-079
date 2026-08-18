import { Building, CircleAlert, Crown, Users } from 'lucide-react';
import { Skeleton, StatCard } from '@/components/ui';
import type { StaffSummary } from './staffDirectory';

/**
 * The headline figures above the staff list.
 *
 * A staff account has nothing to measure, so these are counts of the things that
 * actually matter when reviewing access: how many accounts exist, how many of
 * them can do everything, how many departments are represented, and how many
 * records are missing the fields that say who someone is.
 *
 * The "needs detail" figure is deliberately shown even when it is zero — unlike
 * an occupancy figure, zero here is a real and reassuring answer.
 */
export function StaffSummaryCards({ summary }: { summary: StaffSummary | null }) {
  if (!summary) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-2xl" />
        ))}
      </div>
    );
  }

  const { accounts, superAdmins, departments, roles, incomplete } = summary;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        icon={Users}
        tone="brand"
        label="Total Accounts"
        value={accounts}
        // The roles actually stored, since `role` is a free string the backend does
        // not validate — how many distinct ones exist is a real finding, where
        // "With staff access" only restated the label.
        footnote={
          roles.length === 0
            ? 'No roles recorded'
            : `${roles.length} distinct role${roles.length === 1 ? '' : 's'}`
        }
      />
      <StatCard
        icon={Crown}
        tone="warning"
        label="Super Admins"
        value={superAdmins}
        footnote={
          accounts === 0
            ? 'No accounts yet'
            : `${Math.round((superAdmins / accounts) * 100)}% of all accounts`
        }
      />
      <StatCard
        icon={Building}
        tone="info"
        label="Departments"
        value={departments.length}
        // The names themselves, since four short words fit where a bare count
        // would leave an admin guessing which ones are covered.
        footnote={departments.length === 0 ? 'None recorded' : departments.join(', ')}
      />
      <StatCard
        icon={CircleAlert}
        tone={incomplete === 0 ? 'success' : 'accent'}
        label="Needs Detail"
        value={incomplete}
        footnote={
          incomplete === 0 ? 'Every record complete' : 'Missing a department or designation'
        }
      />
    </div>
  );
}
