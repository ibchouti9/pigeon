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
      provider.send({
        to: [{ name: '', email: 'dana@lumenpartners.com' }],
        cc: [],
        bcc: [],
        subject: 'x',
        body: 'y',
      }),
    ).rejects.toSatisfy(
      (e: MailError) =>
        e.message ===
        "Gmail didn't accept this message. Check the recipient addresses and send again.",
    );
  });
});

describe('declining a sender (D7)', () => {
  it('creates a Pigeon/Declined filter that archives future mail, and deletes nothing', async () => {
    routes = [
      PROFILE,
      PEOPLE_ME,
      { match: /users\/me\/labels$/, body: { labels: [] } },
      { match: /settings\/filters/, body: { id: 'f1' } },
    ];
    const provider = new GmailMailProvider();
    await provider.getAccount();

    await provider.decideSender('spam@example.com', 'declined');

    const labelCreate = requests.find(
      (r) => /users\/me\/labels$/.test(r.url) && r.init?.method === 'POST',
    );
    expect(JSON.parse(String(labelCreate!.init!.body)).name).toBe('Pigeon/Declined');

    const filter = requests.find((r) => /settings\/filters/.test(r.url) && r.init?.method === 'POST');
    const payload = JSON.parse(String(filter!.init!.body)) as {
      criteria: { from: string };
      action: { addLabelIds: string[]; removeLabelIds: string[] };
    };
    expect(payload.criteria.from).toBe('spam@example.com');
    expect(payload.action.removeLabelIds).toContain('INBOX');

    // D8 — nothing is ever deleted.
    expect(requests.some((r) => r.init?.method === 'DELETE')).toBe(false);
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
