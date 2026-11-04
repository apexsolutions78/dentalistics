import { useState } from 'react';
import { useAuth } from '../../lib/auth';
import { apiFetch } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useSubmit } from '../../lib/useAsync';
import { formatDate } from '../../lib/format';
import { formatMoney, majorToCents, type ClinicExpense } from '../../lib/patientBilling';
import type { Paged } from '../../lib/types';
import { PageHeader } from '../../components/PageHeader';
import { Pager } from '../../components/Pager';
import { FormField } from '../../components/FormField';
import { Flash } from '../../components/Flash';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { BillingLinks } from './BillingLinks';

const PAGE_SIZE = 20;

export function ExpensesPage() {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? null;
  const [offset, setOffset] = useState(0);
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [flash, setFlash] = useState<string | null>(null);
  const { submit, saving, error, clearFeedback, setError } = useSubmit();
  const path =
    orgId === null ? null : `/api/organizations/${orgId}/patient-billing/expenses?limit=${PAGE_SIZE}&offset=${offset}`;
  const list = useApi<Paged & { expenses: ClinicExpense[] }>(path);

  const create = async (): Promise<void> => {
    if (orgId === null) return;
    const amountCents = majorToCents(amount);
    if (category.trim() === '' || amountCents === null || amountCents <= 0) {
      setError('Enter a category, a date, and an amount greater than zero.');
      return;
    }
    const ok = await submit(async () => {
      await apiFetch(`/api/organizations/${orgId}/patient-billing/expenses`, {
        method: 'POST',
        body: {
          category: category.trim(),
          amountCents,
          expenseDate,
          note: note.trim() === '' ? null : note.trim(),
        },
      });
      return true;
    });
    if (ok !== null) {
      setFlash('Expense saved.');
      setCategory('');
      setAmount('');
      setNote('');
      list.reload();
    }
  };

  const remove = async (expenseId: number): Promise<void> => {
    if (orgId === null) return;
    const ok = await submit(async () => {
      await apiFetch(`/api/organizations/${orgId}/patient-billing/expenses/${expenseId}`, { method: 'DELETE' });
      return true;
    });
    if (ok !== null) {
      setFlash('Expense removed.');
      list.reload();
    }
  };

  const expenses = list.data?.expenses ?? [];

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle="Clinic costs such as supplies and rent. Profit on the reports page is revenue minus these amounts."
        actions={<BillingLinks current="expenses" />}
      />
      {flash ? <Flash kind="success" message={flash} onDismiss={() => setFlash(null)} /> : null}
      {error ? <Flash kind="error" message={error} onDismiss={clearFeedback} /> : null}

      <section className="card">
        <h2 className="card-title">Add an expense</h2>
        <div className="form-grid">
          <FormField label="Category">
            <input className="input" value={category} onChange={(event) => setCategory(event.target.value)} />
          </FormField>
          <FormField label="Amount">
            <input className="input" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </FormField>
          <FormField label="Date">
            <input className="input" type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} />
          </FormField>
          <FormField label="Note">
            <input className="input" value={note} onChange={(event) => setNote(event.target.value)} />
          </FormField>
        </div>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void create()}>
          {saving ? 'Saving…' : 'Save expense'}
        </button>
      </section>

      <section className="card">
        <h2 className="card-title">Recorded expenses</h2>
        {list.status === 'loading' && list.data === null ? <LoadingState label="Loading expenses…" /> : null}
        {list.status === 'error' && list.data === null ? (
          <ErrorState message={list.error ?? 'Expenses could not be loaded.'} onRetry={list.reload} />
        ) : null}
        {list.data !== null && expenses.length === 0 ? (
          <EmptyState
            title="No expenses yet"
            description="Costs you record here are subtracted from billed revenue on the reports page."
            preview={
              <p>
                <span className="badge badge-success">Sample</span> Example only — Supplies, AED 85.00, 4 Nov
                2026, gloves and masks. Not saved data.
              </p>
            }
          />
        ) : null}
        {expenses.length > 0 ? (
          <div className="table-scroll table-cards" tabIndex={0} role="region" aria-label="Expenses">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Category</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Note</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((expense) => (
                  <tr key={expense.id}>
                    <td>{formatDate(expense.expenseDate)}</td>
                    <td>{expense.category}</td>
                    <td>{formatMoney(expense.amountCents, expense.currency)}</td>
                    <td>{expense.note ?? '—'}</td>
                    <td>
                      <button type="button" className="btn btn-ghost" onClick={() => void remove(expense.id)}>
                        Remove
                      </button>
                    </td>
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
