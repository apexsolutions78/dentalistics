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
      <PageHeader title="Home" subtitle="Apex Dentalistics" />
      <EmptyState
        title="No screens for your account yet"
        description="Your role does not have any workspace screens right now. Ask the clinic owner to assign your work or grant access."
      />
    </div>
  );
}
