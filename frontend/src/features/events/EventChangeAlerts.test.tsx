import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { EventChangeAlerts } from './EventChangeAlerts';
import type { EventChange } from './eventChanges';

function change(overrides: Partial<EventChange> = {}): EventChange {
  return {
    id: 'hack-2026|RND1|venue|CLT',
    eventId: 'hack-2026',
    eventName: 'Hackathon 2026',
    roundName: 'Round 1',
    field: 'venue',
    from: 'KV Ground',
    to: 'CLT',
    noticedAt: '2026-06-01T10:00:00.000Z',
    ...overrides,
  };
}

function setup(changes: EventChange[]) {
  const onDismiss = vi.fn();
  const onDismissAll = vi.fn();
  render(
    <MemoryRouter>
      <EventChangeAlerts changes={changes} onDismiss={onDismiss} onDismissAll={onDismissAll} />
    </MemoryRouter>,
  );
  return { onDismiss, onDismissAll };
}

describe('EventChangeAlerts', () => {
  it('renders nothing when there is nothing to report', () => {
    const { container } = render(
      <MemoryRouter>
        <EventChangeAlerts changes={[]} onDismiss={vi.fn()} onDismissAll={vi.fn()} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('names the event, the round, and both sides of a venue move', () => {
    setup([change()]);

    expect(screen.getByRole('link', { name: 'Hackathon 2026' })).toHaveAttribute(
      'href',
      '/app/events/hack-2026',
    );
    expect(screen.getByText(/Round 1/)).toBeInTheDocument();
    expect(screen.getByText('KV Ground')).toBeInTheDocument();
    expect(screen.getByText('CLT')).toBeInTheDocument();
  });

  it('formats a time move rather than printing the raw timestamp', () => {
    setup([
      change({
        id: 'hack-2026|RND1|start|2026-06-10T14:00',
        field: 'start',
        from: '2026-06-10T10:00',
        to: '2026-06-10T14:00',
      }),
    ]);

    // Neither side is printed raw; both are run through the round-time format.
    expect(screen.queryByText('2026-06-10T14:00')).not.toBeInTheDocument();
    expect(screen.queryByText('2026-06-10T10:00')).not.toBeInTheDocument();
    expect(screen.getAllByText(/10 Jun/)).toHaveLength(2);
  });

  it('reads as a set rather than a move when there was no previous value', () => {
    setup([change({ from: '' })]);
    expect(screen.getByText('CLT')).toBeInTheDocument();
    expect(screen.queryByText('KV Ground')).not.toBeInTheDocument();
  });

  it('counts the alerts in the heading', () => {
    setup([change()]);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      'A round you are registered for has moved',
    );
  });

  it('pluralises the heading and offers Dismiss all for more than one', () => {
    setup([change(), change({ id: 'other', eventName: 'Quiz' })]);

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      '2 rounds you are registered for have moved',
    );
    expect(screen.getByRole('button', { name: 'Dismiss all' })).toBeInTheDocument();
  });

  it('offers no Dismiss all for a single alert', () => {
    setup([change()]);
    expect(screen.queryByRole('button', { name: 'Dismiss all' })).not.toBeInTheDocument();
  });

  it('dismisses one alert by id', async () => {
    const { onDismiss } = setup([change()]);
    await userEvent.click(
      screen.getByRole('button', { name: /Dismiss the venue change for Hackathon 2026/ }),
    );
    expect(onDismiss).toHaveBeenCalledWith('hack-2026|RND1|venue|CLT');
  });

  it('dismisses everything at once', async () => {
    const { onDismissAll } = setup([change(), change({ id: 'other' })]);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss all' }));
    expect(onDismissAll).toHaveBeenCalledOnce();
  });

  it('says what it can and cannot have seen', () => {
    setup([change()]);
    expect(screen.getByText(/Changes made before you first opened an event/)).toBeInTheDocument();
  });
});
