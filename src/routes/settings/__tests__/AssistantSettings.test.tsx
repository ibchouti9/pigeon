import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AssistantSettings } from '../AssistantSettings';
import { useSettings, DEFAULT_BASE_URL } from '../../../store/settings';

describe('AssistantSettings behaviour toggles', () => {
  beforeEach(() => {
    useSettings.setState({
      provider: { provider: 'none', apiKey: '', baseUrl: DEFAULT_BASE_URL, model: '' },
      behaviour: { autoSummarize: true, screenerReads: true, answerQuestions: true, matchWritingStyle: true, sortInbox: true },
    });
  });

  it('are disabled with aria-disabled when no provider is connected', () => {
    render(<AssistantSettings />);

    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(5);
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

/**
 * §5.13c always renders the Endpoint row, so every provider needs an answer for
 * it. The remote hostnames come from C-27's one list in `ai/client`; Settings
 * used to keep an identical private copy, which is how the two could drift.
 */
describe('the Endpoint row', () => {
  it('names the host a remote provider’s key is sent to', () => {
    useSettings.setState({
      provider: { provider: 'anthropic', apiKey: 'sk-ant-1234567890', baseUrl: '', model: 'claude-sonnet-5' },
    });
    render(<AssistantSettings />);
    expect(screen.getByText('api.anthropic.com')).toBeInTheDocument();
  });

  it('shows a local provider’s own base URL', () => {
    useSettings.setState({
      provider: { provider: 'local', apiKey: '', baseUrl: 'http://localhost:1234', model: 'llama3' },
    });
    render(<AssistantSettings />);
    expect(screen.getByText('http://localhost:1234')).toBeInTheDocument();
  });

  it('says what the demo is rather than leaving the row blank', () => {
    useSettings.setState({
      provider: { provider: 'demo', apiKey: '', baseUrl: DEFAULT_BASE_URL, model: 'demo' },
    });
    render(<AssistantSettings />);
    // A labelled row with nothing beside it reads as missing data, not as
    // "this one reaches nothing".
    expect(screen.getByText('none — canned replies')).toBeInTheDocument();
  });
});
