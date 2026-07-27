import { describe, expect, it } from 'vitest';
import { citedSources, isRefusal, tidyAnswer } from '../prompts';

/**
 * Every input below is a shape llama3.2:3b actually produced on the first run
 * of this prompt. The model is right about the mail and wrong about when to
 * stop typing, and that is the whole job of this pass.
 */
describe('tidyAnswer', () => {
  it('leaves a clean answer alone', () => {
    const a = 'The liability cap moved from $1M to $500K [1].';
    expect(tidyAnswer(a)).toBe(a);
  });

  it('drops a footnote paragraph of bare citations', () => {
    expect(
      tidyAnswer('Sana objected to the tooling clause being struck.\n\n[2] [3]'),
    ).toBe('Sana objected to the tooling clause being struck.');
  });

  it('drops the answer repeated underneath itself', () => {
    expect(tidyAnswer('Not in this mail.\n\n[1] [2]\n\nNot in this mail.\n\n[3]')).toBe(
      'Not in this mail.',
    );
  });

  it('treats a repeat with different citations as the same paragraph', () => {
    expect(tidyAnswer('The cap is $500K [1].\n\nThe cap is $500K [2].')).toBe(
      'The cap is $500K [1].',
    );
  });

  it('enforces the three-sentence ceiling on a model that ignored it', () => {
    const five = 'One. Two. Three. Four. Five.';
    expect(tidyAnswer(five)).toBe('One. Two. Three.');
  });

  it('keeps two genuinely different paragraphs, up to the ceiling', () => {
    expect(tidyAnswer('The cap moved to $500K [1].\n\nSana would fight the tooling clause [2].')).toBe(
      'The cap moved to $500K [1]. Sana would fight the tooling clause [2].',
    );
  });

  it('returns nothing for a completion that was only citations', () => {
    expect(tidyAnswer('[1] [2]\n\n[3]')).toBe('');
  });

  it('survives an answer with no final full stop', () => {
    expect(tidyAnswer('EUR 248.00 [3]')).toBe('EUR 248.00 [3]');
  });
});

describe('citedSources', () => {
  it('reads citations in the order they were used, without repeats', () => {
    expect(citedSources('A [2]. B [1]. C [2].', 3)).toEqual([2, 1]);
  });

  it('ignores a citation past the number of sources supplied', () => {
    // A model that invents [9] against six sources has invented a source.
    expect(citedSources('Something [9].', 6)).toEqual([]);
  });

  it('finds the citations a footnote paragraph carried', () => {
    expect(citedSources('Sana objected.\n\n[2] [3]', 3)).toEqual([2, 3]);
  });

  it('returns nothing when the answer cited nothing', () => {
    expect(citedSources('Not in this mail.', 4)).toEqual([]);
  });
});

describe('isRefusal', () => {
  it.each(['Not in this mail.', 'not in this mail', '  Not in this mail.  '])('%s', (a) => {
    expect(isRefusal(a)).toBe(true);
  });

  it('is not fooled by an answer that merely mentions the phrase', () => {
    expect(isRefusal('Dana wrote that the cap is not in this mail thread [1].')).toBe(false);
  });
});
