const TOUR_PREFIX = 'dentalistics.tour.v1';

export type TourStatus = 'done' | 'skipped';

export function tourStorageKey(userId: number): string {
  return `${TOUR_PREFIX}.${userId}`;
}

export function readTourStatus(userId: number, storage: Storage = localStorage): TourStatus | null {
  try {
    const value = storage.getItem(tourStorageKey(userId));
    if (value === 'done' || value === 'skipped') return value;
    return null;
  } catch {
    return 'done';
  }
}

export function writeTourStatus(
  userId: number,
  status: TourStatus,
  storage: Storage = localStorage,
): void {
  try {
    storage.setItem(tourStorageKey(userId), status);
  } catch {
    // Private mode or a full quota should not trap the tour on screen.
  }
}
