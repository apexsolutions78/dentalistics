import { useState } from 'react';
import { useSettings, sourceLabel } from '../../lib/settings';
import { useSubmit } from '../../lib/useAsync';
import type { Settings } from '../../lib/types';
import { PageHeader } from '../../components/PageHeader';
import { Flash } from '../../components/Flash';
import { StatusBadge } from '../../components/states';
import { SettingsBody } from './SettingsBody';
import { AutomationFields, NumberField, TemplateLinkRow } from './AutomationFields';

interface RecallForm {
  enabled: boolean;
  channel: string;
  provider: string;
  intervalDays: number;
  followUpDelayHours: number;
}

function toForm(settings: Settings): RecallForm {
  const cfg = settings.automations.recall.config;
  return {
    enabled: cfg.enabled,
    channel: cfg.channel,
    provider: cfg.provider,
    intervalDays: cfg.intervalDays,
    followUpDelayHours: cfg.followUpDelayHours,
  };
}

export function RecallSettingsPage() {
  const { state, reload, patchAutomation } = useSettings();
  const { submit, saving, error, saved, clearFeedback } = useSubmit();
  const [draft, setDraft] = useState<RecallForm | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const settings = state.settings;
  const form = draft ?? (settings !== null ? toForm(settings) : null);

  const update = <K extends keyof RecallForm>(key: K, value: RecallForm[K]): void => {
    setDraft((prev) => {
      const base = prev ?? (settings !== null ? toForm(settings) : null);
      return base === null ? base : { ...base, [key]: value };
    });
    clearFeedback();
    setClientError(null);
  };

  const onSave = async (): Promise<void> => {
    if (form === null) return;
    if (form.provider.trim().length === 0) {
      setClientError('Provider cannot be empty.');
      return;
    }
    if (!Number.isInteger(form.intervalDays) || form.intervalDays < 1 || form.intervalDays > 3650) {
      setClientError('Interval must be a whole number of days between 1 and 3650.');
      return;
    }
    if (
      !Number.isInteger(form.followUpDelayHours) ||
      form.followUpDelayHours < 1 ||
      form.followUpDelayHours > 168
    ) {
      setClientError('Follow-up delay must be a whole number of hours between 1 and 168.');
      return;
    }
    await submit(() =>
      patchAutomation('recall', {
        enabled: form.enabled,
        channel: form.channel,
        provider: form.provider.trim(),
        intervalDays: form.intervalDays,
        followUpDelayHours: form.followUpDelayHours,
      }),
    );
  };

  return (
    <div>
      <PageHeader
        title="Recall"
        subtitle="Bring inactive patients back on a schedule you control"
      />
      <SettingsBody state={state} onRetry={reload}>
        {(settings: Settings) => {
          if (form === null) return null;
          const cfg = settings.automations.recall;
          return (
            <div className="card">
              <div className="provider-status">
                <StatusBadge label={`Source: ${sourceLabel(cfg.source)}`} tone={cfg.source === 'org' ? 'new' : 'default'} />
                <StatusBadge label={cfg.config.enabled ? 'Enabled' : 'Disabled'} tone={cfg.config.enabled ? 'success' : 'default'} />
              </div>
              {saved ? <Flash kind="success" message="Recall settings saved." onDismiss={clearFeedback} /> : null}
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
                  label="Recall interval (days)"
                  hint="1–3650. A patient is due for recall this many days after their last visit."
                  value={form.intervalDays}
                  min={1}
                  max={3650}
                  onChange={(v) => update('intervalDays', v)}
                />
                <NumberField
                  label="Follow-up delay (hours)"
                  hint="1–168. Delay before the second recall message."
                  value={form.followUpDelayHours}
                  min={1}
                  max={168}
                  onChange={(v) => update('followUpDelayHours', v)}
                />
              </div>

              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void onSave()}
                  disabled={saving}
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>

              <h2 className="card-title" style={{ marginTop: 'var(--space-5)' }}>
                Recall templates
              </h2>
              <TemplateLinkRow
                to="/settings/templates/recall_message"
                slot="First recall"
                content={settings.templates['recall_message'] ?? ''}
              />
              <TemplateLinkRow
                to="/settings/templates/recall_follow_up"
                slot="Recall follow-up"
                content={settings.templates['recall_follow_up'] ?? ''}
              />
              <div className="meta-line">
                Attempt cap: {cfg.config.maxAttempts} attempts (deployment-wide, not editable here).
              </div>
            </div>
          );
        }}
      </SettingsBody>
    </div>
  );
}
