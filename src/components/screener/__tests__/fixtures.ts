import type { HeldSender } from '../../../types';

/** A minimal, deterministic held sender for component tests. */
export function makeHeld(id: string, overrides: Partial<HeldSender> = {}): HeldSender {
  return {
    sender: {
      id,
      name: `Sender ${id}`,
      email: `${id}@example.com`,
      status: 'unknown',
    },
    messages: [
      {
        id: `m-${id}`,
        threadId: `t-${id}`,
        from: { name: `Sender ${id}`, email: `${id}@example.com` },
        to: [{ name: 'Marc Ferrum', email: 'marc@ferrum.dev' }],
        cc: [],
        subject: `Subject for ${id}`,
        body: `Body for ${id}`,
        date: '2026-07-20T10:00:00.000Z',
        attachments: [],
        isFromUser: false,
      },
    ],
    ...overrides,
  };
}

export function makeHeldList(ids: string[]): HeldSender[] {
  return ids.map((id) => makeHeld(id));
}
