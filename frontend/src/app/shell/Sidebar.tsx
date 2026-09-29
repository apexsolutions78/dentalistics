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

const PLANNED_LINKS: Array<{ label: string; milestone: string }> = [
  { label: 'Dashboard', milestone: 'M20' },
  { label: 'Workspace', milestone: 'M21' },
  { label: 'Leads', milestone: 'M21' },
  { label: 'Appointments', milestone: 'M19' },
  { label: 'Patients', milestone: 'M19' },
  { label: 'Reports', milestone: 'M20' },
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
      ) : null}

      <div className="nav-item-disabled" style={{ marginTop: 'var(--space-3)', fontWeight: 600 }}>
        Practice
      </div>
      <ul className="nav-list" aria-label="Planned screens">
        {PLANNED_LINKS.map((link) => (
          <li key={link.label} className="nav-item-disabled">
            <span>{link.label}</span>
            <span className="planned">Planned {link.milestone}</span>
          </li>
        ))}
      </ul>
    </nav>
  );
}
