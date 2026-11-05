/**
 * Local QR Code generator (ISO/IEC 18004), byte mode, error correction M.
 * Draws an SVG in the browser. It does not call a QR web service.
 */

const ECC_M = 0;

interface VersionSpec {
  version: number;
  size: number;
  align: readonly number[];
  remainder: number;
  ecc: number;
  blocks: ReadonlyArray<{ data: number }>;
}

// Error-correction M, versions 1-12. Enough for a clinic booking URL.
const VERSIONS: readonly VersionSpec[] = [
  { version: 1, size: 21, align: [], remainder: 0, ecc: 10, blocks: [{ data: 16 }] },
  { version: 2, size: 25, align: [6, 18], remainder: 7, ecc: 16, blocks: [{ data: 28 }] },
  { version: 3, size: 29, align: [6, 22], remainder: 7, ecc: 26, blocks: [{ data: 44 }] },
  { version: 4, size: 33, align: [6, 26], remainder: 7, ecc: 18, blocks: [{ data: 32 }, { data: 32 }] },
  { version: 5, size: 37, align: [6, 30], remainder: 7, ecc: 24, blocks: [{ data: 43 }, { data: 43 }] },
  {
    version: 6,
    size: 41,
    align: [6, 34],
    remainder: 7,
    ecc: 16,
    blocks: [{ data: 27 }, { data: 27 }, { data: 27 }, { data: 27 }],
  },
  {
    version: 7,
    size: 45,
    align: [6, 22, 38],
    remainder: 0,
    ecc: 18,
    blocks: [{ data: 31 }, { data: 31 }, { data: 31 }, { data: 31 }],
  },
  {
    version: 8,
    size: 49,
    align: [6, 24, 42],
    remainder: 0,
    ecc: 22,
    blocks: [{ data: 38 }, { data: 38 }, { data: 39 }, { data: 39 }],
  },
  {
    version: 9,
    size: 53,
    align: [6, 26, 46],
    remainder: 0,
    ecc: 22,
    blocks: [{ data: 36 }, { data: 36 }, { data: 36 }, { data: 37 }, { data: 37 }],
  },
  {
    version: 10,
    size: 57,
    align: [6, 28, 50],
    remainder: 0,
    ecc: 26,
    blocks: [{ data: 43 }, { data: 43 }, { data: 43 }, { data: 43 }, { data: 44 }],
  },
  {
    version: 11,
    size: 61,
    align: [6, 30, 54],
    remainder: 0,
    ecc: 30,
    blocks: [{ data: 50 }, { data: 51 }, { data: 51 }, { data: 51 }, { data: 51 }],
  },
  {
    version: 12,
    size: 65,
    align: [6, 32, 58],
    remainder: 0,
    ecc: 22,
    blocks: [
      { data: 36 },
      { data: 36 },
      { data: 36 },
      { data: 36 },
      { data: 36 },
      { data: 36 },
      { data: 37 },
      { data: 37 },
    ],
  },
];

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

function initField(): void {
  if (EXP[0] === 1) {
    return;
  }
  let value = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = value;
    LOG[value] = i;
    value <<= 1;
    if ((value & 0x100) !== 0) {
      value ^= 0x11d;
    }
  }
  for (let i = 255; i < 512; i += 1) {
    EXP[i] = EXP[i - 255] ?? 0;
  }
}

function mul(a: number, b: number): number {
  if (a === 0 || b === 0) {
    return 0;
  }
  return EXP[(LOG[a] ?? 0) + (LOG[b] ?? 0)] ?? 0;
}

function reedSolomon(data: Uint8Array, eccCount: number): Uint8Array {
  initField();
  let generator = new Uint8Array([1]);
  for (let i = 0; i < eccCount; i += 1) {
    const next = new Uint8Array(generator.length + 1);
    for (let j = 0; j < generator.length; j += 1) {
      const coeff = generator[j] ?? 0;
      next[j] = (next[j] ?? 0) ^ coeff;
      next[j + 1] = (next[j + 1] ?? 0) ^ mul(coeff, EXP[i] ?? 0);
    }
    generator = next;
  }
  const result = new Uint8Array(data.length + eccCount);
  result.set(data);
  for (let i = 0; i < data.length; i += 1) {
    const factor = result[i] ?? 0;
    if (factor === 0) {
      continue;
    }
    for (let j = 0; j < generator.length; j += 1) {
      result[i + j] = (result[i + j] ?? 0) ^ mul(generator[j] ?? 0, factor);
    }
  }
  return result.slice(data.length);
}

function bitsFromBytes(bytes: Uint8Array): number[] {
  const bits: number[] = [];
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i -= 1) {
      bits.push((byte >> i) & 1);
    }
  }
  return bits;
}

function pushBits(out: number[], value: number, length: number): void {
  for (let i = length - 1; i >= 0; i -= 1) {
    out.push((value >> i) & 1);
  }
}

function dataCodewords(text: string, spec: VersionSpec): Uint8Array {
  const bytes = new TextEncoder().encode(text);
  const countBits = spec.version < 10 ? 8 : 16;
  const capacity = spec.blocks.reduce((sum, block) => sum + block.data, 0);
  const bits: number[] = [];
  pushBits(bits, 0b0100, 4);
  pushBits(bits, bytes.length, countBits);
  for (const byte of bytes) {
    pushBits(bits, byte, 8);
  }
  const capacityBits = capacity * 8;
  const terminator = Math.min(4, capacityBits - bits.length);
  for (let i = 0; i < terminator; i += 1) {
    bits.push(0);
  }
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }
  const pad = [0xec, 0x11];
  let padIndex = 0;
  while (bits.length < capacityBits) {
    pushBits(bits, pad[padIndex % 2] ?? 0, 8);
    padIndex += 1;
  }
  const out = new Uint8Array(capacity);
  for (let i = 0; i < capacity; i += 1) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit += 1) {
      byte = (byte << 1) | (bits[i * 8 + bit] ?? 0);
    }
    out[i] = byte;
  }
  return out;
}

function interleave(spec: VersionSpec, data: Uint8Array): Uint8Array {
  const dataBlocks: Uint8Array[] = [];
  const eccBlocks: Uint8Array[] = [];
  let offset = 0;
  for (const block of spec.blocks) {
    const slice = data.slice(offset, offset + block.data);
    offset += block.data;
    dataBlocks.push(slice);
    eccBlocks.push(reedSolomon(slice, spec.ecc));
  }
  const out: number[] = [];
  const maxData = Math.max(...spec.blocks.map((block) => block.data));
  for (let i = 0; i < maxData; i += 1) {
    for (const block of dataBlocks) {
      if (i < block.length) {
        out.push(block[i] ?? 0);
      }
    }
  }
  for (let i = 0; i < spec.ecc; i += 1) {
    for (const block of eccBlocks) {
      out.push(block[i] ?? 0);
    }
  }
  return Uint8Array.from(out);
}

function chooseVersion(text: string): VersionSpec {
  const length = new TextEncoder().encode(text).length;
  for (const spec of VERSIONS) {
    const countBits = spec.version < 10 ? 8 : 16;
    const payloadBits = 4 + countBits + length * 8;
    const capacity = spec.blocks.reduce((sum, block) => sum + block.data, 0) * 8;
    if (payloadBits <= capacity) {
      return spec;
    }
  }
  throw new Error('Booking link is too long for a QR code');
}

function emptyMatrix(size: number): { dark: boolean[][]; reserved: boolean[][] } {
  const dark: boolean[][] = [];
  const reserved: boolean[][] = [];
  for (let row = 0; row < size; row += 1) {
    dark.push(Array.from({ length: size }, () => false));
    reserved.push(Array.from({ length: size }, () => false));
  }
  return { dark, reserved };
}

function setModule(
  dark: boolean[][],
  reserved: boolean[][],
  row: number,
  col: number,
  value: boolean,
): void {
  const line = dark[row];
  const hold = reserved[row];
  if (line === undefined || hold === undefined) {
    return;
  }
  line[col] = value;
  hold[col] = true;
}

function placeFinder(dark: boolean[][], reserved: boolean[][], row: number, col: number): void {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || cc < 0 || rr >= dark.length || cc >= dark.length) {
        continue;
      }
      const onEdge = r === -1 || r === 7 || c === -1 || c === 7;
      const onFrame = r === 0 || r === 6 || c === 0 || c === 6;
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      setModule(dark, reserved, rr, cc, !onEdge && (onFrame || inCore));
    }
  }
}

function inFinder(row: number, col: number, size: number): boolean {
  if (row <= 8 && col <= 8) return true;
  if (row <= 8 && col >= size - 9) return true;
  if (row >= size - 9 && col <= 8) return true;
  return false;
}

function placeAlignment(dark: boolean[][], reserved: boolean[][], centers: readonly number[]): void {
  const size = dark.length;
  for (const row of centers) {
    for (const col of centers) {
      if (inFinder(row, col, size)) {
        continue;
      }
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          const edge = Math.max(Math.abs(r), Math.abs(c)) === 2;
          const center = r === 0 && c === 0;
          setModule(dark, reserved, row + r, col + c, edge || center);
        }
      }
    }
  }
}

function placeTiming(dark: boolean[][], reserved: boolean[][]): void {
  const size = dark.length;
  for (let i = 0; i < size; i += 1) {
    if (reserved[6]?.[i] !== true) {
      setModule(dark, reserved, 6, i, i % 2 === 0);
    }
    if (reserved[i]?.[6] !== true) {
      setModule(dark, reserved, i, 6, i % 2 === 0);
    }
  }
}

function formatCells(i: number, size: number): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  if (i < 6) cells.push([i, 8]);
  else if (i < 8) cells.push([i + 1, 8]);
  else cells.push([size - 15 + i, 8]);
  if (i < 8) cells.push([8, size - i - 1]);
  else if (i < 9) cells.push([8, 15 - i]);
  else cells.push([8, 15 - i - 1]);
  return cells;
}

function reserveFormat(reserved: boolean[][]): void {
  const size = reserved.length;
  for (let i = 0; i < 15; i += 1) {
    for (const [row, col] of formatCells(i, size)) {
      const line = reserved[row];
      if (line !== undefined) line[col] = true;
    }
  }
  const dark = reserved[size - 8];
  if (dark !== undefined) dark[8] = true;
}

function bch(data: number, shift: number, generator: number): number {
  if (data === 0) {
    return 0;
  }
  let rem = data << shift;
  const genBits = Math.floor(Math.log2(generator));
  for (let i = Math.floor(Math.log2(data)) + shift; i >= genBits; i -= 1) {
    if (((rem >> i) & 1) !== 0) {
      rem ^= generator << (i - genBits);
    }
  }
  return rem;
}

function formatBits(mask: number): number {
  const data = (ECC_M << 3) | mask;
  return ((data << 10) | bch(data, 10, 0b10100110111)) ^ 0b101010000010010;
}

function versionBits(version: number): number {
  return (version << 12) | bch(version, 12, 0b1111100100101);
}

function placeFormat(dark: boolean[][], mask: number): void {
  const bits = formatBits(mask);
  const size = dark.length;
  for (let i = 0; i < 15; i += 1) {
    const on = ((bits >> i) & 1) === 1;
    for (const [row, col] of formatCells(i, size)) {
      const line = dark[row];
      if (line !== undefined) line[col] = on;
    }
  }
  const darkModule = dark[size - 8];
  if (darkModule !== undefined) darkModule[8] = true;
}

function placeVersion(dark: boolean[][], version: number): void {
  if (version < 7) {
    return;
  }
  const bits = versionBits(version);
  const size = dark.length;
  for (let i = 0; i < 18; i += 1) {
    const on = ((bits >> i) & 1) === 1;
    const row = Math.floor(i / 3);
    const col = size - 11 + (i % 3);
    const top = dark[row];
    const side = dark[col];
    if (top !== undefined) top[col] = on;
    if (side !== undefined) side[row] = on;
  }
}

function maskBit(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

function placeData(
  dark: boolean[][],
  reserved: boolean[][],
  codewords: Uint8Array,
  remainder: number,
  mask: number,
): void {
  const bits = bitsFromBytes(codewords);
  for (let i = 0; i < remainder; i += 1) {
    bits.push(0);
  }
  const size = dark.length;
  let index = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) {
      col = 5;
    }
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (let offset = 0; offset < 2; offset += 1) {
        const cc = col - offset;
        if (reserved[row]?.[cc] === true) {
          continue;
        }
        const bit = bits[index] ?? 0;
        index += 1;
        const line = dark[row];
        if (line !== undefined) {
          line[cc] = maskBit(mask, row, cc) ? bit === 0 : bit === 1;
        }
      }
    }
    upward = !upward;
  }
}

function penalty(dark: boolean[][]): number {
  const size = dark.length;
  let score = 0;
  const run = (cells: boolean[]): void => {
    let count = 1;
    for (let i = 1; i < cells.length; i += 1) {
      if (cells[i] === cells[i - 1]) {
        count += 1;
        if (count === 5) score += 3;
        else if (count > 5) score += 1;
      } else {
        count = 1;
      }
    }
  };
  for (let i = 0; i < size; i += 1) {
    run(dark[i] ?? []);
    run(dark.map((row) => row[i] === true));
  }
  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const value = dark[row]?.[col];
      if (
        value === dark[row]?.[col + 1] &&
        value === dark[row + 1]?.[col] &&
        value === dark[row + 1]?.[col + 1]
      ) {
        score += 3;
      }
    }
  }
  let darkCount = 0;
  for (const row of dark) {
    for (const cell of row) {
      if (cell) darkCount += 1;
    }
  }
  score += Math.floor(Math.abs(darkCount * 100 / (size * size) - 50) / 5) * 10;
  return score;
}

function build(text: string): boolean[][] {
  const spec = chooseVersion(text);
  const codewords = interleave(spec, dataCodewords(text, spec));
  const paint = (mask: number): boolean[][] => {
    const { dark, reserved } = emptyMatrix(spec.size);
    placeFinder(dark, reserved, 0, 0);
    placeFinder(dark, reserved, 0, spec.size - 7);
    placeFinder(dark, reserved, spec.size - 7, 0);
    placeAlignment(dark, reserved, spec.align);
    placeTiming(dark, reserved);
    reserveFormat(reserved);
    if (spec.version >= 7) {
      for (let i = 0; i < 18; i += 1) {
        const row = Math.floor(i / 3);
        const col = spec.size - 11 + (i % 3);
        const top = reserved[row];
        const side = reserved[col];
        if (top !== undefined) top[col] = true;
        if (side !== undefined) side[row] = true;
      }
    }
    placeData(dark, reserved, codewords, spec.remainder, mask);
    placeFormat(dark, mask);
    placeVersion(dark, spec.version);
    return dark;
  };
  let best = paint(0);
  let bestScore = penalty(best);
  for (let mask = 1; mask < 8; mask += 1) {
    const candidate = paint(mask);
    const score = penalty(candidate);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

export function qrMatrix(text: string): boolean[][] {
  return build(text);
}

export function qrPath(matrix: boolean[][], moduleSize = 4): { d: string; size: number } {
  const quiet = 4;
  const parts: string[] = [];
  matrix.forEach((row, r) => {
    row.forEach((on, c) => {
      if (!on) return;
      const x = (c + quiet) * moduleSize;
      const y = (r + quiet) * moduleSize;
      parts.push(`M${x} ${y}h${moduleSize}v${moduleSize}h-${moduleSize}z`);
    });
  });
  return {
    d: parts.join(''),
    size: (matrix.length + quiet * 2) * moduleSize,
  };
}
