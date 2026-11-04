export const TOOTH_CONDITIONS = [
  { code: 'caries', label: 'Caries', mark: 'C' },
  { code: 'filled', label: 'Filled', mark: 'F' },
  { code: 'crown', label: 'Crown', mark: 'Cr' },
  { code: 'missing', label: 'Missing', mark: 'X' },
  { code: 'implant', label: 'Implant', mark: 'I' },
  { code: 'root_canal', label: 'Root canal', mark: 'R' },
  { code: 'extraction_planned', label: 'Extraction planned', mark: 'E' },
  { code: 'fracture', label: 'Fracture', mark: 'Fx' },
  { code: 'bridge', label: 'Bridge', mark: 'B' },
  { code: 'veneer', label: 'Veneer', mark: 'V' },
] as const;

export type ToothConditionCode = (typeof TOOTH_CONDITIONS)[number]['code'];

const CONDITION_CODES = new Set<string>(TOOTH_CONDITIONS.map((item) => item.code));

export function isToothCondition(value: string): value is ToothConditionCode {
  return CONDITION_CODES.has(value);
}

/**
 * Permanent teeth in Universal order 1–32.
 * Upper right to upper left, then lower left to lower right.
 */
export const FDI_IN_UNIVERSAL_ORDER = [
  '18', '17', '16', '15', '14', '13', '12', '11',
  '21', '22', '23', '24', '25', '26', '27', '28',
  '38', '37', '36', '35', '34', '33', '32', '31',
  '41', '42', '43', '44', '45', '46', '47', '48',
] as const;

export type PermanentFdi = (typeof FDI_IN_UNIVERSAL_ORDER)[number];

const FDI_SET = new Set<string>(FDI_IN_UNIVERSAL_ORDER);

export function isPermanentFdi(value: string): value is PermanentFdi {
  return FDI_SET.has(value);
}

export function universalNumber(fdi: string): number {
  const index = FDI_IN_UNIVERSAL_ORDER.indexOf(fdi as PermanentFdi);
  if (index < 0) {
    throw new Error(`Unknown FDI tooth: ${fdi}`);
  }
  return index + 1;
}

export type ChartNumbering = 'FDI' | 'UNIVERSAL';

export function conditionCatalog(): Array<{ code: ToothConditionCode; label: string; mark: string }> {
  return TOOTH_CONDITIONS.map((item) => ({ code: item.code, label: item.label, mark: item.mark }));
}
