import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth, canManageSettings } from '../lib/auth';
import { LoadingState, ErrorState } from '../components/states';
import { UnauthorizedPage } from '../pages/UnauthorizedPage';

export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="login-page">
        <LoadingState label="Checking your session…" />
      </div>
    );
  }
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

export function RequireSettingsRole() {
  const { user } = useAuth();
  if (!canManageSettings(user)) {
    return <UnauthorizedPage />;
  }
  return <Outlet />;
}

export function SessionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="login-page">
      <ErrorState message={message} onRetry={onRetry} />
    </div>
  );
}
