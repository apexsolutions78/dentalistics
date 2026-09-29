import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useSettings } from '../../lib/settings';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/states';
import { SettingsBody } from './SettingsBody';

interface CategoryCard {
  to: string;
  title: string;
  description: string;
}

const CATEGORIES: CategoryCard[] = [
  { to: '/settings/clinic', title: 'Clinic profile', description: 'Name, contact details, hours, timezone' },
  { to: '/settings/users', title: 'Users & roles', description: 'Invite, review, and disable clinic users' },
  { to: '/settings/communication', title: 'Communication', description: 'Telephony and WhatsApp providers' },
  { to: '/settings/templates', title: 'Templates', description: 'Message content for every automation' },
  { to: '/settings/appointments', title: 'Appointments & reminders', description: 'Reminder timing, quiet hours, channels' },
  { to: '/settings/recall', title: 'Recall', description: 'Inactive-patient recall cadence' },
  { to: '/settings/reviews', title: 'Reviews', description: 'Review request timing and destination' },
  { to: '/settings/automation', title: 'Automation', description: 'Lead acknowledgement and missed-call replies' },
];

export function SettingsOverviewPage() {
  const { user } = useAuth();
  const { state, reload } = useSettings();

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle={`Signed in as ${user?.email ?? ''}`}
      />
      <SettingsBody state={state} onRetry={reload}>
        {(settings) => (
          <div className="card-grid">
            {CATEGORIES.map((cat) => (
              <Link key={cat.to} to={cat.to} className="category-card">
                <strong>{cat.title}</strong>
                <span className="desc">{cat.description}</span>
              </Link>
            ))}
            <div className="category-card" style={{ display: 'block' }}>
              <strong>Automation status</strong>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                <StatusBadge label="Reminders" tone={settings.automations.reminder.config.enabled ? 'success' : 'default'} />
                <StatusBadge label="No-show" tone={settings.automations.noShow.config.enabled ? 'success' : 'default'} />
                <StatusBadge label="Recall" tone={settings.automations.recall.config.enabled ? 'success' : 'default'} />
                <StatusBadge label="Reviews" tone={settings.automations.review.config.enabled ? 'success' : 'default'} />
                <StatusBadge label="Lead ack" tone={settings.automations.leadAck.config.enabled ? 'success' : 'default'} />
                <StatusBadge label="Missed call" tone={settings.automations.missedCall.config.enabled ? 'success' : 'default'} />
              </div>
            </div>
          </div>
        )}
      </SettingsBody>
    </div>
  );
}
