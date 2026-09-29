import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { StatusBadge } from '../../components/states';

export function AccountMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  if (user === null) return null;

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
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
      <span style={{ fontSize: 'var(--fs-label)' }}>{user.email}</span>
      <StatusBadge
        label={user.role}
        tone={user.role === 'owner' ? 'new' : user.role === 'admin' ? 'success' : 'default'}
      />
      <button type="button" className="btn btn-ghost" onClick={() => void onLogout()} disabled={busy}>
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  );
}
