import { ValidationError } from '../errors';
import { normalizeEmail, normalizePhone, parseDateOnly } from '../validate';

export const PATIENT_IMPORT_TEMPLATE = 'name,phone,email,dob,notes\n';

export const IMPORT_FIELDS = ['name', 'phone', 'email', 'dob', 'notes'] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

export type ImportMapping = Record<ImportField, string>;

const MAX_CSV_CHARS = 400_000;
const MAX_ROWS = 500;

const SYNONYMS: Record<ImportField, readonly string[]> = {
  name: ['name', 'patient', 'patient name', 'full name', 'fullname'],
  phone: ['phone', 'mobile', 'telephone', 'phone number', 'mobile number'],
  email: ['email', 'e-mail', 'email address'],
  dob: ['dob', 'date of birth', 'birth date', 'birthday', 'birthdate'],
  notes: ['notes', 'note', 'comments', 'comment'],
};

export interface ImportPreviewRow {
  line: number;
  values: Record<ImportField, string>;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  dateOfBirth: string | null;
  notes: string | null;
  status: 'ready' | 'error' | 'duplicate';
  messages: string[];
}

export interface ImportPreview {
  headers: string[];
  mapping: ImportMapping;
  rows: ImportPreviewRow[];
  readyCount: number;
  errorCount: number;
  duplicateCount: number;
}

export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i] ?? '';
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      field = '';
      if (!(row.length === 1 && row[0] === '')) {
        rows.push(row);
      }
      row = [];
      continue;
    }
    field += ch;
  }
  if (inQuotes) {
    throw new ValidationError('Invalid CSV', ['A quoted field was not closed']);
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (!(row.length === 1 && row[0] === '')) {
      rows.push(row);
    }
  }
  return rows;
}

export function suggestMapping(headers: string[]): ImportMapping {
  const mapping: ImportMapping = { name: '', phone: '', email: '', dob: '', notes: '' };
  const used = new Set<string>();
  for (const field of IMPORT_FIELDS) {
    const synonyms = SYNONYMS[field];
    const match = headers.find((header) => {
      const key = header.trim().toLowerCase();
      return synonyms.includes(key) && !used.has(header);
    });
    if (match !== undefined) {
      mapping[field] = match;
      used.add(match);
    }
  }
  return mapping;
}

function emptyMapping(): ImportMapping {
  return { name: '', phone: '', email: '', dob: '', notes: '' };
}

export function readMapping(value: unknown, headers: string[]): ImportMapping {
  const suggested = suggestMapping(headers);
  if (value === undefined || value === null) {
    return suggested;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('Invalid input', ['mapping must be an object']);
  }
  const raw = value as Record<string, unknown>;
  const mapping = emptyMapping();
  for (const field of IMPORT_FIELDS) {
    const chosen = raw[field];
    if (chosen === undefined || chosen === null || chosen === '') {
      mapping[field] = '';
      continue;
    }
    if (typeof chosen !== 'string' || !headers.includes(chosen)) {
      throw new ValidationError('Invalid input', [`mapping.${field} must be one of the CSV columns`]);
    }
    mapping[field] = chosen;
  }
  if (mapping.name === '' && suggested.name !== '' && raw.name === undefined) {
    mapping.name = suggested.name;
  }
  if (mapping.phone === '' && suggested.phone !== '' && raw.phone === undefined) {
    mapping.phone = suggested.phone;
  }
  return mapping;
}

function cell(row: string[], headers: string[], headerName: string): string {
  if (headerName === '') {
    return '';
  }
  const index = headers.indexOf(headerName);
  if (index < 0) {
    return '';
  }
  return (row[index] ?? '').trim();
}

function splitName(name: string): { firstName: string; lastName: string } | { error: string } {
  const parts = name.trim().split(/\s+/).filter((part) => part !== '');
  if (parts.length < 2) {
    return { error: 'Name needs a first and last name.' };
  }
  const firstName = parts[0] ?? '';
  const lastName = parts.slice(1).join(' ');
  if (firstName.length > 80 || lastName.length > 80) {
    return { error: 'Name must be at most 80 characters for each of first and last name.' };
  }
  return { firstName, lastName };
}

function optionalDob(value: string): { date: string | null } | { error: string } {
  if (value === '') {
    return { date: null };
  }
  try {
    const date = parseDateOnly(value, 'dob');
    const today = new Date().toISOString().slice(0, 10);
    if (date < '1900-01-01' || date > today) {
      return { error: 'Date of birth must be from 1900-01-01 through today.' };
    }
    return { date };
  } catch {
    return { error: 'Date of birth must be YYYY-MM-DD.' };
  }
}

export function classifyImportRows(input: {
  csv: string;
  mapping?: unknown;
  existingPhones: readonly string[];
  existingEmails: readonly string[];
}): ImportPreview {
  if (typeof input.csv !== 'string' || input.csv.trim() === '') {
    throw new ValidationError('Invalid input', ['csv is required']);
  }
  if (input.csv.length > MAX_CSV_CHARS) {
    throw new ValidationError('Invalid input', [`csv must be at most ${MAX_CSV_CHARS} characters`]);
  }
  const table = parseCsv(input.csv);
  const headerRow = table[0];
  if (headerRow === undefined) {
    throw new ValidationError('Invalid input', ['csv needs a header row']);
  }
  const headers = headerRow.map((header) => header.trim());
  if (headers.some((header) => header === '')) {
    throw new ValidationError('Invalid input', ['every column in the header row needs a name']);
  }
  const mapping = readMapping(input.mapping, headers);
  if (mapping.name === '' || mapping.phone === '') {
    throw new ValidationError('Invalid input', ['Map both the name and phone columns before checking the file.']);
  }
  const dataRows = table.slice(1);
  if (dataRows.length > MAX_ROWS) {
    throw new ValidationError('Invalid input', [`A file can contain at most ${MAX_ROWS} patients.`]);
  }

  const knownPhones = new Set(input.existingPhones);
  const knownEmails = new Set(input.existingEmails.map((email) => email.toLowerCase()));
  const seenPhones = new Set<string>();
  const seenEmails = new Set<string>();
  const rows: ImportPreviewRow[] = [];

  dataRows.forEach((dataRow, index) => {
    const values: Record<ImportField, string> = {
      name: cell(dataRow, headers, mapping.name),
      phone: cell(dataRow, headers, mapping.phone),
      email: cell(dataRow, headers, mapping.email),
      dob: cell(dataRow, headers, mapping.dob),
      notes: cell(dataRow, headers, mapping.notes),
    };
    const messages: string[] = [];
    let firstName: string | null = null;
    let lastName: string | null = null;
    let phone: string | null = null;
    let email: string | null = null;
    let dateOfBirth: string | null = null;
    let notes: string | null = null;
    let invalid = false;

    const name = splitName(values.name);
    if ('error' in name) {
      messages.push(name.error);
      invalid = true;
    } else {
      firstName = name.firstName;
      lastName = name.lastName;
    }

    try {
      phone = normalizePhone(values.phone);
    } catch {
      messages.push('Phone must be 7-15 digits with an optional leading +.');
      invalid = true;
    }

    if (values.email !== '') {
      try {
        email = normalizeEmail(values.email);
      } catch {
        messages.push('Email must be a valid email address.');
        invalid = true;
        email = null;
      }
    }

    const dob = optionalDob(values.dob);
    if ('error' in dob) {
      messages.push(dob.error);
      invalid = true;
    } else {
      dateOfBirth = dob.date;
    }

    if (values.notes.length > 5000) {
      messages.push('Notes must be at most 5000 characters.');
      invalid = true;
    } else {
      notes = values.notes === '' ? null : values.notes;
    }

    let duplicate = false;
    if (phone !== null) {
      if (knownPhones.has(phone) || seenPhones.has(phone)) {
        messages.push(
          seenPhones.has(phone)
            ? 'The same phone appears earlier in this file.'
            : 'A patient with this phone already exists in the clinic.',
        );
        duplicate = true;
      }
    }
    if (email !== null) {
      if (knownEmails.has(email) || seenEmails.has(email)) {
        messages.push(
          seenEmails.has(email)
            ? 'The same email appears earlier in this file.'
            : 'A patient with this email already exists in the clinic.',
        );
        duplicate = true;
      }
    }
    if (phone !== null) {
      seenPhones.add(phone);
    }
    if (email !== null) {
      seenEmails.add(email);
    }

    let status: ImportPreviewRow['status'] = 'ready';
    if (invalid) {
      status = 'error';
    } else if (duplicate) {
      status = 'duplicate';
    }
    if (status === 'ready' && messages.length === 0) {
      messages.push('Ready to import.');
    }

    rows.push({
      line: index + 2,
      values,
      firstName,
      lastName,
      phone,
      email,
      dateOfBirth,
      notes,
      status,
      messages,
    });
  });

  return {
    headers,
    mapping,
    rows,
    readyCount: rows.filter((row) => row.status === 'ready').length,
    errorCount: rows.filter((row) => row.status === 'error').length,
    duplicateCount: rows.filter((row) => row.status === 'duplicate').length,
  };
}
