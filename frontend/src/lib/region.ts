const STORAGE_KEY = 'dentalistics.pricingRegion';

const BY_REGION: Record<string, string> = {
  US: 'us',
  AE: 'ae',
  CA: 'ca',
  GB: 'gb',
  IE: 'ie',
  AU: 'au',
  NZ: 'nz',
  PK: 'pk',
};

const BY_LANGUAGE: Record<string, string> = {
  ur: 'pk',
  en: 'us',
};

/** Browser locale only. No IP lookup. */
export function detectRegionCode(languages: readonly string[]): string {
  for (const tag of languages) {
    const region = /-([A-Za-z]{2})\b/.exec(tag);
    const subtag = region?.[1];
    if (subtag !== undefined) {
      const code = BY_REGION[subtag.toUpperCase()];
      if (code !== undefined) {
        return code;
      }
    }
  }
  for (const tag of languages) {
    const language = tag.toLowerCase().split('-')[0] ?? '';
    const code = BY_LANGUAGE[language];
    if (code !== undefined) {
      return code;
    }
  }
  return 'us';
}

export function readStoredRegion(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeRegion(code: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Private browsing can reject storage. The selector still works for this visit.
  }
}

export function pickRegion(
  codes: readonly string[],
  languages: readonly string[],
  stored: string | null,
): string {
  if (stored !== null && codes.includes(stored)) {
    return stored;
  }
  const detected = detectRegionCode(languages);
  if (codes.includes(detected)) {
    return detected;
  }
  if (codes.includes('us')) {
    return 'us';
  }
  return codes[0] ?? 'us';
}

export function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') {
    return ['en-US'];
  }
  if (navigator.languages.length > 0) {
    return navigator.languages;
  }
  return [navigator.language];
}
