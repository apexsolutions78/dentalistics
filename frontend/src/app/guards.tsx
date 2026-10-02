import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { can, type Capability } from '../lib/capabilities';
import { LoadingState } from '../components/states';
import { UnauthorizedPage } from '../pages/UnauthorizedPage';

export function RequireAuth() {
  const { status, sessionExpired } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="login-page">
        <LoadingState label="Checking your session…" />
      </div>
    );
  }
  if (status === 'anonymous') {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname, sessionExpired }}
      />
    );
  }
  return <Outlet />;
}

export function RequireCapability({ capability }: { capability: Capability }) {
  const { user } = useAuth();
  if (!can(user, capability)) {
    return <UnauthorizedPage />;
  }
  return <Outlet />;
}
