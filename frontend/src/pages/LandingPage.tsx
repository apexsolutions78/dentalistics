import { Navigate } from 'react-router-dom';
import { useAuth, canManageSettings } from '../lib/auth';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/states';

export function LandingPage() {
  const { user } = useAuth();
  if (canManageSettings(user)) {
    return <Navigate to="/settings" replace />;
  }
  return (
    <div>
      <PageHeader title="Welcome" subtitle="Your workspace" />
      <EmptyState
        title="Workspace screens are not available yet"
        description="Practice workspace screens arrive with a later milestone. Settings screens are available to owners and administrators."
      />
    </div>
  );
}
