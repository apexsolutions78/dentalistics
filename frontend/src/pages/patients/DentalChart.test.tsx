import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DentalChart } from './DentalChart';
import { jsonResponse } from '../../test/fixtures';

const catalog = [
  { code: 'caries', label: 'Caries', mark: 'C' },
  { code: 'filled', label: 'Filled', mark: 'F' },
  { code: 'missing', label: 'Missing', mark: 'X' },
];

function chartBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    numbering: 'FDI',
    conditions: catalog,
    teeth: [],
    history: [],
    treatmentPlan: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderChart(canEdit = true): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/chart') && (init?.method === undefined || init.method === 'GET')) {
      return Promise.resolve(jsonResponse(200, chartBody()));
    }
    if (init?.method === 'PUT') {
      return Promise.resolve(
        jsonResponse(200, {
          tooth: { tooth: '16', conditions: ['caries'], notes: 'Occlusal pit', updatedAt: null, updatedBy: null },
          unchanged: false,
        }),
      );
    }
    return Promise.resolve(jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } }));
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <MemoryRouter>
      <DentalChart organizationId={3} patientId={8} canEdit={canEdit} />
    </MemoryRouter>,
  );
  return fetchMock;
}

describe('DentalChart', () => {
  it('shows every permanent tooth and a sample only while nothing is recorded', async () => {
    const fetchMock = renderChart();
    expect(await screen.findByRole('button', { name: /Tooth 16, patient's upper right/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Tooth / })).toHaveLength(32);
    const callsBefore = fetchMock.mock.calls.length;
    const peeks = screen.getAllByRole('button', { name: 'Peek at an example' });
    expect(peeks.length).toBeGreaterThanOrEqual(3);
    fireEvent.click(peeks[0] as HTMLButtonElement);
    expect(screen.getByText(/tooth 16 marked caries/)).toBeInTheDocument();
    expect(screen.getByText(/Not saved data/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it('saves conditions and notes for the selected tooth', async () => {
    const fetchMock = renderChart(true);
    fireEvent.click(await screen.findByRole('button', { name: /Tooth 16, patient's upper right/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Caries' }));
    fireEvent.change(screen.getByLabelText('Notes for this tooth'), { target: { value: 'Occlusal pit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save tooth' }));

    await screen.findByText('Tooth chart saved.');
    const put = fetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === 'PUT');
    expect(put?.[0]).toBe('/api/organizations/3/patients/8/chart/teeth/16');
    expect(JSON.parse(String((put?.[1] as RequestInit).body))).toEqual({
      conditions: ['caries'],
      notes: 'Occlusal pit',
    });
  });

  it('keeps the chart read-only for someone who cannot edit patients', async () => {
    renderChart(false);
    fireEvent.click(await screen.findByRole('button', { name: /Tooth 11,/ }));
    expect(screen.getByRole('checkbox', { name: 'Caries' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save tooth' })).not.toBeInTheDocument();
    expect(screen.getByText('Only a clinic owner can update the chart.')).toBeInTheDocument();
  });

  it('labels teeth with Universal numbers when the clinic chooses that system', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(200, chartBody({ numbering: 'UNIVERSAL' })))),
    );
    render(
      <MemoryRouter>
        <DentalChart organizationId={3} patientId={8} canEdit={false} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('button', { name: /Tooth 1, patient's upper right/ })).toBeInTheDocument();
    expect(screen.getByText(/Universal \(US\)/)).toBeInTheDocument();
  });
});
