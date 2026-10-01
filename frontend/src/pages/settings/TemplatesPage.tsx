import { Link } from 'react-router-dom';
import { useSettings } from '../../lib/settings';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/states';
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

export function TemplatesPage() {
  const { state, reload } = useSettings();

  return (
    <div>
      <PageHeader
        title="Message templates"
        subtitle="Edit the content used by every automation. Changes are saved per clinic."
      />
      <SettingsBody state={state} onRetry={reload}>
        {(settings) => {
          const names = settings.definitions.templateNames;
          if (names.length === 0) {
            return <EmptyState title="No templates" description="This deployment defines no template slots." />;
          }
          return (
            <div className="card">
              {names.map((name) => {
                const content = settings.templates[name] ?? '';
                return (
                  <Link key={name} to={`/settings/templates/${encodeURIComponent(name)}`} className="template-link">
                    <span className="slot">{LABELS[name] ?? name}</span>
                    <span className={`badge ${content ? 'badge-success' : 'badge-warn'}`}>
                      {content ? 'Configured' : 'Empty'}
                    </span>
                    <span className="snippet">{content || 'Empty template'}</span>
                  </Link>
                );
              })}
            </div>
          );
        }}
      </SettingsBody>
    </div>
  );
}
