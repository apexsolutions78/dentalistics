import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { AccountMenu } from './AccountMenu';

const SECTION_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  workspace: 'Workspace',
  leads: 'Leads',
  patients: 'Patients',
  appointments: 'Appointments',
  communications: 'Communications',
  recall: 'Recall',
  automations: 'Automations',
  settings: 'Settings',
  unauthorized: 'Access denied',
};

export function AppShell() {
  const location = useLocation();
  const segment = location.pathname.split('/').filter((part) => part !== '')[0] ?? '';
  const title = SECTION_TITLES[segment] ?? 'Home';

  return (
    <div className="app-shell">
      <div className="app-brand">Apex Dentalistics</div>
      <header className="app-header">
        <span style={{ fontSize: 'var(--fs-label)', color: 'var(--color-text-secondary)' }}>
          {title}
        </span>
        <AccountMenu />
      </header>
      <Sidebar />
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
