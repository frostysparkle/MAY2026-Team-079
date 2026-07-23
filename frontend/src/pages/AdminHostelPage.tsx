import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api';
import type {
  CreateAllocationRequest,
  HostelAllocationWithParticipant,
  UserListItem,
} from '@/api/types';
import { ROUTES } from '@/config/routes';
import { AdminScreen } from '@/components/layout/AdminScreen';
import { toast } from '@/stores/uiStore';
import { Button, Card, Select, TextInput, Skeleton } from '@/components/ui';

/**
 * Hostel allocation management (Epic 5, FR-5.1/5.2 admin side). Admin+ assigns a
 * block/room (and optional coordinator + instructions) to a participant, and can
 * edit or remove allocations. Check-in status is recorded by the hostel scan.
 */
export default function AdminHostelPage() {
  const navigate = useNavigate();
  const [allocations, setAllocations] = useState<HostelAllocationWithParticipant[]>([]);
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateAllocationRequest>();

  async function load() {
    setLoading(true);
    try {
      const [a, u] = await Promise.all([api.listAllocations(), api.listUsers()]);
      setAllocations(a.allocations);
      setUsers(u.users);
    } catch {
      toast.error('Could not load hostel data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const allocatedIds = new Set(allocations.map((a) => a.participantId));
  const assignable = users.filter((u) => !allocatedIds.has(u.id));

  async function assign(values: CreateAllocationRequest) {
    try {
      await api.createAllocation(values);
      reset({ participantId: '', hostelBlock: '', room: '', instructions: '', coordinator: '' });
      toast.success('Allocation assigned.');
      void load();
    } catch {
      toast.error('Could not assign (already allocated?).');
    }
  }

  async function remove(id: string) {
    const previous = allocations;
    setAllocations((a) => a.filter((x) => x.id !== id));
    try {
      await api.deleteAllocation(id);
      toast.success('Allocation removed.');
    } catch {
      setAllocations(previous);
      toast.error('Could not remove the allocation.');
    }
  }

  return (
    <AdminScreen
      title="Hostel Allocations"
      subtitle="Assign blocks and rooms to participants."
      onBack={() => navigate(ROUTES.home)}
    >

      <form className="flex flex-col gap-3 rounded-xl border border-line p-4" onSubmit={handleSubmit(assign)} noValidate>
        <p className="text-sm font-semibold text-ink">Assign allocation</p>
        <Select
          label="Participant"
          required
          placeholder={assignable.length ? 'Select a participant' : 'Everyone is allocated'}
          options={assignable.map((u) => ({ value: u.id, label: `${u.fullName} · ${u.email}` }))}
          error={errors.participantId?.message}
          {...register('participantId', { required: 'Select a participant.' })}
        />
        <div className="grid grid-cols-2 gap-3">
          <TextInput
            label="Block"
            required
            error={errors.hostelBlock?.message}
            {...register('hostelBlock', { required: 'Block is required.' })}
          />
          <TextInput
            label="Room"
            required
            error={errors.room?.message}
            {...register('room', { required: 'Room is required.' })}
          />
        </div>
        <TextInput label="Coordinator (optional)" {...register('coordinator')} />
        <TextInput label="Check-in instructions (optional)" {...register('instructions')} />
        <Button type="submit" loading={isSubmitting}>
          Assign
        </Button>
      </form>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-ink">Current allocations</p>
        {loading && <Skeleton className="h-20" />}
        {!loading && allocations.length === 0 && (
          <p className="text-sm text-muted">No allocations yet.</p>
        )}
        {!loading &&
          allocations.map((a) => (
            <Card key={a.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">
                  {a.fullName || '(profile incomplete)'}
                  {a.checkedIn && (
                    <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                      checked in
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-muted">
                  {a.hostelBlock} · Room {a.room} · {a.email}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void remove(a.id)}
                className="shrink-0 text-xs font-medium text-danger hover:underline"
              >
                Remove
              </button>
            </Card>
          ))}
      </div>
    </AdminScreen>
  );
}
