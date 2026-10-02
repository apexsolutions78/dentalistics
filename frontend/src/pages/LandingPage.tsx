import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { can } from '../lib/capabilities';

export function LandingPage() {
  const { user } = useAuth();
  if (can(user, 'dashboard.view')) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Navigate to="/workspace" replace />;
}
