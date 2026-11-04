import { Outlet, useLocation } from 'react-router-dom';
import logoWhite from '../../assets/apex-logo-white.png';
import { useAuth } from '../../lib/auth';
import { GuidedTour } from '../../components/tour/GuidedTour';
import { Sidebar } from './Sidebar';
import { AccountMenu } from './AccountMenu';
import { TrialLockBanner } from './TrialLockBanner';

const SECTION_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  workspace: 'Workspace',
  leads: 'Leads',
  patients: 'Patients',
  'patient-billing': 'Patient billing',
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
  const { user } = useAuth();
  const segment = location.pathname.split('/').filter((part) => part !== '')[0] ?? '';
  const title = SECTION_TITLES[segment] ?? 'Home';

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div className="app-brand" data-tour="brand">
        <img className="brand-logo" src={logoWhite} alt="Apex Dentalistics" />
      </div>
      <header className="app-header">
        <span className="shell-crumb">{title}</span>
        <AccountMenu />
      </header>
      <TrialLockBanner />
      <Sidebar />
      <main className="app-main" id="main-content" data-tour="main" tabIndex={-1}>
        <div key={location.pathname} className="page-stage">
          <Outlet />
        </div>
      </main>
      {user !== null ? <GuidedTour key={user.id} userId={user.id} /> : null}
    </div>
  );
}
