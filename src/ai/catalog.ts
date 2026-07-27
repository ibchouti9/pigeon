/**
 * Which model to run, ranked for the machine asking.
 *
 * The model field offered whatever Ollama had already pulled, in whatever
 * order the API returned it. That answers "what do I have" when the question
 * is "what should I use" — and for someone who installed Ollama last week to
 * try this app, the honest answer to the first question is "one thing, and it
 * is the wrong one".
 *
 * So: a curated list, ranked by how each model fits this Mac's memory, with
 * the ones already pulled marked and one of them recommended. The fit
 * thresholds are lifted deliberately from Buzz's share-compute picker
 * (`mesh_llm/catalog.rs`) rather than invented — two apps on the same machine
 * disagreeing about whether a 9GB model fits in 10GB would be worse than
 * either answer.
 *
 * Every model here is a non-reasoning instruction model, and that is the
 * selection rule rather than an accident. Pigeon asks for three bullets, one
 * sentence, a lane name; a reasoning model spends thirty seconds and several
 * thousand tokens thinking before it produces one, and Pigeon then throws the
 * thinking away.
 */

export type Fit = 'comfortable' | 'tight' | 'tradeoff' | 'too-large';

export interface CatalogModel {
  /** The Ollama tag, which is also what goes in the model field. */
  name: string;
  /** Download size in GB, at Ollama's default quantisation. */
  sizeGb: number;
  /** One line, shown under the name. Says what it is for, not what it is. */
  description: string;
}

export interface CatalogEntry extends CatalogModel {
  fit: Fit;
  /** Already pulled — this one will answer immediately. */
  installed: boolean;
  /** Pigeon's pick for this machine. Exactly one entry, or none. */
  recommended: boolean;
  /**
   * Shown above the fold. The recommended model plus the small safe one, so a
   * big machine still offers an explicitly lighter choice and a small machine
   * is never shown a wall of things it cannot run.
   */
  curated: boolean;
}

export interface Catalog {
  /** e.g. "Apple M3". Absent in the web build, which cannot survey hardware. */
  chip?: string;
  /** Usable AI memory in GB. Zero when unknown — fit is then not shown. */
  usableGb: number;
  recommended?: string;
  /** Ranked: recommended, then curated, then by fit, then largest first. */
  entries: CatalogEntry[];
}

/**
 * Sizes are Ollama's own download sizes at the default tag. They move when a
 * model is re-quantised, which is a reason to check them occasionally and not
 * a reason to fetch them: a picker that cannot rank until the network answers
 * is a picker that is empty exactly when someone is trying to get started.
 */
const MODELS: CatalogModel[] = [
  {
    name: 'llama3.2:3b',
    sizeGb: 2.0,
    description: 'Smallest that reliably holds a format. Runs on anything.',
  },
  {
    name: 'gemma3:4b',
    sizeGb: 3.3,
    description: 'A step up in judgement for about a gigabyte more.',
  },
  {
    name: 'qwen2.5:7b',
    sizeGb: 4.7,
    description: 'The sweet spot: reads a thread properly, still answers fast.',
  },
  {
    name: 'llama3.1:8b',
    sizeGb: 4.9,
    description: 'Steadier prose than the 7B, a shade slower.',
  },
  {
    name: 'mistral-nemo:12b',
    sizeGb: 7.1,
    description: 'Long context, good at summarising a conversation.',
  },
  {
    name: 'gemma3:12b',
    sizeGb: 8.1,
    description: 'Noticeably better at the Screener’s harder calls.',
  },
  {
    name: 'qwen2.5:14b',
    sizeGb: 9.0,
    description: 'Best judgement that still fits a 16GB Mac comfortably.',
  },
  {
    name: 'gemma3:27b',
    sizeGb: 17,
    description: 'For 32GB and up. Reads mail about as well as a hosted model.',
  },
  {
    name: 'qwen2.5:32b',
    sizeGb: 20,
    description: 'The most capable of these, if the memory is there.',
  },
  {
    name: 'llama3.3:70b',
    sizeGb: 43,
    description: 'Only worth it on 64GB or more.',
  },
];

/** The model offered when memory is unknown or very small. Always curated. */
const SAFE_PICK = 'llama3.2:3b';

/**
 * Thresholds from Buzz's `fit_code`. A model at 60% of usable memory leaves
 * room to actually work; past 110% it will not load at all.
 */
export function fitFor(sizeGb: number, usableGb: number): Fit {
  if (usableGb <= 0) return 'comfortable';
  if (sizeGb <= usableGb * 0.6) return 'comfortable';
  if (sizeGb <= usableGb * 0.9) return 'tight';
  if (sizeGb <= usableGb * 1.1) return 'tradeoff';
  return 'too-large';
}

const FIT_RANK: Record<Fit, number> = {
  comfortable: 0,
  tight: 1,
  tradeoff: 2,
  'too-large': 3,
};

export const FIT_LABEL: Record<Fit, string> = {
  comfortable: 'Fits well',
  tight: 'Tight',
  tradeoff: 'Trade-off',
  'too-large': 'Too large',
};

/**
 * The pick per memory tier, largest machine first.
 *
 * A ladder of judgements, not arithmetic over the size column. "Biggest that
 * fits" is the obvious rule and it is wrong: it chose `llama3.1:8b` over
 * `qwen2.5:7b` on a 16GB Mac because 4.9 is larger than 4.7, when the 7B is
 * the better instruction-follower and instruction-following is the entire job
 * here. Quality does not increase monotonically with bytes, especially across
 * families, so the choice is made by hand and the arithmetic only checks it.
 *
 * Buzz's catalog does the same thing for the same reason.
 */
const TIERS: { minUsableGb: number; name: string }[] = [
  { minUsableGb: 30, name: 'gemma3:27b' },
  { minUsableGb: 16, name: 'qwen2.5:14b' },
  { minUsableGb: 8, name: 'qwen2.5:7b' },
  { minUsableGb: 5.5, name: 'gemma3:4b' },
];

/**
 * Pigeon's calls are short and frequent — a lane pass, a Screener read, a
 * summary on open — so the recommendation must be comfortable rather than
 * merely loadable. A model that swaps on every one of those makes the whole
 * app feel broken in a way nobody traces back to the model picker.
 */
function pick(usableGb: number, installed: Set<string>): string {
  if (usableGb <= 0) {
    // No survey. Prefer something already pulled over recommending a download.
    return [...MODELS].reverse().find((m) => installed.has(m.name))?.name ?? SAFE_PICK;
  }
  for (const tier of TIERS) {
    if (usableGb < tier.minUsableGb) continue;
    const model = MODELS.find((m) => m.name === tier.name);
    // The ladder is a judgement; this is the check on it. A tier whose pick is
    // not comfortable on this machine falls through to the next one down.
    if (model && fitFor(model.sizeGb, usableGb) === 'comfortable') return tier.name;
  }
  return SAFE_PICK;
}

/** Ollama reports `qwen2.5:7b` and sometimes `qwen2.5:7b-instruct-q4_K_M`. */
function normalise(name: string): string {
  return name.replace(/:latest$/, '').toLowerCase();
}

export function buildCatalog(
  usableGb: number,
  installedNames: string[],
  chip?: string,
): Catalog {
  const installed = new Set(installedNames.map(normalise));
  const isInstalled = (name: string) => {
    const key = normalise(name);
    return [...installed].some((i) => i === key || i.startsWith(`${key}-`));
  };

  const recommended = pick(usableGb, new Set([...installed]));

  const entries: CatalogEntry[] = MODELS.map((m) => ({
    ...m,
    fit: fitFor(m.sizeGb, usableGb),
    installed: isInstalled(m.name),
    recommended: m.name === recommended,
    curated: m.name === recommended || m.name === SAFE_PICK,
  }));

  entries.sort(
    (a, b) =>
      Number(b.recommended) - Number(a.recommended) ||
      Number(b.curated) - Number(a.curated) ||
      FIT_RANK[a.fit] - FIT_RANK[b.fit] ||
      b.sizeGb - a.sizeGb,
  );

  return { chip, usableGb, recommended, entries };
}

/**
 * A model the user already has that Pigeon does not curate — someone else's
 * choice, kept selectable. Hiding it would mean a picker that silently drops
 * the model the user was already using.
 */
export function uncuratedInstalled(installedNames: string[]): string[] {
  const known = new Set(MODELS.map((m) => normalise(m.name)));
  return installedNames.filter((n) => {
    const key = normalise(n);
    return ![...known].some((k) => key === k || key.startsWith(`${k}-`));
  });
}
