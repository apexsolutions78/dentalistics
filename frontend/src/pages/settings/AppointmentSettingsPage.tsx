import { useState } from 'react';
import { useSettings } from '../../lib/settings';
import { useSubmit } from '../../lib/useAsync';
import type { Settings } from '../../lib/types';
import { PageHeader } from '../../components/PageHeader';
import { FormField } from '../../components/FormField';
import { Flash } from '../../components/Flash';
import { StatusBadge } from '../../components/states';
import { SettingsBody } from './SettingsBody';
import { AutomationFields, TemplateLinkRow } from './AutomationFields';

interface ReminderForm {
  enabled: boolean;
  channel: string;
  provider: string;
  offsetsText: string;
  quietEnabled: boolean;
  quietStart: string;
  quietEnd: string;
}

function toForm(settings: Settings): ReminderForm {
  const cfg = settings.automations.reminder.config;
  return {
    enabled: cfg.enabled,
    channel: cfg.channel,
    provider: cfg.provider,
    offsetsText: cfg.offsetsHours.join(', '),
    quietEnabled: cfg.quietHours.enabled,
    quietStart: cfg.quietHours.start,
    quietEnd: cfg.quietHours.end,
  };
}

function parseOffsets(text: string): { ok: true; values: number[] } | { ok: false; message: string } {
  const parts = text.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) {
    return { ok: false, message: 'At least one reminder offset is required.' };
  }
  const values: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return { ok: false, message: `"${part}" is not a whole number of hours.` };
    }
    const n = Number(part);
    if (n < 1 || n > 720) {
      return { ok: false, message: `Offset ${n} must be between 1 and 720 hours (30 days).` };
    }
    if (!values.includes(n)) values.push(n);
  }
  return { ok: true, values };
}

export function AppointmentSettingsPage() {
  const { state, reload, patchAutomation } = useSettings();
  const { submit, saving, error, saved, clearFeedback } = useSubmit();
  const [draft, setDraft] = useState<ReminderForm | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const settings = state.settings;
  const form = draft ?? (settings !== null ? toForm(settings) : null);

  const update = <K extends keyof ReminderForm>(key: K, value: ReminderForm[K]): void => {
    setDraft((prev) => {
      const base = prev ?? (settings !== null ? toForm(settings) : null);
      return base === null ? base : { ...base, [key]: value };
    });
    clearFeedback();
    setClientError(null);
  };

  const onSave = async (): Promise<void> => {
    if (form === null) return;
    const parsed = parseOffsets(form.offsetsText);
    if (!parsed.ok) {
      setClientError(parsed.message);
      return;
    }
    if (form.provider.trim().length === 0) {
      setClientError('Provider cannot be empty.');
      return;
    }
    await submit(() =>
      patchAutomation('reminder', {
        enabled: form.enabled,
        channel: form.channel,
        provider: form.provider.trim(),
        offsetsHours: parsed.values,
        quietHours: { enabled: form.quietEnabled, start: form.quietStart, end: form.quietEnd },
      }),
    );
  };

  return (
    <div>
      <PageHeader
        title="Appointments & reminders"
        subtitle="Appointment confirmation and pre-visit reminders"
      />
      <SettingsBody state={state} onRetry={reload}>
        {(settings: Settings) => {
          if (form === null) return null;
          const cfg = settings.automations.reminder;
          return (
            <div className="card">
              <div className="provider-status">
                <StatusBadge label={`Source: ${cfg.source}`} tone={cfg.source === 'org' ? 'new' : 'default'} />
                <StatusBadge label={cfg.config.enabled ? 'Enabled' : 'Disabled'} tone={cfg.config.enabled ? 'success' : 'default'} />
              </div>
              {saved ? <Flash kind="success" message="Reminder settings saved." onDismiss={clearFeedback} /> : null}
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

              <FormField
                label="Reminder offsets (hours before the appointment)"
                hint="Comma-separated hours, 1–720. Defaults: 48, 24, 2."
              >
                <input
                  className="input"
                  value={form.offsetsText}
                  onChange={(e) => update('offsetsText', e.target.value)}
                />
              </FormField>

              <div className="card-title">Quiet hours</div>
              <FormField label="Suppress sends during quiet hours">
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={form.quietEnabled}
                    onChange={(e) => update('quietEnabled', e.target.checked)}
                  />
                  Quiet hours active
                </label>
              </FormField>
              <div className="form-grid">
                <FormField label="Quiet from">
                  <input
                    className="input"
                    type="time"
                    value={form.quietStart}
                    disabled={!form.quietEnabled}
                    onChange={(e) => update('quietStart', e.target.value)}
                  />
                </FormField>
                <FormField label="Quiet until">
                  <input
                    className="input"
                    type="time"
                    value={form.quietEnd}
                    disabled={!form.quietEnabled}
                    onChange={(e) => update('quietEnd', e.target.value)}
                  />
                </FormField>
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

              <div className="card-title" style={{ marginTop: 'var(--space-5)' }}>
                Reminder templates
              </div>
              <TemplateLinkRow
                to="/settings/templates/appointment_reminder_48h"
                slot="48 hours before"
                content={settings.templates['appointment_reminder_48h'] ?? ''}
              />
              <TemplateLinkRow
                to="/settings/templates/appointment_reminder_24h"
                slot="24 hours before"
                content={settings.templates['appointment_reminder_24h'] ?? ''}
              />
              <TemplateLinkRow
                to="/settings/templates/appointment_reminder_2h"
                slot="2 hours before"
                content={settings.templates['appointment_reminder_2h'] ?? ''}
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
