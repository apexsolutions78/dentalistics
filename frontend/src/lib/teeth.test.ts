import { describe, expect, it } from 'vitest';
import { displayTooth, lowerTeethVisual, universalNumber, upperTeeth } from './teeth';

describe('tooth display numbers', () => {
  it('matches Universal numbering at the quadrant ends', () => {
    expect(universalNumber('18')).toBe(1);
    expect(universalNumber('11')).toBe(8);
    expect(universalNumber('21')).toBe(9);
    expect(universalNumber('28')).toBe(16);
    expect(universalNumber('38')).toBe(17);
    expect(universalNumber('31')).toBe(24);
    expect(universalNumber('41')).toBe(25);
    expect(universalNumber('48')).toBe(32);
    expect(displayTooth('18', 'FDI')).toBe('18');
    expect(displayTooth('18', 'UNIVERSAL')).toBe('1');
  });

  it('draws the upper arch left-to-right from the patient right side', () => {
    expect(upperTeeth()[0]).toBe('18');
    expect(upperTeeth()[7]).toBe('11');
    expect(upperTeeth()[8]).toBe('21');
    expect(lowerTeethVisual()[0]).toBe('48');
    expect(lowerTeethVisual()[8]).toBe('31');
  });
});
