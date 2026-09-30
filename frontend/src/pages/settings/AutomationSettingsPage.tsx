import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSettings, sourceLabel } from '../../lib/settings';
import { useSubmit } from '../../lib/useAsync';
import type { Settings } from '../../lib/types';
import { PageHeader } from '../../components/PageHeader';
import { FormField } from '../../components/FormField';
import { Flash } from '../../components/Flash';
import { StatusBadge } from '../../components/states';
import { SettingsBody } from './SettingsBody';
import { AutomationFields, NumberField, TemplateLinkRow } from './AutomationFields';

interface LeadAckForm {
  enabled: boolean;
  channel: string;
  provider: string;
  sourcesText: string;
}

interface MissedCallForm {
  enabled: boolean;
  channel: string;
  provider: string;
}

interface NoShowForm {
  enabled: boolean;
  channel: string;
  provider: string;
  followUpDelayHours: number;
}

function toLeadAck(settings: Settings): LeadAckForm {
  const cfg = settings.automations.leadAck.config;
  return { enabled: cfg.enabled, channel: cfg.channel, provider: cfg.provider, sourcesText: cfg.sources.join(', ') };
}

function toMissedCall(settings: Settings): MissedCallForm {
  const cfg = settings.automations.missedCall.config;
  return { enabled: cfg.enabled, channel: cfg.channel, provider: cfg.provider };
}

function toNoShow(settings: Settings): NoShowForm {
  const cfg = settings.automations.noShow.config;
  return { enabled: cfg.enabled, channel: cfg.channel, provider: cfg.provider, followUpDelayHours: cfg.followUpDelayHours };
}

export function AutomationSettingsPage() {
  const { state, reload, patchAutomation } = useSettings();
  const ackSubmit = useSubmit();
  const missedSubmit = useSubmit();
  const noShowSubmit = useSubmit();
  const settings = state.settings;
  const [ackDraft, setAckDraft] = useState<LeadAckForm | null>(null);
  const [missedDraft, setMissedDraft] = useState<MissedCallForm | null>(null);
  const [noShowDraft, setNoShowDraft] = useState<NoShowForm | null>(null);
  const ack = ackDraft ?? (settings !== null ? toLeadAck(settings) : null);
  const missed = missedDraft ?? (settings !== null ? toMissedCall(settings) : null);
  const noShow = noShowDraft ?? (settings !== null ? toNoShow(settings) : null);
  const [clientError, setClientError] = useState<string | null>(null);

  const clearAll = (): void => {
    ackSubmit.clearFeedback();
    missedSubmit.clearFeedback();
    noShowSubmit.clearFeedback();
    setClientError(null);
  };

  const updateAck = (patch: Partial<LeadAckForm>): void => {
    if (settings === null) return;
    setAckDraft((prev) => ({ ...prev ?? toLeadAck(settings), ...patch }));
    clearAll();
  };

  const updateMissed = (patch: Partial<MissedCallForm>): void => {
    if (settings === null) return;
    setMissedDraft((prev) => ({ ...prev ?? toMissedCall(settings), ...patch }));
    clearAll();
  };

  const updateNoShow = (patch: Partial<NoShowForm>): void => {
    if (settings === null) return;
    setNoShowDraft((prev) => ({ ...prev ?? toNoShow(settings), ...patch }));
    clearAll();
  };

    const saveAck = async (): Promise<void> => {
    if (ack === null) return;
    const sources = ack.sourcesText.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    if (sources.length === 0) {
      setClientError('At least one lead source is required.');
      return;
    }
    if (ack.provider.trim().length === 0) {
      setClientError('Provider cannot be empty.');
      return;
    }
    await ackSubmit.submit(() =>
      patchAutomation('leadAck', {
        enabled: ack.enabled,
        channel: ack.channel,
        provider: ack.provider.trim(),
        sources,
      }),
    );
  };

  const saveMissed = async (): Promise<void> => {
    if (missed === null) return;
    if (missed.provider.trim().length === 0) {
      setClientError('Provider cannot be empty.');
      return;
    }
    await missedSubmit.submit(() =>
      patchAutomation('missedCall', {
        enabled: missed.enabled,
        channel: missed.channel,
        provider: missed.provider.trim(),
      }),
    );
  };

  const saveNoShow = async (): Promise<void> => {
    if (noShow === null) return;
    if (noShow.provider.trim().length === 0) {
      setClientError('Provider cannot be empty.');
      return;
    }
    if (
      !Number.isInteger(noShow.followUpDelayHours) ||
      noShow.followUpDelayHours < 1 ||
      noShow.followUpDelayHours > 168
    ) {
      setClientError('Follow-up delay must be a whole number of hours between 1 and 168.');
      return;
    }
    await noShowSubmit.submit(() =>
      patchAutomation('noShow', {
        enabled: noShow.enabled,
        channel: noShow.channel,
        provider: noShow.provider.trim(),
        followUpDelayHours: noShow.followUpDelayHours,
      }),
    );
  };

  return (
    <div>
      <PageHeader
        title="Automation"
        subtitle="Front-desk automations: lead acknowledgement, missed-call replies, and no-show follow-up"
      />
      <SettingsBody state={state} onRetry={reload}>
        {(settings: Settings) => {
          if (ack === null || missed === null || noShow === null) return null;
          const ackCfg = settings.automations.leadAck;
          const missedCfg = settings.automations.missedCall;
          const noShowCfg = settings.automations.noShow;
          return (
            <div>
              {clientError ? (
                <Flash kind="error" message={clientError} onDismiss={() => setClientError(null)} />
              ) : null}

              <div className="card">
                <h2 className="card-title">Lead acknowledgement</h2>
                <div className="provider-status">
                  <StatusBadge label={`Source: ${sourceLabel(ackCfg.source)}`} tone={ackCfg.source === 'org' ? 'new' : 'default'} />
                  <StatusBadge label={ackCfg.config.enabled ? 'Enabled' : 'Disabled'} tone={ackCfg.config.enabled ? 'success' : 'default'} />
                </div>
                {ackSubmit.saved ? (
                  <Flash kind="success" message="Lead acknowledgement saved." onDismiss={ackSubmit.clearFeedback} />
                ) : null}
                {ackSubmit.error ? <Flash kind="error" message={ackSubmit.error} onDismiss={ackSubmit.clearFeedback} /> : null}
                <AutomationFields
                  enabled={ack.enabled}
                  channel={ack.channel}
                  provider={ack.provider}
                  onEnabled={(v) => updateAck({ enabled: v })}
                  onChannel={(v) => updateAck({ channel: v })}
                  onProvider={(v) => updateAck({ provider: v })}
                />
                <FormField
                  label="Lead sources"
                  hint="Comma-separated lead sources that receive an acknowledgement, e.g. WEBSITE."
                >
                  <input
                    className="input"
                    value={ack.sourcesText}
                    onChange={(e) => updateAck({ sourcesText: e.target.value })}
                  />
                </FormField>
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void saveAck()}
                    disabled={ackSubmit.saving}
                  >
                    {ackSubmit.saving ? 'Saving…' : 'Save lead acknowledgement'}
                  </button>
                </div>
                <TemplateLinkRow
                  to="/settings/templates/lead_acknowledgement"
                  slot="Acknowledgement template"
                  content={settings.templates['lead_acknowledgement'] ?? ''}
                />
              </div>

              <div className="card">
                <h2 className="card-title">Missed-call response</h2>
                <div className="provider-status">
                  <StatusBadge label={`Source: ${sourceLabel(missedCfg.source)}`} tone={missedCfg.source === 'org' ? 'new' : 'default'} />
                  <StatusBadge label={missedCfg.config.enabled ? 'Enabled' : 'Disabled'} tone={missedCfg.config.enabled ? 'success' : 'default'} />
                </div>
                {missedSubmit.saved ? (
                  <Flash kind="success" message="Missed-call response saved." onDismiss={missedSubmit.clearFeedback} />
                ) : null}
                {missedSubmit.error ? (
                  <Flash kind="error" message={missedSubmit.error} onDismiss={missedSubmit.clearFeedback} />
                ) : null}
                <AutomationFields
                  enabled={missed.enabled}
                  channel={missed.channel}
                  provider={missed.provider}
                  onEnabled={(v) => updateMissed({ enabled: v })}
                  onChannel={(v) => updateMissed({ channel: v })}
                  onProvider={(v) => updateMissed({ provider: v })}
                />
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void saveMissed()}
                    disabled={missedSubmit.saving}
                  >
                    {missedSubmit.saving ? 'Saving…' : 'Save missed-call response'}
                  </button>
                </div>
                <TemplateLinkRow
                  to="/settings/templates/missed_call_response"
                  slot="Missed-call template"
                  content={settings.templates['missed_call_response'] ?? ''}
                />
                <div className="meta-line">
                  Requires the telephony integration on the{' '}
                  <Link to="/settings/communication">Communication</Link> page.
                </div>
              </div>

              <div className="card">
                <h2 className="card-title">No-show follow-up</h2>
                <div className="provider-status">
                  <StatusBadge label={`Source: ${sourceLabel(noShowCfg.source)}`} tone={noShowCfg.source === 'org' ? 'new' : 'default'} />
                  <StatusBadge label={noShowCfg.config.enabled ? 'Enabled' : 'Disabled'} tone={noShowCfg.config.enabled ? 'success' : 'default'} />
                </div>
                {noShowSubmit.saved ? (
                  <Flash kind="success" message="No-show follow-up saved." onDismiss={noShowSubmit.clearFeedback} />
                ) : null}
                {noShowSubmit.error ? (
                  <Flash kind="error" message={noShowSubmit.error} onDismiss={noShowSubmit.clearFeedback} />
                ) : null}
                <AutomationFields
                  enabled={noShow.enabled}
                  channel={noShow.channel}
                  provider={noShow.provider}
                  onEnabled={(v) => updateNoShow({ enabled: v })}
                  onChannel={(v) => updateNoShow({ channel: v })}
                  onProvider={(v) => updateNoShow({ provider: v })}
                />
                <div className="form-grid">
                  <NumberField
                    label="Follow-up delay (hours)"
                    hint="1–168."
                    value={noShow.followUpDelayHours}
                    min={1}
                    max={168}
                    onChange={(v) => updateNoShow({ followUpDelayHours: v })}
                  />
                </div>
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void saveNoShow()}
                    disabled={noShowSubmit.saving}
                  >
                    {noShowSubmit.saving ? 'Saving…' : 'Save no-show follow-up'}
                  </button>
                </div>
                <TemplateLinkRow
                  to="/settings/templates/no_show_message"
                  slot="No-show notice"
                  content={settings.templates['no_show_message'] ?? ''}
                />
                <TemplateLinkRow
                  to="/settings/templates/no_show_follow_up"
                  slot="No-show follow-up"
                  content={settings.templates['no_show_follow_up'] ?? ''}
                />
                <div className="meta-line">
                  Attempt cap: {noShowCfg.config.maxAttempts} attempts (deployment-wide, not editable here).
                </div>
              </div>
            </div>
          );
        }}
      </SettingsBody>
    </div>
  );
}
