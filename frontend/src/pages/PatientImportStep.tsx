import { useState } from 'react';
import { apiFetch, errorMessage } from '../lib/api';

const FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'dob', label: 'Date of birth' },
  { key: 'notes', label: 'Notes' },
] as const;

type FieldKey = (typeof FIELDS)[number]['key'];

interface PreviewRow {
  line: number;
  values: Record<FieldKey, string>;
  status: 'ready' | 'error' | 'duplicate';
  messages: string[];
}

interface Preview {
  headers: string[];
  mapping: Record<FieldKey, string>;
  rows: PreviewRow[];
  readyCount: number;
  errorCount: number;
  duplicateCount: number;
}

export function PatientImportStep({
  orgId,
  busy,
  onImported,
}: {
  orgId: number;
  busy: boolean;
  onImported: (count: number) => void;
}) {
  const [fileName, setFileName] = useState('');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<FieldKey, string> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [helpNote, setHelpNote] = useState('');
  const [helpSent, setHelpSent] = useState(false);

  async function downloadTemplate(): Promise<void> {
    const res = await fetch(`/api/organizations/${orgId}/patients/import-template`, {
      credentials: 'same-origin',
    });
    if (!res.ok) {
      setError('The template could not be downloaded.');
      return;
    }
    const text = await res.text();
    const blob = new Blob([text], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'patients-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function runPreview(nextCsv: string, nextMapping: Record<FieldKey, string> | null): Promise<void> {
    setWorking(true);
    setError(null);
    try {
      const result = await apiFetch<{ preview: Preview }>(
        `/api/organizations/${orgId}/patients/import/preview`,
        {
          method: 'POST',
          body: { csv: nextCsv, mapping: nextMapping ?? undefined },
        },
      );
      setPreview(result.preview);
      setMapping(result.preview.mapping);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setWorking(false);
    }
  }

  async function importReady(): Promise<void> {
    if (mapping === null) return;
    setWorking(true);
    setError(null);
    try {
      const result = await apiFetch<{ imported: number }>(`/api/organizations/${orgId}/patients/import`, {
        method: 'POST',
        body: { csv, mapping },
      });
      setMessage(`${result.imported} patient${result.imported === 1 ? '' : 's'} imported.`);
      onImported(result.imported);
      setPreview(null);
      setCsv('');
      setFileName('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setWorking(false);
    }
  }

  async function requestHelp(): Promise<void> {
    setWorking(true);
    setError(null);
    try {
      await apiFetch(`/api/organizations/${orgId}/setup-help`, {
        method: 'POST',
        body: { note: helpNote.trim() },
      });
      setHelpSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setWorking(false);
    }
  }

  const disabled = busy || working;

  return (
    <div>
      <p className="sub">
        Optional. Upload a CSV with name, phone, email, date of birth, and notes. You can skip this
        and add patients later.
      </p>
      <div className="btn-row">
        <button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => void downloadTemplate()}>
          Download template
        </button>
      </div>
      <label>
        CSV file
        <input
          aria-label="Patient CSV file"
          type="file"
          accept=".csv,text/csv"
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file === undefined) return;
            void file.text().then((text) => {
              setFileName(file.name);
              setCsv(text);
              setMapping(null);
              void runPreview(text, null);
            });
          }}
        />
      </label>
      {fileName !== '' ? <p className="text-muted">{fileName}</p> : null}
      {error !== null ? <p role="alert">{error}</p> : null}
      {message !== null ? <p role="status">{message}</p> : null}
      {preview !== null && mapping !== null ? (
        <div>
          {FIELDS.map((field) => (
            <label key={field.key}>
              {field.label} column
              <select
                aria-label={`${field.label} column`}
                value={mapping[field.key]}
                onChange={(event) => {
                  const next = { ...mapping, [field.key]: event.target.value };
                  setMapping(next);
                }}
              >
                <option value="">Not in this file</option>
                {preview.headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <button
            type="button"
            className="btn btn-secondary"
            disabled={disabled}
            onClick={() => void runPreview(csv, mapping)}
          >
            Check again
          </button>
          <p>
            {preview.readyCount} ready, {preview.errorCount} need a fix, {preview.duplicateCount}{' '}
            duplicates.
          </p>
          <div className="table-scroll table-cards">
            <table className="import-preview">
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.line}>
                    <td>{row.line}</td>
                    <td>{row.values.name}</td>
                    <td>{row.values.phone}</td>
                    <td>
                      {row.status}. {row.messages.join(' ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={disabled || preview.readyCount === 0}
            onClick={() => void importReady()}
          >
            Import {preview.readyCount} ready patients
          </button>
        </div>
      ) : null}

      <div style={{ marginTop: 'var(--space-4)' }}>
        <h2 className="card-title">Free setup help</h2>
        {helpSent ? (
          <p role="status">Request recorded. The operator can see it.</p>
        ) : (
          <>
            <label>
              Note (optional)
              <textarea
                className="input"
                aria-label="Setup help note"
                value={helpNote}
                onChange={(event) => setHelpNote(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={disabled}
              onClick={() => void requestHelp()}
            >
              Request free setup help
            </button>
          </>
        )}
      </div>
    </div>
  );
}
