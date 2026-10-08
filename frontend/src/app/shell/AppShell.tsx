import { Outlet, useLocation } from 'react-router-dom';
import logoWhite from '../../assets/apex-logo-white.png';
import { Sidebar } from './Sidebar';
import { AccountMenu } from './AccountMenu';
import { TrialLockBanner } from './TrialLockBanner';

const SECTION_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  workspace: 'Workspace',
  leads: 'Leads',
  patients: 'Patients',
  doctors: 'Doctors',
  appointments: 'Appointments',
  communications: 'Communications',
  recall: 'Recall',
  automations: 'Automations',
  billing: 'Billing',
  settings: 'Settings',
  unauthorized: 'Access denied',
};

export function AppShell() {
  const location = useLocation();
  const segment = location.pathname.split('/').filter((part) => part !== '')[0] ?? '';
  const title = SECTION_TITLES[segment] ?? 'Home';

  return (
    <div className="app-shell">
      <div className="app-brand">
        <img className="brand-logo" src={logoWhite} alt="Apex Dentalistics" />
      </div>
      <header className="app-header">
        <span style={{ fontSize: 'var(--fs-label)', color: 'var(--color-text-secondary)' }}>
          {title}
        </span>
        <AccountMenu />
      </header>
      <TrialLockBanner />
      <Sidebar />
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
