import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ScanResultPage from './ScanResultPage';
import { mockApi } from '@/api/mock/mockApi';
import { generateCode } from '@/lib/totp';
import type { PendingScan } from '@/features/scan/types';

async function renderResult(scan: PendingScan) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/scan/result', state: scan }]}>
      <Routes>
        <Route path="/scan/result" element={<ScanResultPage />} />
        <Route path="/scan" element={<div>Scanner</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ScanResultPage', () => {
  beforeEach(async () => {
    await mockApi.login({
      email: 'fullstack@ds.study.iitm.ac.in',
      password: 'password123',
    });
  });

  it('shows Valid for a correct, current code', async () => {
    const { participantId, secretBase32 } = await mockApi.provisionSecret({
      checkpointContext: 'event',
      eventId: 'e_keynote',
    });
    await renderResult({
      participantId,
      currentCode: generateCode(secretBase32),
      checkpoint: 'event',
      eventId: 'e_keynote',
    });
    expect(await screen.findByText('Valid')).toBeInTheDocument();
  });

  it('shows Expired QR for a wrong/expired code', async () => {
    const { participantId } = await mockApi.provisionSecret({
      checkpointContext: 'event',
      eventId: 'e_keynote',
    });
    await renderResult({
      participantId,
      currentCode: '000000',
      checkpoint: 'event',
      eventId: 'e_keynote',
    });
    expect(await screen.findByText('Expired QR')).toBeInTheDocument();
  });
});
