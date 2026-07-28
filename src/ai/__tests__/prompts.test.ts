import { describe, expect, it } from 'vitest';
import {
  ANSWER_SYSTEM,
  cleanCompletion,
  draftSystem,
  dropEmptyPlaceholders,
  parseBullets,
  parseObligationLines,
  parseSentence,
  SORT_SYSTEM,
  SUMMARY_SYSTEM,
  toneSystem,
  TRIAGE_SYSTEM,
} from '../prompts';

describe('cleanCompletion', () => {
  it('strips leaked thinking blocks', () => {
    expect(cleanCompletion('<thinking>weighing it up</thinking>\nThe answer.')).toBe('The answer.');
  });

  it('strips stray internal tags', () => {
    expect(cleanCompletion('<answer>Done.</answer>')).toBe('Done.');
  });

  it('leaves ordinary prose alone', () => {
    expect(cleanCompletion('  Dana needs a reply.  ')).toBe('Dana needs a reply.');
  });
});

describe('parseBullets', () => {
  it('accepts the documented "- " format', () => {
    expect(parseBullets('- One thing.\n- Another thing.')).toEqual([
      'One thing.',
      'Another thing.',
    ]);
  });

  it('accepts other bullet glyphs and blank lines', () => {
    expect(parseBullets('• One.\n\n* Two.')).toEqual(['One.', 'Two.']);
  });

  it('caps at 3 bullets (§7.9)', () => {
    expect(parseBullets('- a\n- b\n- c\n- d')).toHaveLength(3);
  });

  it('caps each bullet at 14 words (§7.9)', () => {
    const long = `- ${Array.from({ length: 20 }, (_, i) => `w${i}`).join(' ')}`;
    const [bullet] = parseBullets(long);
    expect(bullet.split(/\s+/)).toHaveLength(14);
    expect(bullet.endsWith('…')).toBe(true);
  });

  it('returns nothing for an empty completion', () => {
    expect(parseBullets('   ')).toEqual([]);
  });
});

describe('parseSentence', () => {
  it('takes the first line only', () => {
    expect(parseSentence('A warm intro.\nExtra chatter.', 18)).toBe('A warm intro.');
  });

  it('caps a screener read at 18 words (§7.9)', () => {
    const long = Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ');
    expect(parseSentence(long, 18).split(/\s+/)).toHaveLength(18);
  });
});

/**
 * Found by running the tone controls against qwen2.5:32b: a draft containing
 * no placeholder came back from all three carrying a bare `[confirm:]`. D26
 * blocks Send on any `[confirm:`, so pressing a tone button on a finished
 * reply made it unsendable, and the helper line asked the user to replace
 * something that never said what it wanted.
 */
describe('dropEmptyPlaceholders', () => {
  it('removes a placeholder that asks for nothing', () => {
    expect(dropEmptyPlaceholders('Aim to finalize by Thursday [confirm:].')).toBe(
      'Aim to finalize by Thursday.',
    );
  });

  it('keeps one that names what is missing — that one is the feature', () => {
    const body = 'Does [confirm: a time on Thursday] work?';
    expect(dropEmptyPlaceholders(body)).toBe(body);
  });

  it('tidies the punctuation the removal strands', () => {
    expect(dropEmptyPlaceholders('Please confirm by [confirm: ] .')).toBe('Please confirm by.');
  });

  it('leaves a sign-off that lost its placeholder readable', () => {
    expect(dropEmptyPlaceholders('Best regards,\n\n[confirm:]')).toBe('Best regards,');
  });

  it('handles a draft with no placeholders at all', () => {
    expect(dropEmptyPlaceholders('Sending Friday.')).toBe('Sending Friday.');
  });
});

/**
 * §7.9's Universal block bans the first person, and its Draft Replies block
 * asks the model to match the register of the reader's own sent mail. Applied
 * to both, the first rule won and drafts came back as subject-less telegram
 * English: "Agreed to push back on the tooling clause. On the liability cap,
 * willing to accept $750K as compromise."
 */
describe('who each prompt is speaking as', () => {
  it('forbids the first person where Pigeon describes mail', () => {
    for (const prompt of [SUMMARY_SYSTEM, SORT_SYSTEM, ANSWER_SYSTEM, TRIAGE_SYSTEM]) {
      expect(prompt).toContain('Never use the first person');
    }
  });

  it('asks for it where Pigeon writes as the reader', () => {
    expect(draftSystem(undefined)).not.toContain('Never use the first person');
    expect(draftSystem(undefined)).toContain('first person');
    for (const tone of ['shorter', 'friendlier', 'firmer'] as const) {
      expect(toneSystem(tone)).not.toContain('Never use the first person');
    }
  });

  it('tells the tones to reproduce placeholders, never to write one', () => {
    for (const tone of ['shorter', 'friendlier', 'firmer'] as const) {
      expect(toneSystem(tone)).toContain('Never write a new');
      expect(toneSystem(tone)).toContain('never write an empty');
    }
  });
});

/**
 * The ledger's parser. Its own rather than `parseLaneLines` because this
 * format has three fields and the label is the middle one — the lane parser
 * hunts for the label anywhere and takes everything else as evidence, which
 * folds the deadline into the obligation text.
 */
describe('parseObligationLines', () => {
  it('reads the three fields', () => {
    expect(parseObligationLines('1: decide the liability cap — needs-you — Friday')).toEqual([
      { n: 1, kind: 'needs-you', what: 'decide the liability cap', due: 'Friday' },
    ]);
  });

  it('treats the prompt’s own word for no deadline as none', () => {
    const [line] = parseObligationLines('2: send the scope — needs-you — no date');
    expect(line.due).toBeUndefined();
    expect(line.what).toBe('send the scope');
  });

  it('accepts a hyphen where a model substitutes one for the em dash', () => {
    const [line] = parseObligationLines('3: confirm the talk title - needs-you - the 12th');
    // The hyphen inside "needs-you" must not split the line.
    expect(line.kind).toBe('needs-you');
    expect(line.due).toBe('the 12th');
  });

  it('drops a conversation that owes nothing', () => {
    expect(parseObligationLines('1: none\n2: none')).toEqual([]);
  });

  it('drops a label with nothing attached to it', () => {
    expect(parseObligationLines('1: — needs-you — Friday')).toEqual([]);
  });

  it('takes the first answer when a model answers a row twice', () => {
    const lines = parseObligationLines(
      '1: decide the cap — needs-you — Friday\n1: something else — waiting-on — no date',
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].what).toBe('decide the cap');
  });

  it('ignores prose the model wrapped its answer in', () => {
    const lines = parseObligationLines(
      "Here is what I found:\n\n1: pay the invoice — you-promised — the 3rd\n\nThat's everything.",
    );
    expect(lines).toEqual([
      { n: 1, kind: 'you-promised', what: 'pay the invoice', due: 'the 3rd' },
    ]);
  });
});
