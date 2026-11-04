/** Permanent teeth in Universal order 1–32. Must match src/clinical/teeth.ts. */
export const FDI_IN_UNIVERSAL_ORDER = [
  '18', '17', '16', '15', '14', '13', '12', '11',
  '21', '22', '23', '24', '25', '26', '27', '28',
  '38', '37', '36', '35', '34', '33', '32', '31',
  '41', '42', '43', '44', '45', '46', '47', '48',
] as const;

export type ChartNumbering = 'FDI' | 'UNIVERSAL';

export function universalNumber(fdi: string): number | null {
  const index = FDI_IN_UNIVERSAL_ORDER.indexOf(fdi as (typeof FDI_IN_UNIVERSAL_ORDER)[number]);
  return index < 0 ? null : index + 1;
}

export function displayTooth(fdi: string, numbering: ChartNumbering): string {
  if (numbering === 'UNIVERSAL') {
    const number = universalNumber(fdi);
    return number === null ? fdi : String(number);
  }
  return fdi;
}

export function upperTeeth(): readonly string[] {
  return FDI_IN_UNIVERSAL_ORDER.slice(0, 16);
}

export function lowerTeethVisual(): readonly string[] {
  return [...FDI_IN_UNIVERSAL_ORDER.slice(16)].reverse();
}

export function toothSide(fdi: string): string {
  switch (fdi[0]) {
    case '1':
      return "patient's upper right";
    case '2':
      return "patient's upper left";
    case '3':
      return "patient's lower left";
    case '4':
      return "patient's lower right";
    default:
      return 'tooth';
  }
}
