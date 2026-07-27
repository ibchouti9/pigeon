/**
 * What a search box is given, versus what it was written for.
 *
 * Pigeon's search matched the whole query as one substring. That works for
 * `invoice` and for nothing else: `dana contract` found nothing, because no
 * message contains those two words adjacent, and `what did priya say about the
 * window change` found nothing for the same reason plus eight more.
 *
 * A query is terms. Quoted runs stay whole, stop words are dropped, and a
 * thread's score is how many distinct terms it matched and where. That fixes
 * two-word search on its own, and it is also the retrieval half of asking the
 * mailbox a question — the terms are what finds the threads a model is then
 * asked to read.
 */

/**
 * Dropped from term matching. Short, common, and — this is the point — the
 * words a question is made of. Keeping them would rank every thread containing
 * "the" above the one that actually answers.
 */
const STOP = new Set([
  'a', 'about', 'above', 'after', 'again', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'cant', 'could', 'did', 'do', 'does', 'doing', 'dont', 'down', 'during',
  'each', 'few', 'for', 'from', 'further', 'get', 'got', 'had', 'has', 'have', 'having',
  'he', 'her', 'here', 'hers', 'him', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its',
  'just', 'me', 'more', 'most', 'my', 'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once',
  'only', 'or', 'other', 'our', 'out', 'over', 'own', 'said', 'same', 'say', 'says',
  'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'them', 'then',
  'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up',
  'us', 'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom',
  'why', 'will', 'with', 'would', 'you', 'your', 'yours',
]);

export interface ParsedQuery {
  /** The raw string, trimmed. What the box shows and the URL carries. */
  raw: string;
  /** Distinct lowercase terms to match on, quoted runs kept whole. */
  terms: string[];
  /**
   * Terms the user quoted. These must all be present; the rest only score.
   * `"window change"` means that phrase, not those two words anywhere.
   */
  required: string[];
  /**
   * Whether this reads as a question rather than a lookup. Drives whether
   * Pigeon offers to answer it, never whether it searches.
   */
  isQuestion: boolean;
}

const QUESTION_WORD = /^(what|who|when|where|why|how|which|did|does|do|is|are|was|were|can|could|should|will|would|has|have|any)\b/i;

export function parseQuery(raw: string): ParsedQuery {
  const trimmed = raw.trim();

  const required: string[] = [];
  // Pull quoted runs out first so their inner stop words survive.
  const withoutQuotes = trimmed.replace(/"([^"]+)"/g, (_, phrase: string) => {
    const clean = phrase.trim().toLowerCase();
    if (clean) required.push(clean);
    return ' ';
  });

  const loose = withoutQuotes
    .toLowerCase()
    .split(/[^\p{L}\p{N}@._+-]+/u)
    .map((t) => t.replace(/^[._-]+|[._-]+$/g, ''))
    .filter((t) => t.length > 1 && !STOP.has(t));

  const terms = Array.from(new Set([...required, ...loose]));

  return {
    raw: trimmed,
    terms,
    required,
    /*
     * A question mark settles it. Otherwise: opens with a question word and is
     * long enough to be a sentence rather than a name. "who" alone is somebody
     * looking for a person called Who's mail, near enough.
     */
    isQuestion:
      trimmed.endsWith('?') ||
      (QUESTION_WORD.test(trimmed) && trimmed.split(/\s+/).length >= 4),
  };
}

/** The fields a thread offers to a search, flattened once per thread. */
export interface Searchable {
  subject: string;
  /** Every sender name and address in the conversation. */
  people: string;
  body: string;
}

const ESCAPE = /[.*+?^${}()|[\]\\]/g;

/**
 * Where a term is allowed to match.
 *
 * Plain `includes` is substring matching, and substring matching is why
 * "what happened to the liability cap" pulled in a thread about project scope:
 * `cap` is inside `capacity`. So a term has to start a word.
 *
 * Short terms have to *be* the word as well. `cap` matching `capacity` is
 * still wrong even at a word boundary, while `invoic` matching `invoices` and
 * `renew` matching `renewal` are exactly what a search should do — and the
 * difference between those cases is length. Under five characters a term is
 * usually a whole word already; over it, it is usually a stem.
 *
 * A quoted phrase is matched as typed: the user asked for those characters.
 */
function matcher(term: string): (field: string) => boolean {
  const escaped = term.replace(ESCAPE, '\\$&');
  if (/\s/.test(term)) return (field) => field.includes(term);
  const re = new RegExp(term.length < 5 ? `\\b${escaped}\\b` : `\\b${escaped}`, 'i');
  return (field) => re.test(field);
}

/**
 * How well one thread answers one query. Zero means it does not.
 *
 * Weighted by where the term landed, because a name in the From line and the
 * same name quoted in a signature are not equally good reasons to show a row.
 */
export function scoreMatch(doc: Searchable, query: ParsedQuery): number {
  if (query.terms.length === 0) return 0;

  const subject = doc.subject.toLowerCase();
  const people = doc.people.toLowerCase();
  const body = doc.body.toLowerCase();

  // A quoted phrase is a filter, not a score: miss one and the thread is out.
  for (const phrase of query.required) {
    if (!subject.includes(phrase) && !people.includes(phrase) && !body.includes(phrase)) return 0;
  }

  let score = 0;
  let hits = 0;
  for (const term of query.terms) {
    const test = matcher(term);
    let best = 0;
    if (test(people)) best = 5;
    else if (test(subject)) best = 3;
    else if (test(body)) best = 1;
    if (best === 0) continue;
    hits += 1;
    score += best;
  }

  if (hits === 0) return 0;

  /*
   * A thread matching three of four terms is a far better answer than one
   * matching a single common word, and raw addition does not say so loudly
   * enough — one term in a subject would otherwise tie with three in bodies.
   */
  return score * hits;
}

/** Everything the matcher needs, from a thread that may be a preview row. */
export function searchableOf(thread: {
  subject: string;
  messages: { body: string; from: { name: string; email: string } }[];
}): Searchable {
  return {
    subject: thread.subject ?? '',
    people: thread.messages.map((m) => `${m.from.name} ${m.from.email}`).join(' '),
    body: thread.messages.map((m) => m.body ?? '').join('\n'),
  };
}
