import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { can } from '../../lib/capabilities';
import { apiFetch } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useSubmit } from '../../lib/useAsync';
import type { Paged, Patient } from '../../lib/types';
import {
  PATIENT_CURRENCIES,
  STATUS_LABELS,
  TAX_LABELS,
  formatMoney,
  majorToCents,
  type BillingSettings,
  type InvoiceSummary,
  type PatientBalance,
  type PatientCurrency,
  type TaxLabel,
} from '../../lib/patientBilling';
import { PageHeader } from '../../components/PageHeader';
import { Pager } from '../../components/Pager';
import { FormField } from '../../components/FormField';
import { Flash } from '../../components/Flash';
import { EmptyState, ErrorState, LoadingState, StatusBadge, type BadgeTone } from '../../components/states';
import { BillingLinks } from './BillingLinks';

const PAGE_SIZE = 20;

interface DraftLine {
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  taxPercent: string;
}

const EMPTY_LINE: DraftLine = {
  description: '',
  quantity: '1',
  unitPrice: '',
  discount: '0',
  taxPercent: '0',
};

function statusTone(status: InvoiceSummary['status']): BadgeTone {
  if (status === 'paid') return 'success';
  if (status === 'partially_paid') return 'warn';
  if (status === 'void') return 'danger';
  if (status === 'issued') return 'new';
  return 'default';
}

export function PatientBillingPage() {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? null;
  const canManage = can(user, 'patientBilling.manage');
  const [searchParams, setSearchParams] = useSearchParams();
  const [offset, setOffset] = useState(0);
  const [adding, setAdding] = useState(() => searchParams.get('new') === '1');
  const [lines, setLines] = useState<DraftLine[]>([{ ...EMPTY_LINE }]);
  const [notes, setNotes] = useState('');
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerSearch, setPickerSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<BillingSettings | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const { submit, saving, error: formError, clearFeedback, setError } = useSubmit();

  const query = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const patientId = searchParams.get('patientId') ?? '';
  const filtered = query !== '' || status !== '' || patientId !== '';

  const listPath = useMemo(() => {
    if (orgId === null) return null;
    const parts = [`limit=${PAGE_SIZE}`, `offset=${offset}`];
    if (query !== '') parts.push(`q=${encodeURIComponent(query)}`);
    if (status !== '') parts.push(`status=${encodeURIComponent(status)}`);
    if (patientId !== '') parts.push(`patientId=${encodeURIComponent(patientId)}`);
    return `/api/organizations/${orgId}/patient-billing/invoices?${parts.join('&')}`;
  }, [orgId, offset, query, status, patientId]);

  const list = useApi<Paged & { invoices: InvoiceSummary[]; balance: PatientBalance | null }>(listPath);
  const settingsQuery = useApi<{ settings: BillingSettings }>(
    orgId === null ? null : `/api/organizations/${orgId}/patient-billing/settings`,
  );
  const settings = settingsDraft ?? settingsQuery.data?.settings ?? null;

  const pickerPath =
    orgId === null || pickerSearch.trim() === ''
      ? null
      : `/api/organizations/${orgId}/patients?q=${encodeURIComponent(pickerSearch.trim())}&limit=8`;
  const picker = useApi<Paged & { patients: Patient[] }>(pickerPath);

  const saveSettings = async (): Promise<void> => {
    if (orgId === null || settings === null) return;
    const ok = await submit(async () => {
      const saved = await apiFetch<{ settings: BillingSettings }>(
        `/api/organizations/${orgId}/patient-billing/settings`,
        { method: 'PATCH', body: settings },
      );
      setSettingsDraft(saved.settings);
      return true;
    });
    if (ok !== null) setFlash('Billing settings saved.');
  };

  const createInvoice = async (): Promise<void> => {
    if (orgId === null || selectedPatient === null) return;
    const payload = lines.map((line) => {
      const unitPriceCents = majorToCents(line.unitPrice);
      const discountCents = majorToCents(line.discount === '' ? '0' : line.discount);
      const quantity = Number(line.quantity);
      const taxPercent = line.taxPercent === '' ? 0 : Number(line.taxPercent);
      return {
        description: line.description.trim(),
        quantity,
        unitPriceCents,
        discountCents,
        taxPercent,
        invalid:
          line.description.trim() === '' ||
          unitPriceCents === null ||
          discountCents === null ||
          !Number.isFinite(quantity) ||
          quantity <= 0 ||
          !Number.isFinite(taxPercent),
      };
    });
    if (payload.some((line) => line.invalid)) {
      setError('Each line needs a treatment name, a quantity, a unit price, a discount, and a tax percent.');
      return;
    }
    const ok = await submit(async () => {
      return apiFetch<{ invoice: InvoiceSummary }>(`/api/organizations/${orgId}/patient-billing/invoices`, {
        method: 'POST',
        body: {
          patientId: selectedPatient.id,
          notes: notes.trim() === '' ? null : notes.trim(),
          lines: payload.map((line) => ({
            description: line.description,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            discountCents: line.discountCents,
            taxPercent: line.taxPercent,
          })),
        },
      });
    });
    if (ok !== null) {
      setFlash(`Draft invoice saved for ${selectedPatient.firstName} ${selectedPatient.lastName}.`);
      setAdding(false);
      setLines([{ ...EMPTY_LINE }]);
      setNotes('');
      setSelectedPatient(null);
      list.reload();
    }
  };

  const invoices = list.data?.invoices ?? [];

  return (
    <div>
      <PageHeader
        title="Patient billing"
        subtitle="Invoices and payments for patients. The Dentalistics subscription stays under Settings, then Billing."
        actions={
          <div className="btn-row">
            <BillingLinks current="invoices" />
            {canManage ? (
              <button type="button" className="btn btn-primary" onClick={() => setAdding((open) => !open)}>
                {adding ? 'Hide form' : 'New invoice'}
              </button>
            ) : null}
          </div>
        }
      />

      {flash ? <Flash kind="success" message={flash} onDismiss={() => setFlash(null)} /> : null}

      <section className="card">
        <h2 className="card-title">Clinic currency</h2>
        {settingsQuery.status === 'loading' && settings === null ? <LoadingState label="Loading settings…" /> : null}
        {settingsQuery.status === 'error' && settings === null ? (
          <ErrorState message={settingsQuery.error ?? 'Billing settings could not be loaded.'} onRetry={settingsQuery.reload} />
        ) : null}
        {settings !== null && canManage ? (
          <>
            {formError && !adding ? <Flash kind="error" message={formError} onDismiss={clearFeedback} /> : null}
            <div className="form-grid">
              <FormField label="Currency">
                <select
                  className="select"
                  value={settings.currency}
                  onChange={(event) =>
                    setSettingsDraft({ ...settings, currency: event.target.value as PatientCurrency })
                  }
                >
                  {PATIENT_CURRENCIES.map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Tax label">
                <select
                  className="select"
                  value={settings.taxLabel}
                  onChange={(event) =>
                    setSettingsDraft({ ...settings, taxLabel: event.target.value as TaxLabel })
                  }
                >
                  {TAX_LABELS.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Invoice prefix" hint="Letters and digits, up to 8. The next invoice uses this prefix.">
                <input
                  className="input"
                  value={settings.invoicePrefix}
                  maxLength={8}
                  onChange={(event) =>
                    setSettingsDraft({ ...settings, invoicePrefix: event.target.value.toUpperCase() })
                  }
                />
              </FormField>
              <FormField label="Next number">
                <input
                  className="input"
                  inputMode="numeric"
                  value={String(settings.nextNumber)}
                  onChange={(event) => {
                    const nextNumber = Number(event.target.value);
                    if (Number.isInteger(nextNumber)) setSettingsDraft({ ...settings, nextNumber });
                  }}
                />
              </FormField>
            </div>
            <div className="btn-row">
              <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void saveSettings()}>
                {saving && !adding ? 'Saving…' : 'Save currency settings'}
              </button>
            </div>
          </>
        ) : null}
        {settings !== null && !canManage ? (
          <p>
            {settings.currency} · {settings.taxLabel}. Invoice numbers use {settings.invoicePrefix}.
          </p>
        ) : null}
      </section>

      {adding && canManage ? (
        <section className="card">
          <h2 className="card-title">New draft invoice</h2>
          {formError ? <Flash kind="error" message={formError} onDismiss={clearFeedback} /> : null}
          <FormField label="Patient" hint="Search by name or phone, then pick a result.">
            <input
              className="input"
              type="search"
              value={pickerQuery}
              onChange={(event) => setPickerQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  setPickerSearch(pickerQuery);
                }
              }}
            />
          </FormField>
          <div className="btn-row">
            <button type="button" className="btn btn-secondary" onClick={() => setPickerSearch(pickerQuery)}>
              Search patients
            </button>
            {selectedPatient ? (
              <span>
                Selected: {selectedPatient.firstName} {selectedPatient.lastName}
              </span>
            ) : null}
          </div>
          {picker.data !== null && picker.data.patients.length > 0 ? (
            <ul className="plain-list">
              {picker.data.patients.map((patient) => (
                <li key={patient.id}>
                  <button type="button" className="btn btn-ghost" onClick={() => setSelectedPatient(patient)}>
                    {patient.firstName} {patient.lastName} · {patient.phone}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {lines.map((line, index) => (
            <div className="form-grid" key={index}>
              <FormField label="Treatment or service">
                <input
                  className="input"
                  value={line.description}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, description: event.target.value } : item,
                      ),
                    )
                  }
                />
              </FormField>
              <FormField label="Qty">
                <input
                  className="input"
                  value={line.quantity}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, quantity: event.target.value } : item,
                      ),
                    )
                  }
                />
              </FormField>
              <FormField label="Unit price">
                <input
                  className="input"
                  value={line.unitPrice}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, unitPrice: event.target.value } : item,
                      ),
                    )
                  }
                />
              </FormField>
              <FormField label="Discount">
                <input
                  className="input"
                  value={line.discount}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, discount: event.target.value } : item,
                      ),
                    )
                  }
                />
              </FormField>
              <FormField label="Tax %">
                <input
                  className="input"
                  value={line.taxPercent}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, taxPercent: event.target.value } : item,
                      ),
                    )
                  }
                />
              </FormField>
            </div>
          ))}
          <FormField label="Notes">
            <input className="input" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </FormField>
          <div className="btn-row">
            <button type="button" className="btn btn-secondary" onClick={() => setLines((current) => [...current, { ...EMPTY_LINE }])}>
              Add line
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving || selectedPatient === null}
              onClick={() => void createInvoice()}
            >
              {saving ? 'Saving…' : 'Save draft'}
            </button>
          </div>
        </section>
      ) : null}

      <section className="card">
        <h2 className="card-title">Invoices</h2>
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const next = new URLSearchParams(searchParams);
            const nextQuery = String(form.get('q') ?? '');
            const nextStatus = String(form.get('status') ?? '');
            if (nextQuery === '') next.delete('q');
            else next.set('q', nextQuery);
            if (nextStatus === '') next.delete('status');
            else next.set('status', nextStatus);
            setSearchParams(next);
            setOffset(0);
          }}
        >
          <FormField label="Search">
            <input className="input" name="q" defaultValue={query} placeholder="Patient or invoice number" />
          </FormField>
          <FormField label="Status">
            <select className="select" name="status" defaultValue={status}>
              <option value="">Any</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </FormField>
          <div className="btn-row">
            <button type="submit" className="btn btn-secondary">
              Apply
            </button>
          </div>
        </form>

        {list.data?.balance ? (
          <p>
            Balance for this patient:{' '}
            <strong>{formatMoney(list.data.balance.balanceCents, list.data.balance.currency)}</strong>
          </p>
        ) : null}

        {list.status === 'loading' && list.data === null ? <LoadingState label="Loading invoices…" /> : null}
        {list.status === 'error' && list.data === null ? (
          <ErrorState message={list.error ?? 'Invoices could not be loaded.'} onRetry={list.reload} />
        ) : null}
        {list.data !== null && invoices.length === 0 ? (
          <EmptyState
            title="No invoices found"
            description={
              filtered
                ? 'No invoices match this search.'
                : 'Draft an invoice when a patient is ready to be billed. Issued invoices get the next number for this clinic.'
            }
            preview={
              filtered ? undefined : (
                <p>
                  <span className="badge badge-success">Sample</span> Example only — INV-0142 for Layla
                  Rahman, scale and polish, AED 150.00, VAT 5%, status Issued. Not saved data.
                </p>
              )
            }
          />
        ) : null}
        {invoices.length > 0 ? (
          <div className="table-scroll table-cards" tabIndex={0} role="region" aria-label="Invoices">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Invoice</th>
                  <th scope="col">Patient</th>
                  <th scope="col">Status</th>
                  <th scope="col">Total</th>
                  <th scope="col">Balance</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      <Link to={`/patient-billing/invoices/${invoice.id}`}>{invoice.number ?? 'Draft'}</Link>
                    </td>
                    <td>{invoice.patientName}</td>
                    <td>
                      <StatusBadge label={STATUS_LABELS[invoice.status]} tone={statusTone(invoice.status)} />
                    </td>
                    <td>{formatMoney(invoice.totalCents, invoice.currency)}</td>
                    <td>{formatMoney(invoice.balanceCents, invoice.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {list.data !== null ? (
          <Pager total={list.data.total} limit={list.data.limit} offset={list.data.offset} onOffset={setOffset} />
        ) : null}
      </section>
    </div>
  );
}
