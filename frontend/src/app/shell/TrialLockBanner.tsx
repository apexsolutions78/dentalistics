import { useAuth } from '../../lib/auth';
import { trialLocked } from '../../lib/trial';
import { formatDate } from '../../lib/format';

export function TrialLockBanner() {
  const { organization } = useAuth();
  if (organization === null || !trialLocked(organization)) return null;
  return (
    <div className="app-trial-banner" role="status">
      <strong>Free trial ended {formatDate(organization.trialEndsAt)}.</strong> This clinic is now
      read-only. The platform administrator can activate full access.
    </div>
  );
}
