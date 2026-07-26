import { describe, expect, it } from 'vitest';
import { getAiClient } from '../client';
import { DEFAULT_BASE_URL, type ProviderConfig } from '../../store/settings';
import type { AiClient } from '../types';
import type { Message } from '../../types';

const config: ProviderConfig = {
  provider: 'demo',
  apiKey: '',
  baseUrl: DEFAULT_BASE_URL,
  model: 'demo',
};

function client(): AiClient {
  const c = getAiClient(config);
  if (!c) throw new Error('the demo provider should always produce a client');
  return c;
}

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    threadId: 't1',
    from: { name: 'Ines Carvalho', email: 'ines@carvalho-arq.pt' },
    to: [{ name: 'Marc Ferrum', email: 'marc@ferrum.dev' }],
    cc: [],
    subject: 'Plans revision 3',
    body: 'Third revision attached. The stair moved again.',
    date: '2026-07-21T10:00:00.000Z',
    attachments: [],
    isFromUser: false,
    ...overrides,
  };
}

/**
 * The demo provider exists so every AI surface can be seen and reviewed without
 * a key. Two things it wasn't doing: the tone buttons echoed the draft straight
 * back, so §3.4 4a's crossfade and checked state were unobservable; and the
 * greeting fell back to a bare address, which is exactly the output §7.9 rules
 * out.
 */
describe('the demo assistant', () => {
  const draftInput = {
    messages: [message()],
    subject: 'Plans revision 3',
    recipients: ['Ines Carvalho <ines@carvalho-arq.pt>'],
    userName: 'Marc Ferrum',
  };

  it('drafts a reply carrying a [confirm:] placeholder, so D26 stays exercised', async () => {
    const body = await client().draftReply(draftInput);
    expect(body).toMatch(/\[confirm:[^\]]+\]/);
  });

  it('greets by first name when it has one', async () => {
    const body = await client().draftReply(draftInput);
    expect(body.split('\n')[0]).toBe('Hi Ines,');
  });

  it('never greets someone by their email address', async () => {
    const body = await client().draftReply({
      ...draftInput,
      recipients: ['ines@carvalho-arq.pt'],
    });
    expect(body.split('\n')[0]).toBe('Hi there,');
    expect(body).not.toContain('@');
  });

  describe('retone', () => {
    async function draft() {
      return client().draftReply(draftInput);
    }

    it('shortens rather than echoing', async () => {
      const base = await draft();
      const shorter = await client().retone(base, 'shorter');
      expect(shorter).not.toBe(base);
      expect(shorter.length).toBeLessThan(base.length);
    });

    it('adds a greeting and a closing courtesy for friendlier', async () => {
      const friendlier = await client().retone(await draft(), 'friendlier');
      expect(friendlier.split('\n')[0]).toBe('Hi there,');
      expect(friendlier).toContain('Thanks very much,');
    });

    it('tightens rather than echoing for firmer', async () => {
      const base = await draft();
      const firmer = await client().retone(base, 'firmer');
      expect(firmer).not.toBe(base);
    });

    it('keeps every [confirm:] placeholder through all three (§7.9)', async () => {
      const base = await draft();
      for (const tone of ['shorter', 'friendlier', 'firmer'] as const) {
        const out = await client().retone(base, tone);
        expect(out, `${tone} dropped the placeholder`).toMatch(/\[confirm:[^\]]+\]/);
      }
    });
  });
});
