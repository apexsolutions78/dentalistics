import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ValidationError } from '../errors';

const MAX_RECEIPT_BYTES = 1_500_000;

const ALLOWED_TYPES = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['application/pdf', 'pdf'],
]);

const STORED_NAME = /^[a-f0-9]{32}\.(jpg|png|pdf)$/;

export function receiptRoot(): string {
  return process.env.PAYMENT_RECEIPT_DIR ?? path.join(process.cwd(), 'data', 'payment-receipts');
}

export interface ReceiptUpload {
  contentType: string;
  dataBase64: string;
}

export function parseReceiptUpload(value: unknown): ReceiptUpload | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('Invalid input', ['receipt must be an object or null']);
  }
  const receipt = value as Record<string, unknown>;
  if (typeof receipt.contentType !== 'string' || !ALLOWED_TYPES.has(receipt.contentType)) {
    throw new ValidationError('Invalid input', ['receipt must be a JPEG, PNG, or PDF']);
  }
  if (typeof receipt.dataBase64 !== 'string' || receipt.dataBase64.length === 0) {
    throw new ValidationError('Invalid input', ['receipt data is missing']);
  }
  return { contentType: receipt.contentType, dataBase64: receipt.dataBase64 };
}

export function decodeReceipt(upload: ReceiptUpload): { bytes: Buffer; extension: string } {
  const extension = ALLOWED_TYPES.get(upload.contentType);
  if (extension === undefined) {
    throw new ValidationError('Invalid input', ['receipt must be a JPEG, PNG, or PDF']);
  }
  const bytes = Buffer.from(upload.dataBase64, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_RECEIPT_BYTES) {
    throw new ValidationError('Invalid input', ['receipt must be between 1 byte and 1.5 MB']);
  }
  return { bytes, extension };
}

export async function writeReceipt(
  organizationId: number,
  upload: ReceiptUpload,
): Promise<{ storedName: string; contentType: string }> {
  const decoded = decodeReceipt(upload);
  const storedName = `${crypto.randomBytes(16).toString('hex')}.${decoded.extension}`;
  const dir = path.join(receiptRoot(), String(organizationId));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, storedName), decoded.bytes);
  return { storedName, contentType: upload.contentType };
}

export function resolveReceiptPath(organizationId: number, storedName: string): string {
  if (!STORED_NAME.test(storedName)) {
    throw new ValidationError('Invalid input', ['receipt file name is not valid']);
  }
  const root = path.resolve(receiptRoot());
  const full = path.resolve(root, String(organizationId), storedName);
  if (full !== root && !full.startsWith(`${root}${path.sep}`)) {
    throw new ValidationError('Invalid input', ['receipt file name is not valid']);
  }
  return full;
}
