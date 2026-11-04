export function formatMinor(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  const digits = Number.isInteger(major) ? 0 : 2;
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(major);
}

export function minorToMajorInput(amountMinor: number): string {
  const major = amountMinor / 100;
  return Number.isInteger(major) ? String(major) : major.toFixed(2);
}

export function majorTextToMinor(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }
  const [whole, frac = ''] = trimmed.split('.');
  const minor = Number(whole) * 100 + Number((frac ?? '').padEnd(2, '0'));
  if (!Number.isInteger(minor) || minor < 1 || minor > 100_000_000) {
    return null;
  }
  return minor;
}
