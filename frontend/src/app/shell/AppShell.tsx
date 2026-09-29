import { Outlet } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { canManageSettings } from '../../lib/auth';
import { Sidebar } from './Sidebar';
import { AccountMenu } from './AccountMenu';

export function AppShell() {
  const { user } = useAuth();
  const showSettings = canManageSettings(user);

  return (
    <div className="app-shell">
      <div className="app-brand">Apex Dentalistics</div>
      <header className="app-header">
        <span style={{ fontSize: 'var(--fs-label)', color: 'var(--color-text-secondary)' }}>
          {showSettings ? 'Settings' : 'Practice management'}
        </span>
        <AccountMenu />
      </header>
      <Sidebar showSettings={showSettings} />
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
