import { describe, expect, it } from 'vitest';
import {
  ANSWER_SYSTEM,
  cleanCompletion,
  draftSystem,
  dropEmptyPlaceholders,
  parseBullets,
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
