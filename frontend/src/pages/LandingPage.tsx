import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { can } from '../lib/capabilities';
import { MarketingPage } from './MarketingPage';
import { LoadingState } from '../components/states';

export function LandingPage() {
  const { status, user } = useAuth();
  if (status === 'loading') {
    return (
      <div className="login-page">
        <LoadingState label="Checking your session…" />
      </div>
    );
  }
  if (status === 'anonymous') {
    return <MarketingPage />;
  }
  if (can(user, 'dashboard.view')) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Navigate to="/workspace" replace />;
}
