import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useSettings, previewTemplate, sourceLabel } from '../../lib/settings';
import { useSubmit } from '../../lib/useAsync';
import type { PreviewResult, Settings } from '../../lib/types';
import { PageHeader } from '../../components/PageHeader';
import { FormField } from '../../components/FormField';
import { Flash } from '../../components/Flash';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ErrorState } from '../../components/states';
import { SettingsBody } from './SettingsBody';

const LABELS: Record<string, string> = {
  lead_acknowledgement: 'Lead acknowledgement',
  missed_call_response: 'Missed-call response',
  appointment_reminder_48h: 'Reminder — 48 hours before',
  appointment_reminder_24h: 'Reminder — 24 hours before',
  appointment_reminder_2h: 'Reminder — 2 hours before',
  no_show_message: 'No-show notice',
  no_show_follow_up: 'No-show follow-up',
  recall_message: 'Recall message',
  recall_follow_up: 'Recall follow-up',
  review_request: 'Review request',
};

const MAX_LENGTH = 2000;

export function TemplateEditorPage() {
  const { templateName } = useParams<{ templateName: string }>();
  const name = templateName ?? '';
  const { state, reload, patchTemplate } = useSettings();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { submit, saving, error, saved, clearFeedback } = useSubmit();

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Record<string, PreviewResult | null>>({});
  const [previewErrors, setPreviewErrors] = useState<Record<string, string | null>>({});
  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const serverContent = state.settings !== null ? state.settings.templates[name] ?? '' : null;
  const content = drafts[name] ?? serverContent ?? '';
  const preview = previews[name] ?? null;
  const previewError = previewErrors[name] ?? null;

  const setContent = (value: string): void => {
    setDrafts((prev) => ({ ...prev, [name]: value }));
    clearFeedback();
    setPreviews((prev) => ({ ...prev, [name]: null }));
  };

  const insertVariable = (varName: string): void => {
    const token = `{{${varName}}}`;
    const ta = textareaRef.current;
    const start = ta?.selectionStart ?? content.length;
    const end = ta?.selectionEnd ?? content.length;
    const next = content.slice(0, start) + token + content.slice(end);
    setContent(next);
    requestAnimationFrame(() => {
      if (ta !== null) {
        ta.focus();
        ta.selectionStart = start + token.length;
        ta.selectionEnd = start + token.length;
      }
    });
  };

  const runPreview = async (): Promise<PreviewResult | null> => {
    if (user === null) return null;
    setPreviewBusy(true);
    setPreviewErrors((prev) => ({ ...prev, [name]: null }));
    try {
      const res = await previewTemplate(user.organizationId, content);
      setPreviews((prev) => ({ ...prev, [name]: res }));
      return res;
    } catch (err) {
      setPreviewErrors((prev) => ({ ...prev, [name]: err instanceof Error ? err.message : 'Preview failed.' }));
      return null;
    } finally {
      setPreviewBusy(false);
    }
  };

  const saveTemplate = async (): Promise<void> => {
    const result = await submit(() => patchTemplate(name, { body: content }));
    if (result !== null) {
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      setPreviews((prev) => ({ ...prev, [name]: null }));
    }
  };

  const onSaveClick = async (): Promise<void> => {
    if (empty || tooLong) return;
    setChecking(true);
    setPreviewErrors((prev) => ({ ...prev, [name]: null }));
    try {
      const checked = await previewTemplate(user?.organizationId ?? 0, content);
      if (checked.unknownVariables.length > 0) {
        setConfirmFor(name);
        return;
      }
    } catch (err) {
      setPreviewErrors((prev) => ({ ...prev, [name]: err instanceof Error ? err.message : 'Could not validate the template.' }));
      return;
    } finally {
      setChecking(false);
    }
    await saveTemplate();
  };

  const empty = content.trim().length === 0;
  const tooLong = content.length > MAX_LENGTH;

  return (
    <div>
      <PageHeader
        title="Edit template"
        subtitle={LABELS[name] ?? name}
        actions={<Link to="/settings/templates">Back to templates</Link>}
      />
      <SettingsBody state={state} onRetry={reload}>
        {(settings: Settings) => {
          if (!settings.definitions.templateNames.includes(name)) {
            return (
              <ErrorState
                message={`Unknown template "${name}".`}
                onRetry={() => navigate('/settings/templates')}
                retryLabel="Back to templates"
              />
            );
          }
          return (
            <div className="card">
              {saved ? (
                <Flash kind="success" message="Template saved." onDismiss={clearFeedback} />
              ) : null}
              {error ? <Flash kind="error" message={error} onDismiss={clearFeedback} /> : null}
              {previewError ? (
                <Flash kind="error" message={previewError} onDismiss={() => setPreviewErrors((prev) => ({ ...prev, [name]: null }))} />
              ) : null}

              <div className="var-list" aria-label="Available variables">
                {settings.definitions.templateVariables.map((v) => (
                  <button
                    key={v.name}
                    type="button"
                    className="var-chip"
                    onClick={() => insertVariable(v.name)}
                    title={v.source ? `Source: ${sourceLabel(v.source)}` : 'Not populated automatically'}
                  >
                    {`{{${v.name}}}`}
                  </button>
                ))}
              </div>

              <FormField
                label="Template content"
                hint={`Up to ${MAX_LENGTH} characters. Click a variable to insert it at the cursor.`}
                error={empty ? 'Template cannot be empty.' : tooLong ? `Too long (${content.length}/${MAX_LENGTH}).` : undefined}
              >
                <textarea
                  ref={textareaRef}
                  className={`textarea ${empty || tooLong ? 'invalid' : ''}`}
                  value={content}
                  maxLength={MAX_LENGTH + 100}
                  onChange={(e) => {
                    setContent(e.target.value);
                    clearFeedback();
                  }}
                />
              </FormField>

              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void runPreview()}
                  disabled={previewBusy || empty}
                >
                  {previewBusy ? 'Previewing…' : 'Preview'}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void onSaveClick()}
                  disabled={saving || checking || empty || tooLong}
                >
                  {saving || checking ? 'Saving…' : 'Save template'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => navigate('/settings/templates')}
                  disabled={saving}
                >
                  Cancel
                </button>
              </div>

              {preview ? (
                <div style={{ marginTop: 'var(--space-4)' }}>
                  <h2 className="card-title">Preview</h2>
                  <div className="preview-box">{preview.rendered || '(empty)'}</div>
                  {preview.unknownVariables.length > 0 ? (
                    <div style={{ marginTop: 'var(--space-3)' }}>
                      <div className="hint" style={{ color: 'var(--color-danger)', marginBottom: 'var(--space-1)' }}>
                        Unknown variables (not replaced when sent):
                      </div>
                      <div className="var-list">
                        {preview.unknownVariables.map((v) => (
                          <span key={v} className="var-chip invalid">
                            {`{{${v}}}`}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="meta-line">All variables in this template are supported.</div>
                  )}
                </div>
              ) : null}
            </div>
          );
        }}
      </SettingsBody>

      <ConfirmDialog
        open={confirmFor === name}
        title="Save with unknown variables?"
        body="This template contains variables the system does not recognise. They will not be replaced when the message is sent. Save anyway?"
        confirmLabel="Save anyway"
        danger
        busy={saving}
        onConfirm={() => {
          setConfirmFor(null);
          void saveTemplate();
        }}
        onCancel={() => setConfirmFor(null)}
      />
    </div>
  );
}
