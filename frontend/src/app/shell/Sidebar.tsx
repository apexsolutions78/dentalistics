import { NavLink } from 'react-router-dom';

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

export function Sidebar({ showSettings }: { showSettings: boolean }) {
  return (
    <nav className="app-sidebar" aria-label="Main navigation">
      {showSettings ? (
        <ul className="nav-list" aria-label="Settings">
          {SETTINGS_LINKS.map((link) => (
            <li key={link.to}>
              <NavLink
                to={link.to}
                end={link.end ?? false}
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              >
                {link.label}
              </NavLink>
            </li>
          ))}
        </ul>
      ) : (
        <p className="nav-empty">No navigation items for your role yet.</p>
      )}
    </nav>
  );
}
