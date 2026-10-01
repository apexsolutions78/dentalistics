import { NavLink, useLocation } from 'react-router-dom';
import { canManageSettings, useAuth } from '../../lib/auth';

const PRIMARY_LINKS: Array<{ to: string; label: string; end?: boolean }> = [
  { to: '/workspace', label: 'Workspace', end: true },
  { to: '/leads', label: 'Leads' },
  { to: '/patients', label: 'Patients' },
  { to: '/appointments', label: 'Appointments' },
  { to: '/communications', label: 'Communications' },
  { to: '/recall', label: 'Recall' },
];

const MANAGER_LINKS: Array<{ to: string; label: string; end?: boolean }> = [
  { to: '/dashboard', label: 'Dashboard', end: true },
  { to: '/automations', label: 'Automations', end: true },
  { to: '/settings', label: 'Settings', end: true },
];

const SETTINGS_LINKS: Array<{ to: string; label: string; end?: boolean }> = [
  { to: '/settings', label: 'Overview', end: true },
  { to: '/settings/clinic', label: 'Clinic' },
  { to: '/settings/users', label: 'Users & roles' },
  { to: '/settings/communication', label: 'Communication' },
  { to: '/settings/templates', label: 'Templates' },
  { to: '/settings/appointments', label: 'Appointments & reminders' },
  { to: '/settings/recall', label: 'Recall' },
  { to: '/settings/reviews', label: 'Reviews' },
  { to: '/settings/automation', label: 'Automation' },
];

function NavLinkItem({ link }: { link: { to: string; label: string; end?: boolean } }) {
  return (
    <li>
      <NavLink
        to={link.to}
        end={link.end ?? false}
        className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
      >
        {link.label}
      </NavLink>
    </li>
  );
}

export function Sidebar() {
  const { user } = useAuth();
  const isManager = canManageSettings(user);
  const location = useLocation();
  const inSettings = location.pathname.startsWith('/settings');

  return (
    <nav className="app-sidebar" aria-label="Main navigation">
      <ul className="nav-list" aria-label="Clinic">
        {PRIMARY_LINKS.map((link) => (
          <NavLinkItem key={link.to} link={link} />
        ))}
      </ul>
      {isManager ? (
        <ul className="nav-list" aria-label="Management" style={{ marginTop: '16px' }}>
          {MANAGER_LINKS.map((link) => (
            <NavLinkItem key={link.to} link={link} />
          ))}
        </ul>
      ) : null}
      {isManager && inSettings ? (
        <ul className="nav-list" aria-label="Settings sections" style={{ marginTop: '16px' }}>
          {SETTINGS_LINKS.map((link) => (
            <NavLinkItem key={link.to} link={link} />
          ))}
        </ul>
      ) : null}
    </nav>
  );
}
