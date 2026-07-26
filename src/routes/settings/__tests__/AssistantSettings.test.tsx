import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AssistantSettings } from '../AssistantSettings';
import { useSettings, DEFAULT_BASE_URL } from '../../../store/settings';

describe('AssistantSettings behaviour toggles', () => {
  beforeEach(() => {
    useSettings.setState({
      provider: { provider: 'none', apiKey: '', baseUrl: DEFAULT_BASE_URL, model: '' },
      behaviour: { autoSummarize: true, screenerReads: true, matchWritingStyle: true },
    });
  });

  it('are disabled with aria-disabled when no provider is connected', () => {
    render(<AssistantSettings />);

    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(3);
    for (const el of switches) {
      expect(el).toHaveAttribute('aria-disabled', 'true');
      expect(el).toBeDisabled();
    }
  });

  it('are enabled once a provider is connected', () => {
    useSettings.setState({
      provider: { provider: 'anthropic', apiKey: 'sk-ant-1234567890', baseUrl: '', model: 'claude-sonnet-4-5' },
    });

    render(<AssistantSettings />);

    const switches = screen.getAllByRole('switch');
    for (const el of switches) {
      expect(el).not.toHaveAttribute('aria-disabled', 'true');
      expect(el).not.toBeDisabled();
    }
  });
});
