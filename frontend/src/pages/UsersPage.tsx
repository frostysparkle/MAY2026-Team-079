import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api';
import type { UserListItem } from '@/api/types';
import { ROLES, ROLE_LABELS, type Role } from '@/config/constants';
import { ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/uiStore';
import { Card, EmptyState, ErrorState, ListItem, Spinner } from '@/components/ui';
import { AdminScreen } from '@/components/layout/AdminScreen';

type Status = 'loading' | 'ready' | 'error';

// Registration dates are shown in IST, the app's official timezone.
const dateFmt = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeZone: 'Asia/Kolkata',
});

/**
 * Admin User Management. Lists all participants; the per-row role-assignment
 * control is visible and usable ONLY to a Super Admin (FR-7.3). Regular admins
 * see the same list read-only. The backend still enforces this — the control is
 * hidden here, but the endpoint also rejects non-super-admin callers.
 */
export default function UsersPage() {
  const navigate = useNavigate();
  const myRole = useAuthStore((s) => s.participant?.role);
  const isSuperAdmin = myRole === 'super_admin';

  const [status, setStatus] = useState<Status>('loading');
  const [users, setUsers] = useState<UserListItem[]>([]);

  async function load() {
    setStatus('loading');
    try {
      const { users: list } = await api.listUsers();
      setUsers(list);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function changeRole(id: string, role: Role) {
    const previous = users;
    // Optimistic update, rolled back if the request fails.
    setUsers((u) => u.map((x) => (x.id === id ? { ...x, role } : x)));
    try {
      await api.assignRole({ participantId: id, role });
      toast.success('Role updated.');
    } catch {
      setUsers(previous);
      toast.error('Could not update role.');
    }
  }

  return (
    <AdminScreen
      title="User Management"
      subtitle={
        isSuperAdmin
          ? 'Assign roles to participants and staff.'
          : 'View registered users. Only a Super Admin can change roles.'
      }
      onBack={() => navigate(ROUTES.home)}
    >

      {status === 'loading' && (
        <div className="flex justify-center py-12">
          <Spinner size={28} label="Loading users" />
        </div>
      )}

      {status === 'error' && <ErrorState description="Could not load users." onRetry={load} />}

      {status === 'ready' &&
        (users.length === 0 ? (
          <EmptyState title="No participants registered yet" icon="👥" />
        ) : (
          <Card className="p-0">
            {users.map((u) => (
              <ListItem
                key={u.id}
                title={u.fullName}
                subtitle={`${u.email} · ${dateFmt.format(new Date(u.createdAt))}`}
                trailing={
                  isSuperAdmin ? (
                    <select
                      aria-label={`Role for ${u.fullName}`}
                      value={u.role}
                      onChange={(e) => changeRole(u.id, e.target.value as Role)}
                      className="rounded-md border border-line bg-white px-2 py-1 text-xs"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
                      {ROLE_LABELS[u.role]}
                    </span>
                  )
                }
              />
            ))}
          </Card>
        ))}
    </AdminScreen>
  );
}
