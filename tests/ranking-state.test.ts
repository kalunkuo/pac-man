import { describe, expect, it } from 'vitest';
import { reconcileChoice } from '../src/ui/ranking-state';

describe('reconcileChoice', () => {
  it('keeps the previous choice when it is still an option', () => {
    expect(reconcileChoice('b', ['a', 'b', 'c'], 'a')).toBe('b');
  });

  it('keeps an empty-string choice when it is an option', () => {
    expect(reconcileChoice('', ['', 'a'], 'a')).toBe('');
  });

  it('falls back to the default when the option disappeared', () => {
    expect(reconcileChoice('gone', ['a', 'b'], 'a')).toBe('a');
  });

  it('falls back to the default when there is no previous choice', () => {
    expect(reconcileChoice(undefined, ['a', 'b'], 'b')).toBe('b');
  });

  it('falls back to the default when there are no options', () => {
    expect(reconcileChoice('a', [], 'x')).toBe('x');
  });
});
