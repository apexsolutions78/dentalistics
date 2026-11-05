import { useState } from 'react';
import { apiFetch } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useSubmit } from '../../lib/useAsync';
import { majorTextToMinor, minorToMajorInput } from '../../lib/money';
import type { RegionalPrice } from '../../lib/types';
import { PageHeader } from '../../components/PageHeader';
import { FormField } from '../../components/FormField';
import { Flash } from '../../components/Flash';
import { ErrorState, LoadingState, StatusBadge } from '../../components/states';

interface PriceResponse {
  regions: RegionalPrice[];
}

export function RegionalPricingPage() {
  const { status, data, error, reload } = useApi<PriceResponse>('/api/admin/regional-prices');
  const { submit, saving, error: actionError, saved, clearFeedback } = useSubmit();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [currencies, setCurrencies] = useState<Record<string, string>>({});
  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newCurrency, setNewCurrency] = useState('USD');
  const [newAmount, setNewAmount] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const regions = data?.regions ?? [];

  function amountDraft(region: RegionalPrice): string {
    return drafts[region.code] ?? minorToMajorInput(region.amountMinor);
  }

  async function save(region: RegionalPrice): Promise<void> {
    const amountMinor = majorTextToMinor(amountDraft(region));
    const currency = region.code === 'us' ? 'USD' : (currencies[region.code] ?? region.currency).toUpperCase();
    if (amountMinor === null) {
      setFormError(
        region.code === 'us'
          ? 'Enter a USD amount. The United States price is required.'
          : 'Enter an amount with at most 2 decimal places.',
      );
      return;
    }
    setFormError(null);
    const res = await submit(() =>
      apiFetch<{ region: RegionalPrice }>(`/api/admin/regional-prices/${region.code}`, {
        method: 'PATCH',
        body: { amountMinor, currency, label: region.label },
      }),
    );
    if (res !== null) {
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[region.code];
        return next;
      });
      reload();
    }
  }

  async function addRegion(): Promise<void> {
    const amountMinor = majorTextToMinor(newAmount);
    if (amountMinor === null) return;
    const res = await submit(() =>
      apiFetch('/api/admin/regional-prices', {
        method: 'POST',
        body: {
          code: newCode.trim().toLowerCase(),
          label: newLabel.trim(),
          currency: newCurrency.trim().toUpperCase(),
          amountMinor,
        },
      }),
    );
    if (res !== null) {
      setNewCode('');
      setNewLabel('');
      setNewAmount('');
      reload();
    }
  }

  async function remove(code: string): Promise<void> {
    const res = await submit(() =>
      apiFetch(`/api/admin/regional-prices/${code}`, { method: 'DELETE' }),
    );
    if (res !== null) reload();
  }

  return (
    <div>
      <PageHeader
        title="Regional prices"
        subtitle="Amounts the public pricing page and the bank-transfer form show. Placeholder rows are stand-ins for you to replace."
      />
      {saved ? <Flash kind="success" message="Price saved." onDismiss={clearFeedback} /> : null}
      {formError !== null ? <Flash kind="error" message={formError} onDismiss={() => setFormError(null)} /> : null}
      {actionError !== null ? <Flash kind="error" message={actionError} onDismiss={clearFeedback} /> : null}
      {status === 'loading' ? <LoadingState label="Loading prices…" /> : null}
      {status === 'error' ? <ErrorState message={error ?? 'Prices could not be loaded.'} onRetry={reload} /> : null}
      {regions.length > 0 ? (
        <section className="card">
          <div className="table-scroll table-cards">
            <table className="table">
              <thead>
                <tr>
                  <th>Region</th>
                  <th>Currency</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {regions.map((region) => (
                  <tr key={region.code}>
                    <td>
                      {region.label}
                      <div className="text-muted">{region.code}</div>
                    </td>
                    <td>
                      <input
                        className="input"
                        aria-label={`${region.label} currency`}
                        value={region.code === 'us' ? 'USD' : (currencies[region.code] ?? region.currency)}
                        disabled={region.code === 'us'}
                        onChange={(event) =>
                          setCurrencies((prev) => ({ ...prev, [region.code]: event.target.value.toUpperCase() }))
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        aria-label={`${region.label} amount`}
                        value={amountDraft(region)}
                        onChange={(event) =>
                          setDrafts((prev) => ({ ...prev, [region.code]: event.target.value }))
                        }
                      />
                    </td>
                    <td>
                      {region.placeholder ? (
                        <StatusBadge label="Placeholder — set this" tone="warn" />
                      ) : (
                        <StatusBadge label="Set" tone="success" />
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={saving || majorTextToMinor(amountDraft(region)) === null}
                        onClick={() => {
                          void save(region);
                        }}
                      >
                        Save
                      </button>
                      {region.code !== 'us' ? (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={saving}
                          onClick={() => {
                            void remove(region.code);
                          }}
                        >
                          Remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-muted">
            Enter the amount in major units, such as 35 or 35.50. The United States row is required
            and must stay in USD. It is the default price on the public page, signup, billing, and
            card checkout. Other saved rows are used when a visitor’s region matches.
          </p>
        </section>
      ) : null}

      <section className="card" style={{ marginTop: 'var(--space-4)' }}>
        <h2 className="card-title">Add a region</h2>
        <FormField label="Code" htmlFor="region-code" hint="2-8 lowercase letters, for example qa.">
          <input id="region-code" className="input" value={newCode} onChange={(e) => setNewCode(e.target.value)} />
        </FormField>
        <FormField label="Label" htmlFor="region-label">
          <input id="region-label" className="input" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
        </FormField>
        <FormField label="Currency" htmlFor="region-currency">
          <input
            id="region-currency"
            className="input"
            value={newCurrency}
            onChange={(e) => setNewCurrency(e.target.value.toUpperCase())}
          />
        </FormField>
        <FormField label="Amount" htmlFor="region-amount" hint="Major units, up to 2 decimal places.">
          <input id="region-amount" className="input" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} />
        </FormField>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving}
          onClick={() => {
            void addRegion();
          }}
        >
          Add region
        </button>
      </section>
    </div>
  );
}
