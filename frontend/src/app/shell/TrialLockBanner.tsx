import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { clinicReadOnly, trialLocked } from '../../lib/trial';
import { formatDate, formatDateTime } from '../../lib/format';

export function TrialLockBanner() {
  const { organization } = useAuth();
  if (organization === null || !clinicReadOnly(organization)) return null;
  if (trialLocked(organization)) {
    return (
      <div className="app-trial-banner" role="status">
        <strong>Free trial ended {formatDate(organization.trialEndsAt)}.</strong> This clinic is now
        read-only. The platform administrator can activate full access.
      </div>
    );
  }
  return (
    <div className="app-trial-banner" role="status">
      <strong>Subscription ended {formatDateTime(organization.paidUntil)}.</strong> This clinic is
      read-only until it is renewed. Existing records stay available.{' '}
      <Link to="/settings/billing">Open billing</Link>
    </div>
  );
}
