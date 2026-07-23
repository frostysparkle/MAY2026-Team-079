import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ScanResultPage from './ScanResultPage';
import { api } from '@/api';
import type { VerifyScanResponse } from '@/api/types';
import type { PendingScan } from '@/features/scan/types';

// The real backend owns TOTP verification (SHA1/6/30/±1) and replay/context
// checks — those are covered by the backend pytest suite. Here we stub the
// typed api and assert only that the page renders the right outcome UI.
vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api/ApiClient')>('@/api/ApiClient');
  return { ApiClientError: actual.ApiClientError, api: { verifyScan: vi.fn() } };
});

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
  beforeEach(() => vi.mocked(api.verifyScan).mockReset());

  it('shows Valid for a correct, current code', async () => {
    vi.mocked(api.verifyScan).mockResolvedValue({
      result: 'valid',
      participant: { id: 'p_1', fullName: 'Test Student', photoUrl: null },
    } as VerifyScanResponse);
    await renderResult({ participantId: 'p_1', currentCode: '123456', checkpoint: 'event' });
    expect(await screen.findByText('Valid')).toBeInTheDocument();
  });

  it('shows Expired QR for a wrong/expired code', async () => {
    vi.mocked(api.verifyScan).mockResolvedValue({ result: 'expired' } as VerifyScanResponse);
    await renderResult({ participantId: 'p_1', currentCode: '000000', checkpoint: 'event' });
    expect(await screen.findByText('Expired QR')).toBeInTheDocument();
  });
});
