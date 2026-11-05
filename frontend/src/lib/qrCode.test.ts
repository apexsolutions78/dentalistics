import { describe, expect, it } from 'vitest';
import { qrMatrix, qrPath } from './qrCode';

describe('qrCode', () => {
  it('builds a square code with finder patterns and a quiet-zone path', () => {
    const matrix = qrMatrix('https://dentalistics.example/book/abc');
    expect(matrix.length).toBeGreaterThanOrEqual(21);
    expect(matrix.every((row) => row.length === matrix.length)).toBe(true);
    expect(matrix[0]?.slice(0, 7)).toEqual([true, true, true, true, true, true, true]);
    expect(matrix[0]?.[7]).toBe(false);
    const drawn = qrPath(matrix, 4);
    expect(drawn.d.startsWith('M')).toBe(true);
    expect(drawn.size).toBe((matrix.length + 8) * 4);
  });
});
