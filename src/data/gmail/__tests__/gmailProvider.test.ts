import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GmailMailProvider } from '../gmailProvider';
import { MailError } from '../../provider';
import { encodeBase64Url, decodeBase64Url } from '../mime';

vi.mock('../auth', () => ({
  accessToken: vi.fn(async () => 'test-token'),
  AuthError: class AuthError extends Error {},
}));

/**
 * The Gmail path has never run against a real account, so its error mapping and
 * request shapes are covered here instead. These are the parts that decide what
 * a user sees when something goes wrong, and they are impossible to exercise by
 * clicking without an OAuth client.
 */

interface Route {
  match: RegExp;
  status?: number;
  body?: unknown;
  /** Throws at the transport level, the way an offline fetch does. */
  networkError?: boolean;
}

let routes: Route[] = [];
let requests: { url: string; init?: RequestInit }[] = [];

function stubFetch() {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    const route = routes.find((r) => r.match.test(String(url)));
    if (!route) {
      return new Response(JSON.stringify({}), { status: 200 });
    }
    if (route.networkError) throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(route.body ?? {}), { status: route.status ?? 200 });
  });
}

const PROFILE: Route = {
  match: /users\/me\/profile/,
  body: { emailAddress: 'marc@ferrum.dev', threadsTotal: 42 },
};

const PEOPLE_ME: Route = { match: /people\/me\?/, body: { names: [{ displayName: 'Marc Ferrum' }] } };

beforeEach(() => {
  routes = [];
  requests = [];
  localStorage.clear();
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('error mapping', () => {
  it('maps 401 to the revoked state, not a connection error', async () => {
    routes = [{ match: /users\/me\/profile/, status: 401 }];
    const provider = new GmailMailProvider();

    await expect(provider.getAccount()).rejects.toSatisfy(
      (e: MailError) => e.code === 'revoked',
    );
  });

  it('maps 403 to revoked as well', async () => {
    routes = [{ match: /users\/me\/profile/, status: 403 }];
    await expect(new GmailMailProvider().getAccount()).rejects.toSatisfy(
      (e: MailError) => e.code === 'revoked',
    );
  });

  it('maps 404 on a thread to not-found with the §7.6 copy', async () => {
    routes = [PROFILE, PEOPLE_ME, { match: /threads\/t1/, status: 404 }];
    const provider = new GmailMailProvider();
    await provider.getAccount();

    await expect(provider.getThread('t1')).rejects.toSatisfy(
      (e: MailError) => e.code === 'not-found' && e.message === "This thread didn't load. It's still in Gmail.",
    );
  });

  it('maps a transport failure to unreachable, not revoked', async () => {
    routes = [{ match: /users\/me\/profile/, networkError: true }];
    await expect(new GmailMailProvider().getAccount()).rejects.toSatisfy(
      (e: MailError) => e.code === 'unreachable',
    );
  });

  it('maps a 500 to unreachable', async () => {
    routes = [{ match: /users\/me\/profile/, status: 500 }];
    await expect(new GmailMailProvider().getAccount()).rejects.toSatisfy(
      (e: MailError) => e.code === 'unreachable',
    );
  });
});

describe('authorization', () => {
  it('sends the bearer token on every request', async () => {
    routes = [PROFILE, PEOPLE_ME];
    await new GmailMailProvider().getAccount();

    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      const headers = request.init?.headers as Record<string, string>;
      expect(headers.authorization).toBe('Bearer test-token');
    }
  });

  it('never puts the token in a URL', async () => {
    routes = [PROFILE, PEOPLE_ME];
    await new GmailMailProvider().getAccount();
    for (const request of requests) {
      expect(request.url).not.toContain('test-token');
    }
  });
});

describe('send', () => {
  it('builds an RFC 5322 message and posts it base64url-encoded', async () => {
    routes = [
      PROFILE,
      PEOPLE_ME,
      { match: /messages\/send/, body: { id: 'm1', threadId: 't1' } },
    ];
    const provider = new GmailMailProvider();
    await provider.getAccount();

    await provider.send({
      to: [{ name: 'Dana Whitlock', email: 'dana@lumenpartners.com' }],
      cc: [],
      bcc: [],
      subject: 'Re: Contract redlines',
      body: 'Happy with 750 as a middle.',
    });

    const sendRequest = requests.find((r) => /messages\/send/.test(r.url));
    expect(sendRequest).toBeDefined();

    const payload = JSON.parse(String(sendRequest!.init!.body)) as { raw: string };
    const decoded = decodeBase64Url(payload.raw);
    expect(decoded).toContain('From: Marc Ferrum <marc@ferrum.dev>');
    expect(decoded).toContain('To: Dana Whitlock <dana@lumenpartners.com>');
    expect(decoded).toContain('Happy with 750 as a middle.');
  });

  it('reports a rejected send with the §7.6 copy', async () => {
    routes = [PROFILE, PEOPLE_ME, { match: /messages\/send/, status: 400 }];
    const provider = new GmailMailProvider();
    await provider.getAccount();

    await expect(
      provider.send({ to: [], cc: [], bcc: [], subject: 'x', body: 'y' }),
    ).rejects.toSatisfy(
      (e: MailError) =>
        e.code === 'send-rejected' &&
        e.message ===
          "Gmail didn't accept this message. Check the recipient addresses and send again.",
    );
  });

  /**
   * Every failure used to be rewritten into "check the recipient addresses" —
   * so an expired token told the user to check addresses that were fine, and a
   * connection problem said the same.
   */
  it('does not blame the recipients for a revoked token', async () => {
    routes = [PROFILE, PEOPLE_ME, { match: /messages\/send/, status: 401 }];
    const provider = new GmailMailProvider();
    await provider.getAccount();

    await expect(
      provider.send({ to: [], cc: [], bcc: [], subject: 'x', body: 'y' }),
    ).rejects.toSatisfy((e: MailError) => e.code === 'revoked');
  });

  it('does not blame the recipients for being unable to reach Gmail', async () => {
    routes = [PROFILE, PEOPLE_ME, { match: /messages\/send/, networkError: true }];
    const provider = new GmailMailProvider();
    await provider.getAccount();

    await expect(
      provider.send({ to: [], cc: [], bcc: [], subject: 'x', body: 'y' }),
    ).rejects.toSatisfy((e: MailError) => e.code === 'unreachable');
  });
});

describe('declining a sender (D7)', () => {
  /**
   * D7's mechanism changed: Pigeon archives and labels the mail itself with
   * `gmail.modify` rather than installing a Gmail filter. A filter needs
   * `gmail.settings.basic`, a fifth scope §3.1's consent copy rules out — and
   * every filter call was 403ing silently, so a declined sender's mail kept
   * arriving in the real Gmail inbox while Pigeon reported success.
   */
  it('labels and archives the sender’s mail itself, and deletes nothing', async () => {
    routes = [
      PROFILE,
      PEOPLE_ME,
      { match: /users\/me\/labels$/, body: { labels: [], id: 'label1' } },
      { match: /threads\?/, body: { threads: [{ id: 'tx', historyId: '1' }] } },
      {
        match: /threads\/tx\?/,
        body: {
          id: 'tx',
          messages: [
            {
              id: 'mx',
              threadId: 'tx',
              internalDate: '1750000000000',
              labelIds: ['INBOX'],
              payload: {
                headers: [
                  { name: 'From', value: 'spam@example.com' },
                  { name: 'To', value: 'marc@ferrum.dev' },
                  { name: 'Subject', value: 'Buy this' },
                ],
                mimeType: 'text/plain',
                body: { data: encodeBase64Url('Hello.') },
              },
            },
          ],
        },
      },
      { match: /threads\/tx\/modify/, body: {} },
    ];
    const provider = new GmailMailProvider();
    await provider.listThreads('inbox');

    await provider.decideSender('spam@example.com', 'declined');

    const labelCreate = requests.find(
      (r) => /users\/me\/labels$/.test(r.url) && r.init?.method === 'POST',
    );
    expect(JSON.parse(String(labelCreate!.init!.body)).name).toBe('Pigeon/Declined');

    // The mail already in the inbox is archived under it — the half a filter
    // could never have covered.
    const modify = requests.find((r) => /threads\/tx\/modify/.test(r.url));
    const payload = JSON.parse(String(modify!.init!.body)) as {
      addLabelIds: string[];
      removeLabelIds: string[];
    };
    expect(payload.removeLabelIds).toContain('INBOX');
    expect(payload.addLabelIds).toHaveLength(1);

    // D8 — nothing is ever deleted.
    expect(requests.some((r) => r.init?.method === 'DELETE')).toBe(false);
    // And no call needs a scope Pigeon never asked for.
    expect(requests.some((r) => /settings\/filters/.test(r.url))).toBe(false);
  });

  it('surfaces no old mail when a decline is reversed (§2.3)', async () => {
    routes = [PROFILE, PEOPLE_ME, { match: /users\/me\/labels$/, body: { labels: [], id: 'label1' } }];
    const provider = new GmailMailProvider();
    await provider.getAccount();

    await provider.decideSender('spam@example.com', 'declined');
    requests.length = 0;
    await provider.undecideSender('spam@example.com');

    // Nothing is un-archived and nothing is deleted; only the decision is
    // forgotten, so mail from here on reaches the inbox again.
    expect(requests.filter((r) => r.init?.method && r.init.method !== 'GET')).toHaveLength(0);
  });

  it('records an approval without touching Gmail', async () => {
    routes = [PROFILE, PEOPLE_ME];
    const provider = new GmailMailProvider();
    await provider.getAccount();
    const before = requests.length;

    await provider.decideSender('dana@lumenpartners.com', 'approved');

    // Their mail is already in the inbox; there is nothing to change.
    expect(requests.length).toBe(before);
    expect(await provider.listSenders('approved')).toHaveLength(1);
  });
});

describe('the Screener split', () => {
  it('keeps unknown senders out of the inbox and holds them instead', async () => {
    const message = (id: string, from: string, subject: string) => ({
      id,
      threadId: `t-${id}`,
      labelIds: ['INBOX'],
      internalDate: '1750000000000',
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: from },
          { name: 'To', value: 'marc@ferrum.dev' },
          { name: 'Subject', value: subject },
        ],
        body: { data: encodeBase64Url('Hello.') },
      },
    });

    routes = [
      PROFILE,
      PEOPLE_ME,
      // No contacts, and no sent mail — so nobody is known.
      { match: /people\/me\/connections/, body: { connections: [] } },
      { match: /users\/me\/messages\?/, body: { messages: [] } },
      { match: /users\/me\/threads\?/, body: { threads: [{ id: 't-a' }] } },
      {
        match: /threads\/t-a/,
        body: { id: 't-a', messages: [message('a', 'Stranger <new@example.com>', 'Hi')] },
      },
    ];

    const provider = new GmailMailProvider();
    await provider.getAccount();

    expect(await provider.listThreads('inbox')).toHaveLength(0);

    const held = await provider.listHeld();
    expect(held).toHaveLength(1);
    expect(held[0].sender.email).toBe('new@example.com');
  });
});

/**
 * §3.1 3b — "Start sync again — Pigeon will pick up where it stopped", and the
 * freshness that has to survive alongside it. The walk used to re-fetch every
 * thread it already had, so a retry was as slow as the first run; the first fix
 * cached them outright, which froze the mailbox at whatever it looked like on
 * first load. Gmail's own `historyId` settles both: it changes whenever
 * anything in the thread does.
 */
describe('the thread walk (§3.1 3b)', () => {
  function threadRoute(id: string, body = 'Body text.') {
    return {
      match: new RegExp(`threads/${id}\\?`),
      body: {
        id,
        messages: [
          {
            id: `m-${id}`,
            threadId: id,
            internalDate: '1750000000000',
            labelIds: ['INBOX'],
            payload: {
              headers: [
                { name: 'From', value: 'Dana Whitlock <dana@lumen.com>' },
                { name: 'To', value: 'marc@ferrum.dev' },
                { name: 'Subject', value: `Subject ${id}` },
              ],
              mimeType: 'text/plain',
              body: { data: encodeBase64Url(body) },
            },
          },
        ],
      },
    };
  }

  /** The listing, with each thread's change token. */
  function listRoute(entries: { id: string; historyId: string }[], nextPageToken?: string) {
    return { match: /threads\?/, body: { threads: entries, nextPageToken } };
  }

  const AT_V1 = [
    { id: 't1', historyId: '1' },
    { id: 't2', historyId: '1' },
    { id: 't3', historyId: '1' },
  ];

  function fetchesFor(id: string) {
    return requests.filter((r) => new RegExp(`threads/${id}\\?`).test(r.url)).length;
  }

  it('fetches a thread once and leaves it alone while it is unchanged', async () => {
    routes = [PROFILE, PEOPLE_ME, listRoute(AT_V1), threadRoute('t1'), threadRoute('t2'), threadRoute('t3')];
    const provider = new GmailMailProvider();

    await provider.listThreads('inbox');
    expect(fetchesFor('t1')).toBe(1);

    await provider.listThreads('inbox');
    expect(fetchesFor('t1')).toBe(1);
  });

  it('goes back for a thread whose historyId moved', async () => {
    routes = [PROFILE, PEOPLE_ME, listRoute(AT_V1), threadRoute('t1'), threadRoute('t2'), threadRoute('t3')];
    const provider = new GmailMailProvider();
    await provider.listThreads('inbox');

    // A new message arrived on t2, so Gmail hands back a different token for it.
    routes = [
      PROFILE,
      PEOPLE_ME,
      listRoute([{ id: 't1', historyId: '1' }, { id: 't2', historyId: '2' }, { id: 't3', historyId: '1' }]),
      threadRoute('t1'),
      threadRoute('t2', 'And a reply.'),
      threadRoute('t3'),
    ];
    await provider.listThreads('inbox');

    expect(fetchesFor('t2')).toBe(2);
    expect(fetchesFor('t1')).toBe(1);
    // Read from the cache rather than the list: §2.3 keeps unknown senders out
    // of the inbox, and this stub's sender is not in the known set.
    expect((await provider.getThread('t2')).messages[0].body).toBe('And a reply.');
  });

  it('fetches only what is actually missing after a partial run', async () => {
    routes = [
      PROFILE,
      PEOPLE_ME,
      listRoute(AT_V1),
      threadRoute('t1'),
      { match: /threads\/t2\?/, status: 500 },
      threadRoute('t3'),
    ];
    const provider = new GmailMailProvider();
    await provider.sync(() => {});
    expect(fetchesFor('t2')).toBe(1);

    routes = [PROFILE, PEOPLE_ME, listRoute(AT_V1), threadRoute('t1'), threadRoute('t2'), threadRoute('t3')];
    await provider.sync(() => {});

    expect(fetchesFor('t2')).toBe(2);
    expect(fetchesFor('t1')).toBe(1);
  });

  it('reports the threads it already had as progress, not as zero', async () => {
    routes = [PROFILE, PEOPLE_ME, listRoute(AT_V1), threadRoute('t1'), threadRoute('t2'), threadRoute('t3')];
    const provider = new GmailMailProvider();
    await provider.sync(() => {});

    const seen: number[] = [];
    await provider.sync((p) => {
      if (p.step === 'history') seen.push(p.done);
    });

    expect(seen[0]).toBe(3);
  });

  /**
   * The listing used to ask for one page and stop, so a real mailbox showed its
   * most recent 100 threads and silently pretended that was all of them.
   */
  it('follows nextPageToken rather than stopping at the first page', async () => {
    let served = 0;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const href = String(url);
      requests.push({ url: href, init });
      if (/users\/me\/profile/.test(href)) return new Response(JSON.stringify(PROFILE.body), { status: 200 });
      if (/people\/me\?/.test(href)) return new Response(JSON.stringify(PEOPLE_ME.body), { status: 200 });
      if (/threads\?/.test(href)) {
        served += 1;
        const page = served === 1
          ? { threads: [{ id: 'p1', historyId: '1' }], nextPageToken: 'more' }
          : { threads: [{ id: 'p2', historyId: '1' }] };
        return new Response(JSON.stringify(page), { status: 200 });
      }
      const id = href.match(/threads\/([^?]+)/)?.[1] ?? 'x';
      return new Response(JSON.stringify(threadRoute(id).body), { status: 200 });
    });

    const provider = new GmailMailProvider();
    await provider.listThreads('inbox');

    expect(served).toBe(2);
    // Both pages were walked and both threads hydrated — §2.3's filter is what
    // decides whether they reach the inbox, and that is tested elsewhere.
    expect(fetchesFor('p1')).toBe(1);
    expect(fetchesFor('p2')).toBe(1);
  });
});

/**
 * §5.11's meta line states a count, so the count has to mean something. Search
 * asked for one page of 50 and stopped, so a query matching five hundred
 * threads reported "50 results" — the size of the page, not of the answer. It
 * also fired one thread fetch per result at once, which is exactly what the
 * main walk batches to avoid.
 */
describe('search (§5.11)', () => {
  function detail(id: string) {
    return {
      id,
      messages: [
        {
          id: `m-${id}`,
          threadId: id,
          internalDate: '1750000000000',
          labelIds: ['INBOX'],
          payload: {
            headers: [
              { name: 'From', value: 'Dana Whitlock <dana@lumen.com>' },
              { name: 'To', value: 'marc@ferrum.dev' },
              { name: 'Subject', value: `Subject ${id}` },
            ],
            mimeType: 'text/plain',
            body: { data: encodeBase64Url('Body.') },
          },
        },
      ],
    };
  }

  /** Serves `pages` listing pages of `per` threads each, then stops. */
  function stubSearch(pages: number, per: number) {
    let served = 0;
    const inFlight = { now: 0, peak: 0 };
    vi.stubGlobal('fetch', async (url: string) => {
      const href = String(url);
      if (/users\/me\/profile/.test(href)) {
        return new Response(JSON.stringify(PROFILE.body), { status: 200 });
      }
      if (/people\/me\?/.test(href)) {
        return new Response(JSON.stringify(PEOPLE_ME.body), { status: 200 });
      }
      if (/threads\?/.test(href)) {
        served += 1;
        const start = (served - 1) * per;
        return new Response(
          JSON.stringify({
            threads: Array.from({ length: per }, (_, i) => ({ id: `s${start + i}`, historyId: '1' })),
            nextPageToken: served < pages ? `page${served}` : undefined,
          }),
          { status: 200 },
        );
      }

      inFlight.now += 1;
      inFlight.peak = Math.max(inFlight.peak, inFlight.now);
      await new Promise((r) => setTimeout(r, 1));
      inFlight.now -= 1;
      const id = href.match(/threads\/([^?]+)/)?.[1] ?? 'x';
      return new Response(JSON.stringify(detail(id)), { status: 200 });
    });
    return { listings: () => served, peak: () => inFlight.peak };
  }

  it('follows nextPageToken past the first page', async () => {
    const stub = stubSearch(3, 50);
    await new GmailMailProvider().search('atlas', false);
    expect(stub.listings()).toBeGreaterThan(1);
  });

  it('stops at the documented ceiling rather than walking forever', async () => {
    const stub = stubSearch(100, 100);
    await new GmailMailProvider().search('atlas', false);
    // 200 results at 100 per page.
    expect(stub.listings()).toBe(2);
  });

  it('batches the thread fetches instead of firing them all at once', async () => {
    const stub = stubSearch(1, 50);
    await new GmailMailProvider().search('atlas', false);
    expect(stub.peak()).toBeLessThanOrEqual(10);
  });

  it('asks for nothing at all below two characters', async () => {
    const stub = stubSearch(1, 50);
    const results = await new GmailMailProvider().search('a', false);
    expect(stub.listings()).toBe(0);
    expect(results).toEqual({ inbox: [], archive: [], held: [] });
  });
});

/**
 * The shell fires loadThreads, loadHeld and loadSenders together on mount, and
 * all three walk the inbox. Each used to start its own pagination before any
 * had populated the cache — three times the requests at exactly the moment a
 * first run can least afford them.
 */
describe('concurrent walks of the same place', () => {
  it('builds the known-sender set once, however many callers ask', async () => {
    let contactWalks = 0;
    vi.stubGlobal('fetch', async (url: string) => {
      const href = String(url);
      if (/users\/me\/profile/.test(href)) {
        return new Response(JSON.stringify(PROFILE.body), { status: 200 });
      }
      if (/people\/me\/connections/.test(href)) {
        contactWalks += 1;
        await new Promise((r) => setTimeout(r, 5));
        return new Response(JSON.stringify({ connections: [] }), { status: 200 });
      }
      if (/people\/me\?/.test(href)) {
        return new Response(JSON.stringify(PEOPLE_ME.body), { status: 200 });
      }
      if (/messages\?/.test(href)) {
        return new Response(JSON.stringify({ messages: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ threads: [] }), { status: 200 });
    });

    const provider = new GmailMailProvider();
    await Promise.all([provider.getKnownSenders(), provider.listContacts()]);

    expect(contactWalks).toBe(1);
  });

  it('shares one walk rather than starting three', async () => {
    let listings = 0;
    vi.stubGlobal('fetch', async (url: string) => {
      const href = String(url);
      if (/users\/me\/profile/.test(href)) {
        return new Response(JSON.stringify(PROFILE.body), { status: 200 });
      }
      if (/people\/me\?/.test(href)) {
        return new Response(JSON.stringify(PEOPLE_ME.body), { status: 200 });
      }
      if (/threads\?/.test(href)) {
        listings += 1;
        await new Promise((r) => setTimeout(r, 5));
        return new Response(JSON.stringify({ threads: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const provider = new GmailMailProvider();
    await Promise.all([
      provider.listThreads('inbox'),
      provider.listHeld(),
      provider.listSenders('approved'),
    ]);

    expect(listings).toBe(1);
  });

  it('walks again once the first has finished', async () => {
    let listings = 0;
    vi.stubGlobal('fetch', async (url: string) => {
      const href = String(url);
      if (/users\/me\/profile/.test(href)) {
        return new Response(JSON.stringify(PROFILE.body), { status: 200 });
      }
      if (/people\/me\?/.test(href)) {
        return new Response(JSON.stringify(PEOPLE_ME.body), { status: 200 });
      }
      if (/threads\?/.test(href)) {
        listings += 1;
        return new Response(JSON.stringify({ threads: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const provider = new GmailMailProvider();
    await provider.listThreads('inbox');
    await provider.listThreads('inbox');

    // Not a permanent cache — new mail has to be able to arrive.
    expect(listings).toBe(2);
  });
});

/**
 * D10 builds the known-sender set from contacts plus a sent-mail window. The
 * window's metadata fetches went out one per message in the page — up to a
 * hundred at once, during onboarding, which is exactly when a first run is
 * most likely to meet a 429.
 */
describe('the sent-mail scan (D10)', () => {
  it('batches its metadata fetches like every other fan-out', async () => {
    const inFlight = { now: 0, peak: 0 };
    vi.stubGlobal('fetch', async (url: string) => {
      const href = String(url);
      if (/users\/me\/profile/.test(href)) {
        return new Response(JSON.stringify(PROFILE.body), { status: 200 });
      }
      if (/people\//.test(href)) {
        return new Response(JSON.stringify({ names: [{ displayName: 'Marc' }] }), { status: 200 });
      }
      if (/messages\?/.test(href)) {
        return new Response(
          JSON.stringify({ messages: Array.from({ length: 100 }, (_, i) => ({ id: `m${i}` })) }),
          { status: 200 },
        );
      }
      if (/messages\//.test(href)) {
        inFlight.now += 1;
        inFlight.peak = Math.max(inFlight.peak, inFlight.now);
        await new Promise((r) => setTimeout(r, 1));
        inFlight.now -= 1;
        return new Response(
          JSON.stringify({ payload: { headers: [{ name: 'To', value: 'dana@lumen.com' }] } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ threads: [] }), { status: 200 });
    });

    await new GmailMailProvider().getKnownSenders();

    expect(inFlight.peak).toBeGreaterThan(0);
    expect(inFlight.peak).toBeLessThanOrEqual(10);
  });
});

/**
 * Gmail's threading guide is explicit: a reply needs In-Reply-To and References
 * as well as threadId. Without them every reply Pigeon sent detached into its
 * own thread, in Gmail and in the recipient's client, and the conversation the
 * user was reading never updated.
 */
describe('replying into a thread', () => {
  function stub(onSend: (body: unknown) => void) {
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const href = String(url);
      if (/users\/me\/profile/.test(href)) {
        return new Response(JSON.stringify(PROFILE.body), { status: 200 });
      }
      if (/people\/me\?/.test(href)) {
        return new Response(JSON.stringify(PEOPLE_ME.body), { status: 200 });
      }
      if (/messages\/send/.test(href)) {
        onSend(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ id: 'sent1', threadId: 'th1' }), { status: 200 });
      }
      if (/threads\/th1\?/.test(href)) {
        return new Response(
          JSON.stringify({
            id: 'th1',
            messages: [
              {
                id: 'm1',
                threadId: 'th1',
                internalDate: '1750000000000',
                labelIds: ['INBOX'],
                payload: {
                  headers: [
                    { name: 'From', value: 'Dana Whitlock <dana@lumen.com>' },
                    { name: 'To', value: 'marc@ferrum.dev' },
                    { name: 'Subject', value: 'Redlines' },
                    { name: 'Message-ID', value: '<first@lumen.com>' },
                  ],
                  mimeType: 'text/plain',
                  body: { data: encodeBase64Url('First.') },
                },
              },
              {
                id: 'm2',
                threadId: 'th1',
                internalDate: '1750000100000',
                labelIds: ['INBOX'],
                payload: {
                  headers: [
                    { name: 'From', value: 'Dana Whitlock <dana@lumen.com>' },
                    { name: 'To', value: 'marc@ferrum.dev' },
                    { name: 'Subject', value: 'Redlines' },
                    { name: 'Message-ID', value: '<second@lumen.com>' },
                  ],
                  mimeType: 'text/plain',
                  body: { data: encodeBase64Url('Second.') },
                },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ threads: [] }), { status: 200 });
    });
  }

  it('sets In-Reply-To to the newest message and References to the chain', async () => {
    let body: { raw?: string; threadId?: string } = {};
    stub((b) => (body = b as typeof body));

    const provider = new GmailMailProvider();
    await provider.getThread('th1');
    await provider.send({
      to: [{ name: '', email: 'dana@lumen.com' }],
      cc: [],
      bcc: [],
      subject: 'Re: Redlines',
      body: 'Agreed.',
      threadId: 'th1',
    });

    expect(body.threadId).toBe('th1');
    const raw = decodeBase64Url(body.raw!);
    expect(raw).toContain('In-Reply-To: <second@lumen.com>');
    expect(raw).toContain('References: <first@lumen.com> <second@lumen.com>');
  });

  it('sends a new message without them', async () => {
    let body: { raw?: string } = {};
    stub((b) => (body = b as typeof body));

    await new GmailMailProvider().send({
      to: [{ name: '', email: 'dana@lumen.com' }],
      cc: [],
      bcc: [],
      subject: 'Hello',
      body: 'Hi.',
    });

    expect(decodeBase64Url(body.raw!)).not.toContain('In-Reply-To:');
  });

  it('drops the cached copy of the thread it replied to', async () => {
    stub(() => {});
    const provider = new GmailMailProvider();
    await provider.getThread('th1');

    await provider.send({
      to: [{ name: '', email: 'dana@lumen.com' }],
      cc: [],
      bcc: [],
      subject: 'Re: Redlines',
      body: 'Agreed.',
      threadId: 'th1',
    });

    // A stale copy here is why the reply used not to appear after a reload.
    const refetched = await provider.getThread('th1');
    expect(refetched.messages).toHaveLength(2);
  });
});

/**
 * Gmail's budget is 6,000 quota units a minute and threads.get costs 40, so a
 * walk of any real mailbox meets a throttle. Google returns those as 429, and
 * as 403 with a rateLimitExceeded reason — and every one of them used to read
 * as "Google revoked Pigeon's permission. Connect your account again." A
 * throttle told the user their account had been disconnected, and the only
 * cure, waiting, is the one thing that message doesn't suggest.
 */
describe('throttling (Gmail quota)', () => {
  function rateLimited(status: number, body: unknown, succeedAfter: number) {
    let hits = 0;
    vi.stubGlobal('fetch', async (url: string) => {
      const href = String(url);
      if (/users\/me\/profile/.test(href)) {
        hits += 1;
        if (hits <= succeedAfter) {
          return new Response(JSON.stringify(body), { status });
        }
        return new Response(JSON.stringify(PROFILE.body), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    return () => hits;
  }

  const RATE_403 = { error: { errors: [{ reason: 'userRateLimitExceeded' }] } };

  it('retries a 429 and succeeds', async () => {
    const hits = rateLimited(429, {}, 2);
    const account = await new GmailMailProvider().getAccount();
    expect(account.email).toBe('marc@ferrum.dev');
    expect(hits()).toBe(3);
  });

  it('retries a rate-limit 403 rather than calling it revoked', async () => {
    const hits = rateLimited(403, RATE_403, 1);
    const account = await new GmailMailProvider().getAccount();
    expect(account.email).toBe('marc@ferrum.dev');
    expect(hits()).toBe(2);
  });

  it('says it is a rate limit, not a revoked account, once it gives up', async () => {
    // Real backoff is 1s, 2s, 4s, 8s — driven rather than waited out.
    vi.useFakeTimers();
    try {
      rateLimited(429, {}, 99);
      const pending = new GmailMailProvider().getAccount();
      const assertion = expect(pending).rejects.toSatisfy(
        (e: MailError) => e.code !== 'revoked' && /rate-limiting/.test(e.message),
      );
      await vi.runAllTimersAsync();
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('still calls a genuine authorization 403 revoked', async () => {
    rateLimited(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } }, 99);
    await expect(new GmailMailProvider().getAccount()).rejects.toSatisfy(
      (e: MailError) => e.code === 'revoked',
    );
  });

  it('does not retry an authorization failure', async () => {
    const hits = rateLimited(401, {}, 99);
    await expect(new GmailMailProvider().getAccount()).rejects.toThrow();
    expect(hits()).toBe(1);
  });

  it('handles a 204 with no body rather than choking on the JSON', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      const href = String(url);
      if (/users\/me\/profile/.test(href)) {
        return new Response(JSON.stringify(PROFILE.body), { status: 200 });
      }
      if (/people\/me\?/.test(href)) {
        return new Response(JSON.stringify(PEOPLE_ME.body), { status: 200 });
      }
      if (/modify/.test(href)) return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ threads: [] }), { status: 200 });
    });

    const provider = new GmailMailProvider();
    await provider.getAccount();
    await expect(provider.markRead('t1', true)).resolves.toBeUndefined();
  });
});

/**
 * §7.6 has a row for a contacts failure and O4 has the state built with the
 * exact copy — but the provider swallowed it, so `known` came back holding only
 * what the sent-scan found. O4 then said "Pigeon didn't find anyone to
 * propose", the inbox looked empty and the Screener held hundreds, with nothing
 * anywhere explaining why. Enabling the People API is a separate console step
 * from enabling the Gmail API, so this is a likely first run rather than an
 * edge.
 */
describe('when contacts cannot be read (§7.6)', () => {
  function stub(peopleStatus: number) {
    vi.stubGlobal('fetch', async (url: string) => {
      const href = String(url);
      if (/users\/me\/profile/.test(href)) {
        return new Response(JSON.stringify(PROFILE.body), { status: 200 });
      }
      if (/people\/me\/connections/.test(href)) {
        return new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED' } }), {
          status: peopleStatus,
        });
      }
      if (/people\/me\?/.test(href)) {
        return new Response(JSON.stringify(PEOPLE_ME.body), { status: 200 });
      }
      if (/messages\?/.test(href)) {
        return new Response(JSON.stringify({ messages: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ threads: [] }), { status: 200 });
    });
  }

  it('says so rather than reporting an empty address book', async () => {
    stub(403);
    await expect(new GmailMailProvider().getKnownSenders()).rejects.toSatisfy(
      (e: MailError) =>
        e.message ===
        "Pigeon couldn't read your contacts. You can approve senders one at a time in the Screener instead.",
    );
  });

  it('proposes senders normally when contacts do read', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      const href = String(url);
      if (/users\/me\/profile/.test(href)) {
        return new Response(JSON.stringify(PROFILE.body), { status: 200 });
      }
      if (/people\/me\/connections/.test(href)) {
        return new Response(
          JSON.stringify({
            connections: [
              { names: [{ displayName: 'Dana Whitlock' }], emailAddresses: [{ value: 'dana@lumen.com' }] },
            ],
          }),
          { status: 200 },
        );
      }
      if (/people\/me\?/.test(href)) {
        return new Response(JSON.stringify(PEOPLE_ME.body), { status: 200 });
      }
      if (/messages\?/.test(href)) {
        return new Response(JSON.stringify({ messages: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ threads: [] }), { status: 200 });
    });

    const senders = await new GmailMailProvider().getKnownSenders();
    expect(senders.map((s) => s.email)).toContain('dana@lumen.com');
  });
});

/**
 * The walk is shared between callers, and it used to keep only the first
 * caller's progress callback. If the shell's loadThreads started it before
 * `sync` asked, §5.2b's counter never moved until the whole walk resolved — on
 * the one screen whose entire job is showing that something is happening.
 */
describe('progress from a shared walk', () => {
  it('reports to every caller, not just the first', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      const href = String(url);
      if (/users\/me\/profile/.test(href)) {
        return new Response(JSON.stringify(PROFILE.body), { status: 200 });
      }
      if (/people\/me\?/.test(href)) {
        return new Response(JSON.stringify(PEOPLE_ME.body), { status: 200 });
      }
      if (/threads\?/.test(href)) {
        await new Promise((r) => setTimeout(r, 5));
        return new Response(JSON.stringify({ threads: [{ id: 'q1', historyId: '1' }] }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({
          id: 'q1',
          messages: [
            {
              id: 'mq',
              threadId: 'q1',
              internalDate: '1750000000000',
              labelIds: ['INBOX'],
              payload: {
                headers: [
                  { name: 'From', value: 'Dana <dana@lumen.com>' },
                  { name: 'Subject', value: 'Hi' },
                ],
                mimeType: 'text/plain',
                body: { data: encodeBase64Url('Body.') },
              },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const provider = new GmailMailProvider();
    const first = provider.listThreads('inbox');

    const ticks: number[] = [];
    const second = provider.sync((p) => {
      if (p.step === 'history') ticks.push(p.done);
    });

    await Promise.all([first, second]);
    expect(ticks.length).toBeGreaterThan(1);
  });
});

/**
 * `loadThreads` awaited the whole walk before the screen left its skeleton. On
 * a real 2,000-thread archive that is ~50 seconds at best, and around thirteen
 * minutes once Gmail's 6,000-units-a-minute budget throttles it — threads.get
 * costs 40 units apiece. The Inbox is walked during onboarding behind §5.2b's
 * progress bar; the Archive is walked the first time someone clicks it, with
 * nothing to look at.
 */
describe('a long walk fills the screen as it goes', () => {
  function stubPages(pageCount: number, perPage: number) {
    let served = 0;
    vi.stubGlobal('fetch', async (url: string) => {
      const href = String(url);
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });

      if (/users\/me\/profile/.test(href)) return json(PROFILE.body);
      if (/people\/me\?/.test(href)) return json(PEOPLE_ME.body);
      if (/people\/me\/connections/.test(href)) return json({ connections: [] });
      if (/messages\?/.test(href)) return json({ messages: [] });

      if (/threads\?/.test(href)) {
        served += 1;
        const start = (served - 1) * perPage;
        return json({
          threads: Array.from({ length: perPage }, (_, i) => ({
            id: `p${start + i}`,
            historyId: '1',
          })),
          nextPageToken: served < pageCount ? `page${served}` : undefined,
        });
      }

      const id = href.match(/threads\/([^?/]+)/)?.[1] ?? 'x';
      return json({
        id,
        messages: [
          {
            id: `m-${id}`,
            threadId: id,
            internalDate: '1750000000000',
            labelIds: [],
            payload: {
              headers: [
                { name: 'From', value: 'Dana <dana@lumen.com>' },
                { name: 'Subject', value: 'Hello' },
              ],
              mimeType: 'text/plain',
              body: { data: encodeBase64Url('Body.') },
            },
          },
        ],
      });
    });
  }

  it('publishes partial results long before the walk finishes', async () => {
    stubPages(1, 50);
    const sizes: number[] = [];

    const all = await new GmailMailProvider().listThreads('archive', (threads) =>
      sizes.push(threads.length),
    );

    // Batched ten at a time, so a fifty-thread page reports five times over.
    expect(sizes.length).toBeGreaterThan(1);
    expect(sizes[0]).toBeLessThan(all.length);
    expect(sizes[sizes.length - 1]).toBe(all.length);
  });

  it('only ever grows the list it publishes', async () => {
    stubPages(2, 30);
    const sizes: number[] = [];
    await new GmailMailProvider().listThreads('archive', (t) => sizes.push(t.length));

    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i], `page ${i} shrank`).toBeGreaterThanOrEqual(sizes[i - 1]);
    }
  });

  it('publishes newest first, so the list never reorders under the reader', async () => {
    stubPages(1, 30);
    let lastPage: { lastMessageAt: string }[] = [];
    await new GmailMailProvider().listThreads('archive', (t) => {
      lastPage = t;
    });

    const dates = lastPage.map((t) => t.lastMessageAt);
    expect(dates).toEqual([...dates].sort().reverse());
  });
});

/**
 * D7 — "declined senders' future mail is archived in Gmail under the label
 * Pigeon/Declined and **never appears in Pigeon**." §2.3's carve-out is only
 * for a sender who was already *approved*: their existing threads stay.
 *
 * These drive both places, because the filter takes `place` and the archive
 * branch is the one that was never exercised.
 */
describe('a declined sender appears in neither place', () => {
  function stubMailbox(sender: string) {
    const archivedIds = new Set<string>();
    const threads = [
      { id: 'a1', date: '2026-07-01T09:00:00.000Z' },
      { id: 'a2', date: '2026-07-02T09:00:00.000Z' },
    ];

    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const href = String(url);
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });

      if (/users\/me\/profile/.test(href)) return json(PROFILE.body);
      if (/people\/me\?/.test(href)) return json(PEOPLE_ME.body);
      if (/people\/me\/connections/.test(href)) return json({ connections: [] });
      if (/messages\?/.test(href)) return json({ messages: [] });
      if (/\/labels$/.test(href)) return json({ labels: [{ id: 'lbl', name: 'Pigeon/Declined' }] });
      if (/\/modify$/.test(href)) {
        const id = href.match(/threads\/([^/]+)\/modify/)?.[1];
        if (id && String(init?.body ?? '').includes('INBOX')) archivedIds.add(id);
        return json({ id });
      }

      if (/threads\?/.test(href)) {
        // Gmail's own split: the archive query is `-in:inbox`, so a thread that
        // `silence()` archived stops matching the inbox and starts matching it.
        const wantsArchive = /-in%3Ainbox|-in:inbox/.test(href);
        const visible = threads.filter((t) => archivedIds.has(t.id) === wantsArchive);
        return json({ threads: visible.map((t) => ({ id: t.id, historyId: '1' })) });
      }

      const id = href.match(/threads\/([^?/]+)/)?.[1];
      const thread = threads.find((t) => t.id === id);
      if (!thread) return json({});
      return json({
        id: thread.id,
        messages: [
          {
            id: `m-${thread.id}`,
            threadId: thread.id,
            labelIds: archivedIds.has(thread.id) ? [] : ['INBOX'],
            internalDate: String(Date.parse(thread.date)),
            payload: {
              headers: [
                { name: 'From', value: sender },
                { name: 'Subject', value: 'Hello' },
              ],
              mimeType: 'text/plain',
              body: { data: encodeBase64Url('Body.') },
            },
          },
        ],
      });
    });
  }

  it('hides them from the archive too, not just the inbox', async () => {
    stubMailbox('Recruiter <recruiter@example.com>');
    const provider = new GmailMailProvider();

    // The real sequence: their mail is waiting in the Screener, so it has been
    // walked — `silence()` only reaches threads the provider has cached.
    const held = await provider.listHeld();
    expect(held.map((h) => h.sender.email)).toContain('recruiter@example.com');

    await provider.decideSender('recruiter@example.com', 'declined');

    expect(await provider.listThreads('inbox')).toEqual([]);
    // D7's whole promise. `silence()` moves them out of the Gmail inbox, which
    // is exactly what makes them match the archive query.
    expect(await provider.listThreads('archive')).toEqual([]);
  });
});
