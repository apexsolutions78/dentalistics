import { describe, expect, it } from 'vitest';
import { detectRegionCode, pickRegion } from './region';
import { formatMinor, majorTextToMinor } from './money';

describe('region from browser locale', () => {
  it('maps region subtags and does not call a network', () => {
    expect(detectRegionCode(['ur-PK', 'en-US'])).toBe('pk');
    expect(detectRegionCode(['en-AE'])).toBe('ae');
    expect(detectRegionCode(['en-GB'])).toBe('gb');
    expect(detectRegionCode(['en-CA'])).toBe('ca');
    expect(detectRegionCode(['en-IE'])).toBe('ie');
    expect(detectRegionCode(['en-AU'])).toBe('au');
    expect(detectRegionCode(['en-NZ'])).toBe('nz');
    expect(detectRegionCode(['fr-FR', 'de'])).toBe('us');
    expect(detectRegionCode(['ur'])).toBe('pk');
  });

  it('prefers a stored choice that the price table still has', () => {
    expect(pickRegion(['us', 'pk'], ['en-US'], 'pk')).toBe('pk');
    expect(pickRegion(['us', 'pk'], ['en-AE'], null)).toBe('us');
    expect(pickRegion(['us', 'ae'], ['en-AE'], null)).toBe('ae');
  });
});

describe('money formatting', () => {
  it('formats minor units and parses major text', () => {
    expect(formatMinor(4500, 'USD')).toBe('$45');
    expect(majorTextToMinor('20.50')).toBe(2050);
    expect(majorTextToMinor('20.555')).toBeNull();
  });
});
