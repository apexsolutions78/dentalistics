import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { accountIdentity } from '../../lib/accountLabel';
import { useAuth } from '../../lib/auth';

export function AccountMenu() {
  const { user, organization } = useAuth();

  if (user === null) return null;

  const identity = accountIdentity(
    user,
    user.organizationId === null ? null : (organization?.name ?? null),
  );

  return (
    <Link to="/profile" className="drawer-account" data-tour="account">
      <span className="avatar" aria-hidden="true">
        {identity.initial}
      </span>
      <span className="drawer-account-text">
        <span className="drawer-name-row">
          <span className="account-name">{identity.name}</span>
          <span className="drawer-role">{user.role}</span>
        </span>
        <span className="drawer-clinic">{identity.detail}</span>
      </span>
    </Link>
  );
}

export function DrawerSignOut() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const onLogout = async (): Promise<void> => {
    setBusy(true);
    try {
      await logout();
      navigate('/login', { replace: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className="drawer-signout" onClick={() => void onLogout()} disabled={busy}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M10 7V5a2 2 0 0 1 2-2h6v18h-6a2 2 0 0 1-2-2v-2" />
        <path d="M4 12h10M11 8l4 4-4 4" />
      </svg>
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
