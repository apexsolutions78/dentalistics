import { describe, expect, it } from 'vitest';
import { readTourStatus, tourStorageKey, writeTourStatus } from './tourStorage';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => Array.from(data.keys())[index] ?? null,
    removeItem: (key) => {
      data.delete(key);
    },
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe('tour storage', () => {
  it('keys the record by user id', () => {
    expect(tourStorageKey(4)).toBe('dentalistics.tour.v1.4');
    expect(tourStorageKey(9)).not.toBe(tourStorageKey(4));
  });

  it('reads only done or skipped', () => {
    const storage = memoryStorage();
    expect(readTourStatus(4, storage)).toBeNull();
    storage.setItem(tourStorageKey(4), 'later');
    expect(readTourStatus(4, storage)).toBeNull();
    writeTourStatus(4, 'skipped', storage);
    expect(readTourStatus(4, storage)).toBe('skipped');
    writeTourStatus(4, 'done', storage);
    expect(readTourStatus(4, storage)).toBe('done');
    expect(readTourStatus(9, storage)).toBeNull();
  });

  it('treats a broken read as already finished so the tour cannot trap the page', () => {
    const storage = memoryStorage();
    storage.getItem = () => {
      throw new Error('denied');
    };
    expect(readTourStatus(4, storage)).toBe('done');
  });

  it('ignores a broken write', () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error('quota');
    };
    expect(() => writeTourStatus(4, 'done', storage)).not.toThrow();
    expect(readTourStatus(4, storage)).toBeNull();
  });
});
