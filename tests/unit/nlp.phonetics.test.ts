import { describe, it, expect } from 'vitest';
import { doubleMetaphone } from '../../server/utils/nlp/phonetics.ts';

describe('NLP Phonetics', () => {
  describe('doubleMetaphone', () => {
    it('returns correct primary and alternate for standard names', () => {
      const result = doubleMetaphone('Smith');
      expect(result.primary).toBe('SM0');
      expect(result.alternate).toBe('SM0');
    });

    it('encodes similar sounding names similarly', () => {
      const r1 = doubleMetaphone('Schmidt');
      expect(r1.primary).toBe('SKMT');
      
      const r2 = doubleMetaphone('John');
      const r3 = doubleMetaphone('Jon');
      expect(r2.primary).toBe(r3.primary);
    });

    it('handles empty or non-alphabetic strings', () => {
      expect(doubleMetaphone('')).toEqual({ primary: '', alternate: '' });
      expect(doubleMetaphone('123')).toEqual({ primary: '', alternate: '' });
    });
  });
});
