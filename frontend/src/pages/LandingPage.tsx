import { Navigate } from 'react-router-dom';
import { useAuth, canManageSettings } from '../lib/auth';

export function LandingPage() {
  const { user } = useAuth();
  if (canManageSettings(user)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Navigate to="/workspace" replace />;
}
