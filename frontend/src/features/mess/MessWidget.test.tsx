import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessWidget } from './MessWidget';
import { useAuthStore } from '@/stores/authStore';
import { __resetMockApiForTests, mockApi } from '@/api/mock/mockApi';

describe('MessWidget', () => {
  beforeEach(async () => {
    useAuthStore.getState().clear();
    __resetMockApiForTests();
    const session = await mockApi.login({
      email: 'participant@ds.study.iitm.ac.in',
      password: 'password123',
    });
    useAuthStore.getState().setParticipantSession(session);
  });

  it("shows the participant's allotted mess", async () => {
    render(<MessWidget />);
    expect(await screen.findByText('Himalaya')).toBeInTheDocument();
  });
});
