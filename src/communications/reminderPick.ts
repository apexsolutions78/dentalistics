/**
 * Choose the reminder offset whose wording is closest to how far away the
 * appointment is. A past appointment uses the largest offset, which is the
 * general reminder rather than an "in 2 hours" line. An equal distance
 * prefers the larger offset.
 */
export function pickReminderOffset(hoursUntil: number, offsets: readonly number[]): number {
  if (offsets.length === 0) {
    throw new Error('reminder offsets are empty');
  }
  const unique: number[] = [];
  for (const offset of offsets) {
    if (!unique.includes(offset)) {
      unique.push(offset);
    }
  }
  let largest = unique[0] as number;
  for (const offset of unique) {
    if (offset > largest) {
      largest = offset;
    }
  }
  if (!Number.isFinite(hoursUntil) || hoursUntil < 0) {
    return largest;
  }
  let best = unique[0] as number;
  let bestDiff = Math.abs(hoursUntil - best);
  for (const offset of unique) {
    const diff = Math.abs(hoursUntil - offset);
    if (diff < bestDiff || (diff === bestDiff && offset > best)) {
      best = offset;
      bestDiff = diff;
    }
  }
  return best;
}
