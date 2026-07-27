import { describe, expect, it } from 'vitest';
import { parseQuery, scoreMatch, searchableOf, type Searchable } from '../query';

const doc = (over: Partial<Searchable> = {}): Searchable => ({
  subject: '',
  people: '',
  body: '',
  ...over,
});

describe('parseQuery', () => {
  it('drops stop words and keeps the content', () => {
    expect(parseQuery('what did priya say about the window change').terms).toEqual([
      'priya',
      'window',
      'change',
    ]);
  });

  it('keeps a quoted phrase whole, stop words and all', () => {
    const q = parseQuery('"out of the office" dana');
    expect(q.required).toEqual(['out of the office']);
    expect(q.terms).toContain('out of the office');
    expect(q.terms).toContain('dana');
  });

  it('keeps an address in one piece', () => {
    expect(parseQuery('priya@atlasgrid.dev').terms).toEqual(['priya@atlasgrid.dev']);
  });

  it('drops duplicates', () => {
    expect(parseQuery('invoice invoice INVOICE').terms).toEqual(['invoice']);
  });

  it('drops single characters and bare punctuation', () => {
    expect(parseQuery('a — b invoice').terms).toEqual(['invoice']);
  });

  describe('isQuestion', () => {
    it.each([
      'what did priya say about the window change?',
      'who sent me the invoice last week',
      'did dana ever reply about the cap',
      'any receipts from stripe this month',
    ])('%s', (q) => {
      expect(parseQuery(q).isQuestion).toBe(true);
    });

    it.each(['invoice', 'dana', 'who', 'stripe receipt', 'window change'])(
      'is a lookup, not a question: %s',
      (q) => {
        expect(parseQuery(q).isQuestion).toBe(false);
      },
    );

    it('trusts a question mark over the length rule', () => {
      expect(parseQuery('dana?').isQuestion).toBe(true);
    });
  });
});

describe('scoreMatch', () => {
  it('is zero for a thread with none of the terms', () => {
    expect(scoreMatch(doc({ body: 'nothing relevant' }), parseQuery('invoice'))).toBe(0);
  });

  it('ranks a sender match above a subject match above a body match', () => {
    const q = parseQuery('dana');
    const person = scoreMatch(doc({ people: 'Dana Whitlock dana@lumen.com' }), q);
    const subject = scoreMatch(doc({ subject: 'notes from dana' }), q);
    const body = scoreMatch(doc({ body: 'dana mentioned it' }), q);
    expect(person).toBeGreaterThan(subject);
    expect(subject).toBeGreaterThan(body);
  });

  it('ranks three matched terms above one, wherever they landed', () => {
    const q = parseQuery('window change reconcile');
    const three = scoreMatch(doc({ body: 'window change reconcile' }), q);
    const one = scoreMatch(doc({ subject: 'window' }), q);
    expect(three).toBeGreaterThan(one);
  });

  it('excludes a thread missing a quoted phrase, however well it scores otherwise', () => {
    const q = parseQuery('"window change" priya');
    expect(scoreMatch(doc({ people: 'Priya Raman', body: 'the window then the change' }), q)).toBe(0);
    expect(scoreMatch(doc({ people: 'Priya Raman', body: 'the window change lands' }), q)).toBeGreaterThan(0);
  });

  it('is zero when the query had no usable terms at all', () => {
    expect(scoreMatch(doc({ body: 'anything' }), parseQuery('the and of'))).toBe(0);
  });

  it('does not match a short term inside a longer word', () => {
    // "what happened to the liability cap" pulled in a thread about project
    // scope, because `cap` is inside `capacity`.
    expect(scoreMatch(doc({ body: 'we are at capacity until March' }), parseQuery('cap'))).toBe(0);
    expect(scoreMatch(doc({ body: 'the liability cap moved' }), parseQuery('cap'))).toBeGreaterThan(0);
  });

  it('lets a longer term match the start of a longer word', () => {
    // A stem should still find its plural: this is the case word-for-word
    // matching would break.
    expect(scoreMatch(doc({ subject: 'Your invoices' }), parseQuery('invoic'))).toBeGreaterThan(0);
    expect(scoreMatch(doc({ subject: 'Renewal notice' }), parseQuery('renewa'))).toBeGreaterThan(0);
  });

  it('never matches a term starting mid-word, however long', () => {
    expect(scoreMatch(doc({ body: 'unsubscribe here' }), parseQuery('subscribe'))).toBe(0);
  });

  it('matches an address whose punctuation would otherwise be a regex', () => {
    const d = doc({ people: 'Priya Raman priya@atlasgrid.dev' });
    expect(scoreMatch(d, parseQuery('priya@atlasgrid.dev'))).toBeGreaterThan(0);
  });

  it('finds a two-word query the old substring match could not', () => {
    // `dana contract` never appears adjacent in any real message.
    const q = parseQuery('dana contract');
    const d = doc({ people: 'Dana Whitlock', subject: 'Contract redlines back from legal' });
    expect(scoreMatch(d, q)).toBeGreaterThan(0);
  });
});

describe('searchableOf', () => {
  it('flattens every sender and body in the conversation', () => {
    const s = searchableOf({
      subject: 'Plans',
      messages: [
        { body: 'first', from: { name: 'Ines Carvalho', email: 'ines@c.pt' } },
        { body: 'second', from: { name: 'Marc', email: 'marc@f.dev' } },
      ],
    });
    expect(s.subject).toBe('Plans');
    expect(s.people).toContain('Ines Carvalho');
    expect(s.people).toContain('marc@f.dev');
    expect(s.body).toContain('first');
    expect(s.body).toContain('second');
  });
});
