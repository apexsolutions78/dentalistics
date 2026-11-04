import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { can } from '../../lib/capabilities';
import { apiFetch } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useSubmit } from '../../lib/useAsync';
import { formatDate } from '../../lib/format';
import {
  METHOD_LABELS,
  STATUS_LABELS,
  formatMoney,
  majorToCents,
  paymentMethodsFor,
  type InvoiceDetail,
  type InvoiceStatus,
  type PaymentMethod,
} from '../../lib/patientBilling';
import { PageHeader } from '../../components/PageHeader';
import { FormField } from '../../components/FormField';
import { Flash } from '../../components/Flash';
import { EmptyState, ErrorState, LoadingState, StatusBadge, type BadgeTone } from '../../components/states';

function statusTone(status: InvoiceStatus): BadgeTone {
  if (status === 'paid') return 'success';
  if (status === 'partially_paid') return 'warn';
  if (status === 'void') return 'danger';
  if (status === 'issued') return 'new';
  return 'default';
}

export function InvoicePage() {
  const { invoiceId } = useParams();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? null;
  const canManage = can(user, 'patientBilling.manage');
  const path =
    orgId === null || invoiceId === undefined
      ? null
      : `/api/organizations/${orgId}/patient-billing/invoices/${invoiceId}`;
  const invoiceQuery = useApi<{ invoice: InvoiceDetail }>(path);
  const invoice = invoiceQuery.data?.invoice ?? null;
  const { submit, saving, error, clearFeedback } = useSubmit();
  const [flash, setFlash] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<'payment' | 'refund'>('payment');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [voidReason, setVoidReason] = useState('');

  const recordPayment = async (): Promise<void> => {
    if (orgId === null || invoice === null) return;
    const cents = majorToCents(amount);
    if (cents === null || cents === 0) {
      return;
    }
    const ok = await submit(async () => {
      await apiFetch(`${path}/payments`, {
        method: 'POST',
        body: {
          amountCents: kind === 'refund' ? -cents : cents,
          method,
          paidOn,
          note: note.trim() === '' ? null : note.trim(),
        },
      });
      return true;
    });
    if (ok !== null) {
      setFlash(kind === 'refund' ? 'Refund recorded.' : 'Payment recorded.');
      setAmount('');
      setNote('');
      invoiceQuery.reload();
    }
  };

  const issue = async (): Promise<void> => {
    if (path === null) return;
    const ok = await submit(async () => {
      await apiFetch(`${path}/issue`, { method: 'POST', body: {} });
      return true;
    });
    if (ok !== null) {
      setFlash('Invoice issued.');
      invoiceQuery.reload();
    }
  };

  const voidInvoice = async (): Promise<void> => {
    if (path === null) return;
    const ok = await submit(async () => {
      await apiFetch(`${path}/void`, {
        method: 'POST',
        body: { reason: voidReason.trim() === '' ? null : voidReason.trim() },
      });
      return true;
    });
    if (ok !== null) {
      setFlash('Invoice voided.');
      invoiceQuery.reload();
    }
  };

  if (invoiceQuery.status === 'loading' && invoice === null) {
    return (
      <div>
        <PageHeader title="Invoice" />
        <LoadingState label="Loading invoice…" />
      </div>
    );
  }
  if (invoiceQuery.status === 'error' && invoice === null) {
    return (
      <div>
        <PageHeader title="Invoice" />
        <ErrorState message={invoiceQuery.error ?? 'This invoice could not be loaded.'} onRetry={invoiceQuery.reload} />
      </div>
    );
  }
  if (invoice === null) return null;

  const methods = paymentMethodsFor(invoice.currency);
  const open = invoice.status !== 'draft' && invoice.status !== 'void';
  const logoIsLocal = invoice.letterhead.logoUrl !== null && invoice.letterhead.logoUrl.startsWith('/');

  return (
    <div>
      <PageHeader
        title={invoice.number ?? 'Draft invoice'}
        subtitle={`${invoice.patient.firstName} ${invoice.patient.lastName}`}
        actions={
          <div className="btn-row no-print">
            <Link className="btn btn-secondary" to="/patient-billing">
              All invoices
            </Link>
            <button type="button" className="btn btn-primary" onClick={() => window.print()}>
              Print or save as PDF
            </button>
          </div>
        }
      />
      {flash ? <Flash kind="success" message={flash} onDismiss={() => setFlash(null)} /> : null}
      {error ? <Flash kind="error" message={error} onDismiss={clearFeedback} /> : null}

      <article className="invoice-sheet" aria-label="Printable invoice">
        <header className="invoice-letterhead">
          <div>
            {logoIsLocal && invoice.letterhead.logoUrl !== null ? (
              <img className="invoice-logo" src={invoice.letterhead.logoUrl} alt="" />
            ) : null}
            <h2>{invoice.letterhead.name}</h2>
            {invoice.letterhead.address ? <p>{invoice.letterhead.address}</p> : null}
            <p>
              {[invoice.letterhead.phone, invoice.letterhead.email].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
          <div className="invoice-meta">
            <p>
              <strong>{invoice.number ?? 'Draft'}</strong>
            </p>
            <p>
              <StatusBadge label={STATUS_LABELS[invoice.status]} tone={statusTone(invoice.status)} />
            </p>
            <p>{invoice.currency}</p>
            <p>{invoice.issuedAt ? formatDate(invoice.issuedAt) : 'Not issued'}</p>
          </div>
        </header>
        <p>
          <strong>Bill to</strong>
          <br />
          {invoice.patient.firstName} {invoice.patient.lastName}
          <br />
          {invoice.patient.phone}
          {invoice.patient.email ? ` · ${invoice.patient.email}` : ''}
        </p>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Treatment or service</th>
                <th scope="col">Qty</th>
                <th scope="col">Unit price</th>
                <th scope="col">Discount</th>
                <th scope="col">{invoice.taxLabel}</th>
                <th scope="col">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => (
                <tr key={line.id}>
                  <td>{line.description}</td>
                  <td>{line.quantity}</td>
                  <td>{formatMoney(line.unitPriceCents, invoice.currency)}</td>
                  <td>{formatMoney(line.discountCents, invoice.currency)}</td>
                  <td>{line.taxPercent}%</td>
                  <td>{formatMoney(line.totalCents, invoice.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="invoice-totals">
          <div>
            <span>Subtotal</span>
            <span>{formatMoney(invoice.subtotalCents, invoice.currency)}</span>
          </div>
          <div>
            <span>Discount</span>
            <span>{formatMoney(invoice.discountCents, invoice.currency)}</span>
          </div>
          <div>
            <span>{invoice.taxLabel}</span>
            <span>{formatMoney(invoice.taxCents, invoice.currency)}</span>
          </div>
          <div>
            <strong>Total</strong>
            <strong>{formatMoney(invoice.totalCents, invoice.currency)}</strong>
          </div>
          <div>
            <span>Paid</span>
            <span>{formatMoney(invoice.paidCents, invoice.currency)}</span>
          </div>
          <div>
            <span>Balance</span>
            <span>{formatMoney(invoice.balanceCents, invoice.currency)}</span>
          </div>
        </div>
        {invoice.notes ? <p>{invoice.notes}</p> : null}
        {invoice.voidReason ? <p>Void reason: {invoice.voidReason}</p> : null}
      </article>

      {canManage && invoice.status === 'draft' ? (
        <section className="card no-print">
          <h2 className="card-title">Issue this draft</h2>
          <p>Issuing assigns the next invoice number for this clinic. The lines stay as they are.</p>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void issue()}>
            Issue invoice
          </button>
        </section>
      ) : null}

      <section className="card no-print">
        <h2 className="card-title">Payments</h2>
        {invoice.payments.length === 0 ? (
          <EmptyState
            title="No payments yet"
            description="Cash, card terminal, and bank transfer can be recorded against an issued invoice. A refund is stored as a negative payment."
            preview={
              <p>
                <span className="badge badge-success">Sample</span> Example only — card terminal, AED 150.00,
                4 Nov 2026. Not saved data.
              </p>
            }
          />
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Payments">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Method</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Note</th>
                </tr>
              </thead>
              <tbody>
                {invoice.payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{formatDate(payment.paidOn)}</td>
                    <td>{METHOD_LABELS[payment.method]}</td>
                    <td>{formatMoney(payment.amountCents, invoice.currency)}</td>
                    <td>{payment.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canManage && open ? (
          <div className="form-grid">
            <FormField label="Kind">
              <select
                className="select"
                value={kind}
                onChange={(event) => setKind(event.target.value === 'refund' ? 'refund' : 'payment')}
              >
                <option value="payment">Payment</option>
                <option value="refund">Refund</option>
              </select>
            </FormField>
            <FormField label="Amount">
              <input className="input" value={amount} onChange={(event) => setAmount(event.target.value)} />
            </FormField>
            <FormField label="Method">
              <select
                className="select"
                value={method}
                onChange={(event) => setMethod(event.target.value as PaymentMethod)}
              >
                {methods.map((item) => (
                  <option key={item} value={item}>
                    {METHOD_LABELS[item]}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Date">
              <input className="input" type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} />
            </FormField>
            <FormField label="Note">
              <input className="input" value={note} onChange={(event) => setNote(event.target.value)} />
            </FormField>
            <div className="btn-row">
              <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void recordPayment()}>
                {kind === 'refund' ? 'Record refund' : 'Record payment'}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {canManage && invoice.status !== 'void' ? (
        <section className="card no-print">
          <h2 className="card-title">Void invoice</h2>
          <p>Refund any payments first. Void keeps the invoice on file and stops further collection.</p>
          <FormField label="Reason">
            <input className="input" value={voidReason} onChange={(event) => setVoidReason(event.target.value)} />
          </FormField>
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void voidInvoice()}>
            Void invoice
          </button>
        </section>
      ) : null}
    </div>
  );
}
