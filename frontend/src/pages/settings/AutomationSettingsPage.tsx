import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSettings, sourceLabel } from '../../lib/settings';
import { useSubmit } from '../../lib/useAsync';
import { useUnsavedChanges } from '../../lib/useUnsavedChanges';
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

interface LeadAutomationForm {
  enabled: boolean;
  channel: string;
  provider: string;
  keywordsText: string;
  sourcesText: string;
  staleHours: number;
  slotsCount: number;
  lookaheadDays: number;
  slaHigh: number;
  slaMedium: number;
  slaLow: number;
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

function toLeadAutomation(settings: Settings): LeadAutomationForm {
  const cfg = settings.automations.leadAutomation.config;
  return {
    enabled: cfg.enabled,
    channel: cfg.channel,
    provider: cfg.provider,
    keywordsText: cfg.highKeywords.join(', '),
    sourcesText: cfg.highSources.join(', '),
    staleHours: cfg.staleHours,
    slotsCount: cfg.slotsCount,
    lookaheadDays: cfg.lookaheadDays,
    slaHigh: cfg.slaDays.high,
    slaMedium: cfg.slaDays.medium,
    slaLow: cfg.slaDays.low,
  };
}

export function AutomationSettingsPage() {
  const { state, reload, patchAutomation } = useSettings();
  const ackSubmit = useSubmit();
  const missedSubmit = useSubmit();
  const noShowSubmit = useSubmit();
  const leadSubmit = useSubmit();
  const settings = state.settings;
  const [ackDraft, setAckDraft] = useState<LeadAckForm | null>(null);
  const [missedDraft, setMissedDraft] = useState<MissedCallForm | null>(null);
  const [noShowDraft, setNoShowDraft] = useState<NoShowForm | null>(null);
  const [leadDraft, setLeadDraft] = useState<LeadAutomationForm | null>(null);
  const ack = ackDraft ?? (settings !== null ? toLeadAck(settings) : null);
  const missed = missedDraft ?? (settings !== null ? toMissedCall(settings) : null);
  const noShow = noShowDraft ?? (settings !== null ? toNoShow(settings) : null);
  const lead = leadDraft ?? (settings !== null ? toLeadAutomation(settings) : null);
  const [clientError, setClientError] = useState<string | null>(null);
  const dirty =
    (ackDraft !== null && settings !== null && JSON.stringify(ackDraft) !== JSON.stringify(toLeadAck(settings))) ||
    (missedDraft !== null &&
      settings !== null &&
      JSON.stringify(missedDraft) !== JSON.stringify(toMissedCall(settings))) ||
    (noShowDraft !== null && settings !== null && JSON.stringify(noShowDraft) !== JSON.stringify(toNoShow(settings))) ||
    (leadDraft !== null &&
      settings !== null &&
      JSON.stringify(leadDraft) !== JSON.stringify(toLeadAutomation(settings)));
  useUnsavedChanges(dirty);

  const clearAll = (): void => {
    ackSubmit.clearFeedback();
    missedSubmit.clearFeedback();
    noShowSubmit.clearFeedback();
    leadSubmit.clearFeedback();
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

  const updateLead = (patch: Partial<LeadAutomationForm>): void => {
    if (settings === null) return;
    setLeadDraft((prev) => ({ ...prev ?? toLeadAutomation(settings), ...patch }));
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

  const saveLead = async (): Promise<void> => {
    if (lead === null) return;
    if (lead.provider.trim().length === 0) {
      setClientError('Provider cannot be empty.');
      return;
    }
    const within = (value: number, min: number, max: number): boolean =>
      Number.isInteger(value) && value >= min && value <= max;
    if (!within(lead.staleHours, 1, 720)) {
      setClientError('Stale threshold must be a whole number of hours between 1 and 720.');
      return;
    }
    if (!within(lead.slotsCount, 1, 10)) {
      setClientError('Slot suggestions per lead must be between 1 and 10.');
      return;
    }
    if (!within(lead.lookaheadDays, 1, 30)) {
      setClientError('Lookahead must be a whole number of days between 1 and 30.');
      return;
    }
    if (!within(lead.slaHigh, 1, 30) || !within(lead.slaMedium, 1, 30) || !within(lead.slaLow, 1, 30)) {
      setClientError('SLA days must be whole numbers between 1 and 30.');
      return;
    }
    const toList = (raw: string): string[] =>
      raw
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    await leadSubmit.submit(() =>
      patchAutomation('leadAutomation', {
        enabled: lead.enabled,
        channel: lead.channel,
        provider: lead.provider.trim(),
        highKeywords: toList(lead.keywordsText),
        highSources: toList(lead.sourcesText),
        staleHours: lead.staleHours,
        slotsCount: lead.slotsCount,
        lookaheadDays: lead.lookaheadDays,
        slaDays: { high: lead.slaHigh, medium: lead.slaMedium, low: lead.slaLow },
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
          if (ack === null || missed === null || noShow === null || lead === null) return null;
          const ackCfg = settings.automations.leadAck;
          const missedCfg = settings.automations.missedCall;
          const noShowCfg = settings.automations.noShow;
          const leadCfg = settings.automations.leadAutomation;
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

              <div className="card">
                <h2 className="card-title">Lead automation &amp; slot suggestions</h2>
                <div className="provider-status">
                  <StatusBadge label={`Source: ${sourceLabel(leadCfg.source)}`} tone={leadCfg.source === 'org' ? 'new' : 'default'} />
                  <StatusBadge label={leadCfg.config.enabled ? 'Enabled' : 'Disabled'} tone={leadCfg.config.enabled ? 'success' : 'default'} />
                </div>
                {leadSubmit.saved ? (
                  <Flash kind="success" message="Lead automation saved." onDismiss={leadSubmit.clearFeedback} />
                ) : null}
                {leadSubmit.error ? (
                  <Flash kind="error" message={leadSubmit.error} onDismiss={leadSubmit.clearFeedback} />
                ) : null}
                <AutomationFields
                  enabled={lead.enabled}
                  channel={lead.channel}
                  provider={lead.provider}
                  onEnabled={(v) => updateLead({ enabled: v })}
                  onChannel={(v) => updateLead({ channel: v })}
                  onProvider={(v) => updateLead({ provider: v })}
                />
                <div className="form-grid">
                  <FormField label="High-urgency keywords" hint="Comma-separated, matched against the requested service.">
                    <input
                      className="input"
                      value={lead.keywordsText}
                      onChange={(e) => updateLead({ keywordsText: e.target.value })}
                    />
                  </FormField>
                  <FormField label="High-urgency sources" hint="Comma-separated lead sources, e.g. MISSED_CALL.">
                    <input
                      className="input"
                      value={lead.sourcesText}
                      onChange={(e) => updateLead({ sourcesText: e.target.value })}
                    />
                  </FormField>
                  <NumberField
                    label="Stale threshold (hours)"
                    hint="1–720. Leads untouched longer than this score as urgent."
                    value={lead.staleHours}
                    min={1}
                    max={720}
                    onChange={(v) => updateLead({ staleHours: v })}
                  />
                  <NumberField
                    label="Suggestions per lead"
                    hint="1–10 free slots to propose."
                    value={lead.slotsCount}
                    min={1}
                    max={10}
                    onChange={(v) => updateLead({ slotsCount: v })}
                  />
                  <NumberField
                    label="Lookahead (days)"
                    hint="1–30 days into the future to search for free slots."
                    value={lead.lookaheadDays}
                    min={1}
                    max={30}
                    onChange={(v) => updateLead({ lookaheadDays: v })}
                  />
                  <NumberField
                    label="SLA — high urgency (days)"
                    hint="1–30."
                    value={lead.slaHigh}
                    min={1}
                    max={30}
                    onChange={(v) => updateLead({ slaHigh: v })}
                  />
                  <NumberField
                    label="SLA — medium urgency (days)"
                    hint="1–30."
                    value={lead.slaMedium}
                    min={1}
                    max={30}
                    onChange={(v) => updateLead({ slaMedium: v })}
                  />
                  <NumberField
                    label="SLA — low urgency (days)"
                    hint="1–30."
                    value={lead.slaLow}
                    min={1}
                    max={30}
                    onChange={(v) => updateLead({ slaLow: v })}
                  />
                </div>
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void saveLead()}
                    disabled={leadSubmit.saving}
                  >
                    {leadSubmit.saving ? 'Saving…' : 'Save lead automation'}
                  </button>
                </div>
                <TemplateLinkRow
                  to="/settings/templates/appointment_confirmation"
                  slot="Appointment confirmation template"
                  content={settings.templates['appointment_confirmation'] ?? ''}
                />
                <div className="meta-line">
                  Approving a suggestion creates the appointment and queues the confirmation through
                  the selected channel. Manage the Doctors Panel from the{' '}
                  <Link to="/doctors">Doctors</Link> page.
                </div>
              </div>
            </div>
          );
        }}
      </SettingsBody>
    </div>
  );
}
