import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { AnnouncementFeed } from './AnnouncementFeed';
import type { Announcement } from './announcements';

/**
 * The delivered half of Stories 8.1/8.2. Audience filtering happens before the
 * list reaches this component, so what is asserted here is that a notice a
 * participant *has* been sent reads as one: its words, who it went to, and a
 * dismissal they can act on.
 */

function announcement(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: 'AN-1',
    title: 'Round 2 has moved to CLT',
    body: 'Report at the new venue 30 minutes early.',
    audience: { kind: 'everyone' },
    severity: 'info',
    postedAt: '2026-06-10T09:00:00.000Z',
    carrierEventId: 'hackathon',
    ...overrides,
  };
}

function renderFeed(props: Partial<React.ComponentProps<typeof AnnouncementFeed>> = {}) {
  return render(
    <MemoryRouter>
      <AnnouncementFeed announcements={[announcement()]} {...props} />
    </MemoryRouter>,
  );
}

describe('AnnouncementFeed', () => {
  it('renders the headline and the message as written', () => {
    renderFeed();
    expect(screen.getByRole('heading', { name: 'Round 2 has moved to CLT' })).toBeInTheDocument();
    expect(screen.getByText('Report at the new venue 30 minutes early.')).toBeInTheDocument();
  });

  it('renders nothing at all when there is nothing to say', () => {
    const { container } = renderFeed({ announcements: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it('names the audience, so a participant knows why they were told', () => {
    renderFeed({
      announcements: [announcement({ audience: { kind: 'hostel', id: 'H12' } })],
      names: { H12: 'Ganga Block' },
    });
    expect(screen.getByText('Residents of Ganga Block')).toBeInTheDocument();
  });

  it('falls back to the raw id when the place has since been deleted', () => {
    renderFeed({ announcements: [announcement({ audience: { kind: 'hostel', id: 'H99' } })] });
    expect(screen.getByText('Residents of H99')).toBeInTheDocument();
  });

  it('marks emphasis so urgent news does not read like a routine notice', () => {
    renderFeed({ announcements: [announcement({ severity: 'urgent' })] });
    expect(screen.getByText('Urgent')).toBeInTheDocument();
  });

  it('attributes the sender and the expiry when they were recorded', () => {
    renderFeed({
      announcements: [
        announcement({ postedBy: 'Ops Head', expiresAt: '2026-06-11T09:00:00.000Z' }),
      ],
    });
    expect(screen.getByText(/Ops Head/)).toBeInTheDocument();
    expect(screen.getByText(/until/)).toBeInTheDocument();
  });

  it('dismisses one notice by name, so the button is unambiguous with several on screen', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    renderFeed({
      announcements: [announcement(), announcement({ id: 'AN-2', title: 'Mess dinner delayed' })],
      onDismiss,
    });

    await user.click(
      screen.getByRole('button', { name: 'Dismiss announcement: Mess dinner delayed' }),
    );
    expect(onDismiss).toHaveBeenCalledWith('AN-2');
  });

  it('offers dismiss-all only when there is more than one', async () => {
    const user = userEvent.setup();
    const onDismissAll = vi.fn();
    const { unmount } = renderFeed({ onDismissAll });
    expect(screen.queryByRole('button', { name: 'Dismiss all' })).not.toBeInTheDocument();
    unmount();

    renderFeed({
      announcements: [announcement(), announcement({ id: 'AN-2', title: 'Second' })],
      onDismissAll,
    });
    await user.click(screen.getByRole('button', { name: 'Dismiss all' }));
    expect(onDismissAll).toHaveBeenCalled();
  });

  it('shows no dismiss control at all when the screen does not offer one', () => {
    renderFeed({ announcements: [announcement(), announcement({ id: 'AN-2' })] });
    expect(screen.queryByRole('button', { name: /Dismiss/ })).not.toBeInTheDocument();
  });

  it('caps a busy board and links to the rest, counting what it hid', () => {
    renderFeed({
      announcements: [
        announcement({ id: 'AN-1' }),
        announcement({ id: 'AN-2' }),
        announcement({ id: 'AN-3' }),
        announcement({ id: 'AN-4' }),
        announcement({ id: 'AN-5' }),
      ],
      limit: 3,
      moreTo: ROUTES.announcements,
    });

    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'See 2 more announcements' })).toHaveAttribute(
      'href',
      ROUTES.announcements,
    );
  });

  it('counts everything addressed to the reader in its heading, not just what fits', () => {
    renderFeed({
      announcements: [announcement({ id: 'AN-1' }), announcement({ id: 'AN-2' })],
      limit: 1,
      moreTo: ROUTES.announcements,
    });
    expect(screen.getByRole('heading', { name: '2 announcements for you' })).toBeInTheDocument();
  });

  it('takes its tone from the loudest notice on show', () => {
    renderFeed({
      announcements: [
        announcement({ id: 'AN-1' }),
        announcement({ id: 'AN-2', severity: 'urgent' }),
      ],
    });
    // Both rows keep their own label; the panel is the one that escalates.
    expect(screen.getByText('Urgent')).toBeInTheDocument();
    expect(screen.getByText('Notice')).toBeInTheDocument();
  });
});
