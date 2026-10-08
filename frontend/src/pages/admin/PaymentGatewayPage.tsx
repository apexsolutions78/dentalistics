import { useState } from 'react';
import { apiFetch } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useSubmit } from '../../lib/useAsync';
import { useUnsavedChanges } from '../../lib/useUnsavedChanges';
import type { PaymentGatewayConfig } from '../../lib/types';
import { PageHeader } from '../../components/PageHeader';
import { FormField } from '../../components/FormField';
import { Flash } from '../../components/Flash';
import { ErrorState, LoadingState, StatusBadge } from '../../components/states';

interface GatewayResponse {
  gateway: PaymentGatewayConfig;
}

interface TestResponse {
  result: { ok: boolean; detail: string };
}

function toDraft(config: PaymentGatewayConfig): PaymentGatewayConfig {
  return {
    enabled: config.enabled,
    provider: config.provider,
    merchantId: config.merchantId,
    storeName: config.storeName,
    baseUrl: config.baseUrl,
    returnUrlBase: config.returnUrlBase,
    state: config.state,
    reasons: config.reasons,
  };
}

export function PaymentGatewayPage() {
  const { status, data, error, reload } = useApi<GatewayResponse>('/api/admin/payment-gateway');
  const { submit, saving, error: actionError, saved, clearFeedback } = useSubmit();
  const [draft, setDraft] = useState<PaymentGatewayConfig | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);

  const config = data?.gateway ?? null;
  const value = draft ?? config;
  const dirty =
    draft !== null && config !== null && JSON.stringify(toDraft(draft)) !== JSON.stringify(toDraft(config));
  useUnsavedChanges(dirty);

  function update(patch: Partial<PaymentGatewayConfig>): void {
    if (value === null) return;
    setDraft({ ...value, ...patch });
    clearFeedback();
    setTestResult(null);
  }

  async function save(): Promise<void> {
    if (value === null) return;
    const res = await submit(() =>
      apiFetch<GatewayResponse>('/api/admin/payment-gateway', {
        method: 'PATCH',
        body: {
          enabled: value.enabled,
          provider: value.provider,
          merchantId: value.merchantId,
          storeName: value.storeName,
          baseUrl: value.baseUrl,
          returnUrlBase: value.returnUrlBase,
        },
      }),
    );
    if (res !== null) {
      setDraft(null);
      reload();
    }
  }

  async function testConnection(): Promise<void> {
    const res = await submit(() =>
      apiFetch<TestResponse>('/api/admin/payment-gateway/test', { method: 'POST' }),
    );
    if (res !== null) {
      setTestResult(res.result);
    }
  }

  const light = config?.state === 'green' ? 'success' : 'danger';

  return (
    <div>
      <PageHeader
        title="Payment gateway"
        subtitle="AssanPay checkout settings for clinic upgrades to the Full Plan"
        actions={
          <button type="button" className="btn btn-secondary" onClick={reload}>
            Refresh
          </button>
        }
      />
      {saved ? <Flash kind="success" message="Gateway settings saved." onDismiss={clearFeedback} /> : null}
      {actionError !== null ? <Flash kind="error" message={actionError} onDismiss={clearFeedback} /> : null}
      {testResult !== null ? (
        <Flash
          kind={testResult.ok ? 'success' : 'error'}
          message={`Connection test: ${testResult.detail}`}
          onDismiss={() => setTestResult(null)}
        />
      ) : null}
      {status === 'loading' ? <LoadingState label="Loading gateway settings…" /> : null}
      {status === 'error' ? <ErrorState message={error ?? 'Something went wrong.'} onRetry={reload} /> : null}
      {value !== null ? (
        <section className="card">
          <h2 className="card-title">Status</h2>
          <div className="provider-status">
            <StatusBadge
              label={config?.state === 'green' ? 'READY' : 'NOT READY'}
              tone={light}
            />
            <StatusBadge label={value.enabled ? 'Enabled' : 'Disabled'} tone={value.enabled ? 'success' : 'default'} />
            <StatusBadge
              label={value.provider === 'mock' ? 'Mock provider (no real charges)' : 'AssanPay provider'}
              tone={value.provider === 'mock' ? 'warn' : 'default'}
            />
          </div>
          {config !== null && config.reasons.length > 0 ? (
            <ul className="text-muted" style={{ marginTop: 'var(--space-2)' }}>
              {config.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}

          <FormField label="Gateway enabled" hint="Clinics can only check out when this is on.">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={value.enabled}
                onChange={(e) => update({ enabled: e.target.checked })}
              />
              Accept online payments
            </label>
          </FormField>

          <FormField label="Provider" hint="AssanPay is the production gateway; mock is for testing.">
            <select
              className="input"
              value={value.provider}
              onChange={(e) => update({ provider: e.target.value as 'mock' | 'assanpay' })}
            >
              <option value="assanpay">AssanPay</option>
              <option value="mock">Mock (testing only)</option>
            </select>
          </FormField>

          <FormField label="Merchant ID" hint="From the AssanPay merchant portal dashboard.">
            <input
              className="input"
              type="text"
              autoComplete="off"
              value={value.merchantId}
              onChange={(e) => update({ merchantId: e.target.value })}
            />
          </FormField>

          <FormField label="Store name" hint="Shown to the payer on the AssanPay payment page.">
            <input
              className="input"
              type="text"
              autoComplete="off"
              value={value.storeName}
              onChange={(e) => update({ storeName: e.target.value })}
            />
          </FormField>

          <FormField label="API base URL" hint="AssanPay API root, e.g. https://api.assanpay.com — supplied with your merchant credentials.">
            <input
              className="input"
              type="url"
              autoComplete="off"
              value={value.baseUrl}
              onChange={(e) => update({ baseUrl: e.target.value })}
            />
          </FormField>

          <FormField
            label="Return URL base"
            hint="Public https origin of this app; payers return to /settings/billing here."
          >
            <input
              className="input"
              type="url"
              autoComplete="off"
              value={value.returnUrlBase}
              onChange={(e) => update({ returnUrlBase: e.target.value })}
            />
          </FormField>

          <div className="btn-row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving || !dirty}
              onClick={() => {
                void save();
              }}
            >
              {saving ? 'Saving…' : 'Save settings'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => {
                void testConnection();
              }}
            >
              Test connection
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
