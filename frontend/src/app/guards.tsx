import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { can, type Capability } from '../lib/capabilities';
import { EmptyState, LoadingState } from '../components/states';
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

export function RequireClinic() {
  const { user } = useAuth();
  if ((user?.organizationId ?? null) === null) {
    return (
      <div className="center-narrow">
        <EmptyState
          heading
          title="No clinic linked to this account"
          description="This account is not attached to a clinic, so clinic screens are unavailable. Sign in with a clinic owner or receptionist account, or ask an administrator to attach this account to a clinic."
        />
      </div>
    );
  }
  return <Outlet />;
}

export function RequireOnboarding() {
  const { organization } = useAuth();
  if (organization !== null && organization.onboardingCompletedAt === null) {
    return <Navigate to="/onboarding" replace />;
  }
  return <Outlet />;
}
