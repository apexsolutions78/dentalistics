import { useState } from 'react';
import { useSettings } from '../../lib/settings';
import { useSubmit } from '../../lib/useAsync';
import type { Settings } from '../../lib/types';
import { PageHeader } from '../../components/PageHeader';
import { FormField } from '../../components/FormField';
import { Flash } from '../../components/Flash';
import { StatusBadge } from '../../components/states';
import { SettingsBody } from './SettingsBody';
import { AutomationFields, NumberField, TemplateLinkRow } from './AutomationFields';

interface ReviewForm {
  enabled: boolean;
  channel: string;
  provider: string;
  delayHours: number;
  suppressionPeriodDays: number;
  reviewUrl: string;
}

function toForm(settings: Settings): ReviewForm {
  const cfg = settings.automations.review.config;
  return {
    enabled: cfg.enabled,
    channel: cfg.channel,
    provider: cfg.provider,
    delayHours: cfg.delayHours,
    suppressionPeriodDays: cfg.suppressionPeriodDays,
    reviewUrl: settings.clinic.reviewUrl ?? '',
  };
}

export function ReviewSettingsPage() {
  const { state, reload, patchAutomation, patchClinic } = useSettings();
  const { submit, saving, error, saved, clearFeedback } = useSubmit();
  const {
    submit: submitDestination,
    saving: savingDestination,
    error: destinationError,
    saved: destinationSaved,
    clearFeedback: clearDestination,
  } = useSubmit();
  const [draft, setDraft] = useState<ReviewForm | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const settings = state.settings;
  const form = draft ?? (settings !== null ? toForm(settings) : null);

  const update = <K extends keyof ReviewForm>(key: K, value: ReviewForm[K]): void => {
    setDraft((prev) => {
      const base = prev ?? (settings !== null ? toForm(settings) : null);
      return base === null ? base : { ...base, [key]: value };
    });
    clearFeedback();
    clearDestination();
    setClientError(null);
  };

  const saveAutomation = async (): Promise<void> => {
    if (form === null) return;
    if (form.provider.trim().length === 0) {
      setClientError('Provider cannot be empty.');
      return;
    }
    if (!Number.isInteger(form.delayHours) || form.delayHours < 0 || form.delayHours > 720) {
      setClientError('Delay must be a whole number of hours between 0 and 720.');
      return;
    }
    if (
      !Number.isInteger(form.suppressionPeriodDays) ||
      form.suppressionPeriodDays < 1 ||
      form.suppressionPeriodDays > 3650
    ) {
      setClientError('Suppression period must be a whole number of days between 1 and 3650.');
      return;
    }
    await submit(() =>
      patchAutomation('review', {
        enabled: form.enabled,
        channel: form.channel,
        provider: form.provider.trim(),
        delayHours: form.delayHours,
        suppressionPeriodDays: form.suppressionPeriodDays,
      }),
    );
  };

  const saveDestination = async (): Promise<void> => {
    if (form === null) return;
    const url = form.reviewUrl.trim();
    if (url.length > 0) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          setClientError('Review URL must start with http:// or https://');
          return;
        }
      } catch {
        setClientError('Review URL is not a valid URL.');
        return;
      }
    }
    await submitDestination(() => patchClinic({ reviewUrl: url }));
  };

  return (
    <div>
      <PageHeader
        title="Reviews"
        subtitle="Ask happy patients for a review at the right moment"
      />
      <SettingsBody state={state} onRetry={reload}>
        {(settings: Settings) => {
          if (form === null) return null;
          const cfg = settings.automations.review;
          return (
            <div>
              {(error ?? clientError) !== null ? (
                <Flash
                  kind="error"
                  message={error ?? clientError ?? ''}
                  onDismiss={() => {
                    clearFeedback();
                    setClientError(null);
                  }}
                />
              ) : null}

              <div className="card">
                <div className="card-title">Review destination</div>
                {destinationSaved ? (
                  <Flash kind="success" message="Review destination saved." onDismiss={clearDestination} />
                ) : null}
                {destinationError ? <Flash kind="error" message={destinationError} onDismiss={clearDestination} /> : null}
                <FormField
                  label="Review URL"
                  hint="Where patients are sent to leave a review. Leave blank for none."
                >
                  <input
                    className="input"
                    type="url"
                    value={form.reviewUrl}
                    onChange={(e) => update('reviewUrl', e.target.value)}
                  />
                </FormField>
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void saveDestination()}
                    disabled={savingDestination}
                  >
                    {savingDestination ? 'Saving…' : 'Save destination'}
                  </button>
                </div>
              </div>

              <div className="card">
                <div className="provider-status">
                  <StatusBadge label={`Source: ${cfg.source}`} tone={cfg.source === 'org' ? 'new' : 'default'} />
                  <StatusBadge label={cfg.config.enabled ? 'Enabled' : 'Disabled'} tone={cfg.config.enabled ? 'success' : 'default'} />
                </div>
                {saved ? <Flash kind="success" message="Review settings saved." onDismiss={clearFeedback} /> : null}

                <AutomationFields
                  enabled={form.enabled}
                  channel={form.channel}
                  provider={form.provider}
                  onEnabled={(v) => update('enabled', v)}
                  onChannel={(v) => update('channel', v)}
                  onProvider={(v) => update('provider', v)}
                />

                <div className="form-grid">
                  <NumberField
                    label="Send delay after visit (hours)"
                    hint="0–720."
                    value={form.delayHours}
                    min={0}
                    max={720}
                    onChange={(v) => update('delayHours', v)}
                  />
                  <NumberField
                    label="Suppression window (days)"
                    hint="1–3650. No second request within this window."
                    value={form.suppressionPeriodDays}
                    min={1}
                    max={3650}
                    onChange={(v) => update('suppressionPeriodDays', v)}
                  />
                </div>

                <div className="btn-row">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void saveAutomation()}
                    disabled={saving}
                  >
                    {saving ? 'Saving…' : 'Save review settings'}
                  </button>
                </div>

                <div className="card-title" style={{ marginTop: 'var(--space-5)' }}>
                  Review template
                </div>
                <TemplateLinkRow
                  to="/settings/templates/review_request"
                  slot="Review request"
                  content={settings.templates['review_request'] ?? ''}
                />
                <div className="meta-line">
                  Attempt cap: {cfg.config.maxAttempts} attempts (deployment-wide, not editable here).
                </div>
              </div>
            </div>
          );
        }}
      </SettingsBody>
    </div>
  );
}
