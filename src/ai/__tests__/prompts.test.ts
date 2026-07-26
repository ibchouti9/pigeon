import { describe, expect, it } from 'vitest';
import { cleanCompletion, parseBullets, parseSentence } from '../prompts';

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
