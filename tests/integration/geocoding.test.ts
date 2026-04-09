import { describe, it, expect, vi } from 'vitest';
import { queueGeocode } from '../../server/services/geocoding/index.ts';
import { normalizeLocationKey, getCachedGeocode, cacheGeocode } from '../../server/services/geocoding/cache.ts';

describe('Geocoding Integration Tests', () => {
  it('normalizes location keys accurately', () => {
    expect(normalizeLocationKey(' San Francisco , CA ')).toBe('san francisco, ca');
    expect(normalizeLocationKey('san  francisco,ca')).toBe('san francisco, ca');
  });

  it('skips processing if location is null or empty', () => {
    const fnCacheHit = vi.spyOn(console, 'log');
    queueGeocode('123', '');
    expect(fnCacheHit).not.toHaveBeenCalled();
  });
});
