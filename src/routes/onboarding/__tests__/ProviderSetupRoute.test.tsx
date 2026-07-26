import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProviderSetupRoute } from '../ProviderSetupRoute';
import { DEFAULT_BASE_URL, useSettings } from '../../../store/settings';
import { testConnection } from '../../../ai/client';
import type { TestResult } from '../../../ai/types';

vi.mock('../../../ai/client', () => ({
  testConnection: vi.fn(),
  CURATED_MODELS: {
    anthropic: ['claude-sonnet-4-5', 'claude-haiku-4-5'],
    openai: ['gpt-5.1', 'gpt-5.1-mini'],
    google: ['gemini-3-pro', 'gemini-3-flash'],
    local: [],
    demo: ['demo'],
    none: [],
  },
}));

const mockedTest = vi.mocked(testConnection);

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={['/setup/provider']}>
      <Routes>
        <Route path="/setup/provider" element={<ProviderSetupRoute />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** §6 C-27 — the status-line state table behind O2's key field. */
describe('O2 provider status line (C-27)', () => {
  beforeEach(() => {
    useSettings.setState({
      provider: { provider: 'none', apiKey: '', baseUrl: DEFAULT_BASE_URL, model: '' },
      skippedProvider: false,
    });
    mockedTest.mockReset();
  });

  it('starts "empty" and switches to "entered" once a key is typed', () => {
    renderRoute();

    fireEvent.click(screen.getByRole('radio', { name: /Anthropic/ }));
    expect(screen.getByText('Your key is stored on this machine only.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save and continue' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('API KEY'), { target: { value: 'sk-ant-abc123' } });
    expect(screen.getByText('Press Test connection to check it works.')).toBeInTheDocument();
  });

  it('shows "testing" while the call is in flight, then "connected" on success', async () => {
    let resolveTest!: (r: TestResult) => void;
    mockedTest.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTest = resolve;
        }),
    );

    renderRoute();
    fireEvent.click(screen.getByRole('radio', { name: /Anthropic/ }));
    fireEvent.change(screen.getByLabelText('API KEY'), { target: { value: 'sk-ant-abc123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(await screen.findByText('Checking with Anthropic…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save and continue' })).toBeDisabled();

    await act(async () => {
      resolveTest({ ok: true, ms: 420 });
    });

    expect(await screen.findByText('Connected. Answered in 420 ms.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save and continue' })).toBeEnabled();
  });

  it('shows the §7.6 rejected message and keeps Save disabled on failure', async () => {
    mockedTest.mockResolvedValueOnce({
      ok: false,
      status: 'rejected',
      message: 'nope',
    });

    renderRoute();
    fireEvent.click(screen.getByRole('radio', { name: /Anthropic/ }));
    fireEvent.change(screen.getByLabelText('API KEY'), { target: { value: 'sk-ant-abc123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(
      await screen.findByText(
        "Anthropic rejected this key. Check it in your provider dashboard and paste it again.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save and continue' })).toBeDisabled();
  });

  it('names the provider in the local-unreachable message with the entered base URL', async () => {
    mockedTest.mockResolvedValueOnce({
      ok: false,
      status: 'unreachable',
      message: 'nope',
    });

    renderRoute();
    fireEvent.click(screen.getByRole('radio', { name: /Local/ }));
    fireEvent.change(screen.getByLabelText('BASE URL'), {
      target: { value: 'http://localhost:9999' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(
      await screen.findByText(
        'Nothing is answering at http://localhost:9999. Start your local model, then test again.',
      ),
    ).toBeInTheDocument();
  });
});
