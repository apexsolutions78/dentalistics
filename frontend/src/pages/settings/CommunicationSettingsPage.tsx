import { useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useSettings } from '../../lib/settings';
import { useSubmit } from '../../lib/useAsync';
import type { Settings } from '../../lib/types';
import { PageHeader } from '../../components/PageHeader';
import { FormField } from '../../components/FormField';
import { Flash } from '../../components/Flash';
import { StatusBadge } from '../../components/states';
import { SettingsBody } from './SettingsBody';

interface TelephonyForm {
  enabled: boolean;
  signingSecret: string;
  clearSecret: boolean;
}

interface WhatsAppForm {
  enabled: boolean;
  verifyToken: string;
  appSecret: string;
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
  clear: { verifyToken: boolean; appSecret: boolean; accessToken: boolean };
}

function toTelephony(settings: Settings): TelephonyForm {
  return { enabled: settings.providers.telephony.enabled, signingSecret: '', clearSecret: false };
}

function toWhatsApp(settings: Settings): WhatsAppForm {
  return {
    enabled: settings.providers.whatsapp.enabled,
    verifyToken: '',
    appSecret: '',
    accessToken: '',
    phoneNumberId: settings.providers.whatsapp.graph.phoneNumberId,
    apiVersion: settings.providers.whatsapp.graph.apiVersion,
    clear: { verifyToken: false, appSecret: false, accessToken: false },
  };
}

export function CommunicationSettingsPage() {
  const { user } = useAuth();
  const { state, reload, patchProvider } = useSettings();
  const { submit, saving, error, saved, clearFeedback } = useSubmit();

  const settings = state.settings;
  const [telDraft, setTelDraft] = useState<TelephonyForm | null>(null);
  const [waDraft, setWaDraft] = useState<WhatsAppForm | null>(null);
  const tel = telDraft ?? (settings !== null ? toTelephony(settings) : null);
  const wa = waDraft ?? (settings !== null ? toWhatsApp(settings) : null);
  const setTel = (value: TelephonyForm): void => setTelDraft(value);
  const setWa = (value: WhatsAppForm): void => setWaDraft(value);

  const saveTelephony = async (): Promise<void> => {
    if (tel === null || user === null) return;
    const body: Record<string, unknown> = { enabled: tel.enabled };
    if (tel.clearSecret) {
      body.signingSecret = null;
    } else if (tel.signingSecret.length > 0) {
      body.signingSecret = tel.signingSecret;
    }
    const ok = await submit(() => patchProvider('telephony', body));
    if (ok !== null) {
      setTel({ ...tel, signingSecret: '', clearSecret: false });
    }
  };

  const saveWhatsApp = async (): Promise<void> => {
    if (wa === null || user === null) return;
    const body: Record<string, unknown> = { enabled: wa.enabled };
    const secretFields: Array<keyof WhatsAppForm['clear']> = ['verifyToken', 'appSecret', 'accessToken'];
    const graph: Record<string, string> = {};
    for (const field of secretFields) {
      if (wa.clear[field]) {
        body[field] = null;
      } else if (wa[field].length > 0) {
        body[field] = wa[field];
      }
    }
    graph.phoneNumberId = wa.phoneNumberId;
    graph.apiVersion = wa.apiVersion;
    body.graph = graph;
    const ok = await submit(() => patchProvider('whatsapp', body));
    if (ok !== null) {
      setWa({
        ...wa,
        verifyToken: '',
        appSecret: '',
        accessToken: '',
        clear: { verifyToken: false, appSecret: false, accessToken: false },
      });
    }
  };

  return (
    <div>
      <PageHeader
        title="Communication providers"
        subtitle="Connection settings for calls and WhatsApp. Secrets are write-only — saved values are never shown."
      />
      <SettingsBody state={state} onRetry={reload}>
        {(settings: Settings) => {
          if (tel === null || wa === null) return null;
          const telConfigured = settings.providers.telephony.configured.signingSecret;
          const waConfigured = settings.providers.whatsapp.configured;
          return (
            <div>
              {saved ? <Flash kind="success" message="Provider settings saved." onDismiss={clearFeedback} /> : null}
              {error ? <Flash kind="error" message={error} onDismiss={clearFeedback} /> : null}

              <div className="card">
                <div className="card-title">Telephony</div>
                <div className="provider-status">
                  <StatusBadge
                    label={telConfigured ? 'Signing secret configured' : 'Signing secret not set'}
                    tone={telConfigured ? 'success' : 'warn'}
                  />
                  <StatusBadge label={tel.enabled ? 'Enabled' : 'Disabled'} tone={tel.enabled ? 'success' : 'default'} />
                </div>
                <FormField label="Enabled" hint="Required for missed-call detection.">
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={tel.enabled}
                      onChange={(e) => {
                        setTel({ ...tel, enabled: e.target.checked });
                        clearFeedback();
                      }}
                    />
                    Telephony integration active
                  </label>
                </FormField>
                <FormField
                  label="Webhook signing secret"
                  hint={telConfigured ? 'A secret is saved. Type a new value to replace it.' : 'No secret saved yet.'}
                >
                  <input
                    className="input"
                    type="password"
                    autoComplete="off"
                    placeholder={telConfigured ? '(saved)' : 'Not set'}
                    value={tel.signingSecret}
                    onChange={(e) => {
                      setTel({ ...tel, signingSecret: e.target.value, clearSecret: false });
                      clearFeedback();
                    }}
                  />
                </FormField>
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void saveTelephony()}
                    disabled={saving}
                  >
                    {saving ? 'Saving…' : 'Save telephony'}
                  </button>
                  {telConfigured ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setTel({ ...tel, signingSecret: '', clearSecret: true });
                        clearFeedback();
                      }}
                    >
                      Clear secret
                    </button>
                  ) : null}
                  {tel.clearSecret ? (
                    <span className="meta-line">Secret will be cleared on save.</span>
                  ) : null}
                </div>
              </div>

              <div className="card">
                <div className="card-title">WhatsApp</div>
                <div className="provider-status">
                  <StatusBadge
                    label={waConfigured.verifyToken ? 'Verify token set' : 'Verify token missing'}
                    tone={waConfigured.verifyToken ? 'success' : 'warn'}
                  />
                  <StatusBadge
                    label={waConfigured.appSecret ? 'App secret set' : 'App secret missing'}
                    tone={waConfigured.appSecret ? 'success' : 'warn'}
                  />
                  <StatusBadge
                    label={waConfigured.accessToken ? 'Access token set' : 'Access token missing'}
                    tone={waConfigured.accessToken ? 'success' : 'warn'}
                  />
                  <StatusBadge label={wa.enabled ? 'Enabled' : 'Disabled'} tone={wa.enabled ? 'success' : 'default'} />
                </div>
                <FormField label="Enabled">
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={wa.enabled}
                      onChange={(e) => {
                        setWa({ ...wa, enabled: e.target.checked });
                        clearFeedback();
                      }}
                    />
                    WhatsApp integration active
                  </label>
                </FormField>
                <div className="form-grid">
                  <FormField label="Verify token" hint="Leave blank to keep the saved value.">
                    <input
                      className="input"
                      type="password"
                      autoComplete="off"
                      placeholder={waConfigured.verifyToken ? '(saved)' : 'Not set'}
                      value={wa.verifyToken}
                      onChange={(e) => {
                        setWa({ ...wa, verifyToken: e.target.value, clear: { ...wa.clear, verifyToken: false } });
                        clearFeedback();
                      }}
                    />
                  </FormField>
                  <FormField label="App secret" hint="Leave blank to keep the saved value.">
                    <input
                      className="input"
                      type="password"
                      autoComplete="off"
                      placeholder={waConfigured.appSecret ? '(saved)' : 'Not set'}
                      value={wa.appSecret}
                      onChange={(e) => {
                        setWa({ ...wa, appSecret: e.target.value, clear: { ...wa.clear, appSecret: false } });
                        clearFeedback();
                      }}
                    />
                  </FormField>
                  <FormField label="Graph access token" hint="Leave blank to keep the saved value.">
                    <input
                      className="input"
                      type="password"
                      autoComplete="off"
                      placeholder={waConfigured.accessToken ? '(saved)' : 'Not set'}
                      value={wa.accessToken}
                      onChange={(e) => {
                        setWa({ ...wa, accessToken: e.target.value, clear: { ...wa.clear, accessToken: false } });
                        clearFeedback();
                      }}
                    />
                  </FormField>
                  <FormField label="Phone number ID">
                    <input
                      className="input"
                      value={wa.phoneNumberId}
                      onChange={(e) => {
                        setWa({ ...wa, phoneNumberId: e.target.value });
                        clearFeedback();
                      }}
                    />
                  </FormField>
                  <FormField label="Graph API version">
                    <input
                      className="input"
                      value={wa.apiVersion}
                      onChange={(e) => {
                        setWa({ ...wa, apiVersion: e.target.value });
                        clearFeedback();
                      }}
                    />
                  </FormField>
                </div>
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void saveWhatsApp()}
                    disabled={saving}
                  >
                    {saving ? 'Saving…' : 'Save WhatsApp'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setWa({
                        ...wa,
                        verifyToken: '',
                        appSecret: '',
                        accessToken: '',
                        clear: { verifyToken: true, appSecret: true, accessToken: true },
                      });
                      clearFeedback();
                    }}
                  >
                    Clear secrets
                  </button>
                </div>
              </div>
            </div>
          );
        }}
      </SettingsBody>
    </div>
  );
}
