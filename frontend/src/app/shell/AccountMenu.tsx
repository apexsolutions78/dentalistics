import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { StatusBadge } from '../../components/states';

export function AccountMenu({ placement = 'header' }: { placement?: 'header' | 'drawer' }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  if (user === null) return null;

  if (placement === 'drawer') {
    return (
      <div className="drawer-account" data-tour="account">
        <span className="avatar" aria-hidden="true">
          {user.email.slice(0, 1).toUpperCase()}
        </span>
        <span className="drawer-account-text">
          <span className="account-email">{user.email}</span>
          <span className="drawer-role">{user.role}</span>
        </span>
      </div>
    );
  }

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
    <div className="account-menu" data-tour="account">
      <span className="avatar" aria-hidden="true">
        {user.email.slice(0, 1).toUpperCase()}
      </span>
      <span className="account-email">{user.email}</span>
      <StatusBadge
        label={user.role}
        tone={user.role === 'owner' ? 'new' : user.role === 'admin' ? 'success' : 'default'}
      />
      <button
        type="button"
        className="account-signout"
        aria-label={busy ? 'Signing out' : 'Sign out'}
        onClick={() => void onLogout()}
        disabled={busy}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M10 7V5a2 2 0 0 1 2-2h6v18h-6a2 2 0 0 1-2-2v-2" />
          <path d="M4 12h10M11 8l4 4-4 4" />
        </svg>
      </button>
    </div>
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
