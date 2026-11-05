import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { can } from '../../lib/capabilities';
import { AccountMenu, DrawerSignOut } from './AccountMenu';

const PRIMARY_LINKS: Array<{ to: string; label: string; end?: boolean }> = [
  { to: '/workspace', label: 'Workspace', end: true },
  { to: '/leads', label: 'Leads' },
  { to: '/patients', label: 'Patients' },
  { to: '/patient-billing', label: 'Patient billing' },
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
  { to: '/settings/billing', label: 'Billing' },
];

function NavGlyph({ label }: { label: string }) {
  return (
    <svg className="nav-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <GlyphShape label={label} />
    </svg>
  );
}

function GlyphShape({ label }: { label: string }) {
  switch (label) {
    case 'Workspace':
      return (
        <>
          <rect x="4" y="4" width="7" height="7" rx="1.5" />
          <rect x="13" y="4" width="7" height="7" rx="1.5" />
          <rect x="4" y="13" width="7" height="7" rx="1.5" />
          <rect x="13" y="13" width="7" height="7" rx="1.5" />
        </>
      );
    case 'Leads':
      return (
        <>
          <circle cx="12" cy="8" r="3" />
          <path d="M6 19c1.2-3 3.2-4.5 6-4.5S16.8 16 18 19" />
        </>
      );
    case 'Patients':
      return <path d="M12 19s-6-3.6-6-8a3.4 3.4 0 0 1 6-1.6A3.4 3.4 0 0 1 18 11c0 4.4-6 8-6 8z" />;
    case 'Appointments':
    case 'Appointments & reminders':
      return (
        <>
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path d="M8 3.5V7M16 3.5V7M4 10h16" />
        </>
      );
    case 'Communications':
    case 'Communication':
      return <path d="M5 6h14v9H8l-3 3z" />;
    case 'Recall':
      return (
        <>
          <path d="M6 16V9a6 6 0 0 1 12 0v7" />
          <path d="M5 16h14M10 19a2 2 0 0 0 4 0" />
        </>
      );
    case 'Doctors':
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v8M8 12h8" />
        </>
      );
    case 'Dashboard':
      return <path d="M4 16V9m6 7V5m6 11v-4m4 4V8" />;
    case 'Automations':
    case 'Automation':
      return <path d="M13 3 6 13h5l-1 8 8-12h-5z" />;
    case 'Settings':
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18" />
        </>
      );
    case 'Overview':
      return <path d="M4 11.5 12 5l8 6.5V20H4z" />;
    case 'Clinic':
      return <path d="M4 20V8l8-4 8 4v12M9 20v-5h6v5" />;
    case 'Users & roles':
      return (
        <>
          <circle cx="9" cy="9" r="2.4" />
          <circle cx="16" cy="10" r="2" />
          <path d="M4.5 18c.8-2.4 2.4-3.5 4.5-3.5s3.7 1.1 4.5 3.5M14 14.6c1.4-.3 2.6.1 3.6 1.4.6.8 1 1.5 1.2 2" />
        </>
      );
    case 'Templates':
      return <path d="M7 3.5h7l4 4V20H7zM14 3.5V8h4" />;
    case 'Reviews':
      return <path d="m12 4 2 4.2 4.6.6-3.4 3.2.8 4.6L12 14.4 7.9 16.6l.8-4.6L5.4 8.8 10 8.2z" />;
    case 'Billing':
    case 'Patient billing':
    case 'Payments':
      return (
        <>
          <rect x="3.5" y="6" width="17" height="12" rx="2" />
          <path d="M3.5 10h17" />
        </>
      );
    case 'Trials':
      return <path d="M6 4h12v16l-6-3-6 3z" />;
    default:
      return <circle cx="12" cy="12" r="3" />;
  }
}

function NavLinkItem({ link }: { link: { to: string; label: string; end?: boolean } }) {
  return (
    <li>
      <NavLink
        to={link.to}
        end={link.end ?? false}
        className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
      >
        <NavGlyph label={link.label} />
        <span>{link.label}</span>
      </NavLink>
    </li>
  );
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableItems(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1,
  );
}

export function Sidebar({
  drawer,
  open,
  onClose,
  navRef,
}: {
  drawer: boolean;
  open: boolean;
  onClose: () => void;
  navRef: RefObject<HTMLElement | null>;
}) {
  const { user } = useAuth();
  const hasClinic = (user?.organizationId ?? null) !== null;
  const showManagement = hasClinic && can(user, 'dashboard.view');
  const showSettingsSections = hasClinic && can(user, 'settings.view');
  const showTrials = can(user, 'admin.trials.view');
  const showDoctors = can(user, 'doctors.view');
  const showPatientBilling = can(user, 'patientBilling.view');
  const location = useLocation();
  const inSettings = location.pathname.startsWith('/settings');

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (!drawer || !open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const root = navRef.current;
    if (root === null) return;
    const items = focusableItems(root);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (first === undefined || last === undefined) return;
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || active === null || !root.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || active === null || !root.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  };

  const className = drawer
    ? open
      ? 'app-sidebar is-drawer is-open'
      : 'app-sidebar is-drawer'
    : 'app-sidebar';

  return (
    <nav
      ref={navRef}
      id="app-nav"
      className={className}
      aria-label="Main navigation"
      aria-modal={drawer && open ? true : undefined}
      aria-hidden={drawer && !open ? true : undefined}
      inert={drawer && !open ? true : undefined}
      data-tour="nav"
      onKeyDown={onKeyDown}
    >
      {drawer ? (
        <div className="nav-drawer-bar">
          <p className="nav-label">Menu</p>
          <button type="button" className="nav-drawer-close" aria-label="Close menu" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      ) : null}
      <AccountMenu placement="drawer" />
      <div className="sidebar-scroll">
      {hasClinic ? (
      <div className="nav-group">
        <p className="nav-label">Today</p>
        <ul className="nav-list" aria-label="Clinic">
          {PRIMARY_LINKS.filter((link) => link.to !== '/patient-billing' || showPatientBilling).map((link) => (
            <NavLinkItem key={link.to} link={link} />
          ))}
          {showDoctors ? <NavLinkItem link={{ to: '/doctors', label: 'Doctors' }} /> : null}
        </ul>
      </div>
      ) : null}
      {showManagement ? (
        <div className="nav-group">
          <p className="nav-label">Oversight</p>
          <ul className="nav-list" aria-label="Management">
            {MANAGER_LINKS.map((link) => (
              <NavLinkItem key={link.to} link={link} />
            ))}
          </ul>
        </div>
      ) : null}
      {showTrials ? (
        <div className="nav-group">
          <p className="nav-label">Platform</p>
          <ul className="nav-list" aria-label="Platform">
            <NavLinkItem link={{ to: '/admin/trials', label: 'Trials' }} />
            {can(user, 'admin.payments.view') ? (
              <NavLinkItem link={{ to: '/admin/payments', label: 'Payments' }} />
            ) : null}
            {can(user, 'admin.payments.view') ? (
              <NavLinkItem link={{ to: '/admin/pricing', label: 'Pricing' }} />
            ) : null}
            {can(user, 'admin.payments.view') ? (
              <NavLinkItem link={{ to: '/admin/manual-payments', label: 'Manual payments' }} />
            ) : null}
            {can(user, 'admin.payments.view') ? (
              <NavLinkItem link={{ to: '/admin/setup-help', label: 'Setup help' }} />
            ) : null}
          </ul>
        </div>
      ) : null}
      {showSettingsSections && inSettings ? (
        <div className="nav-group">
          <p className="nav-label">Fine tuning</p>
          <ul className="nav-list" aria-label="Settings sections">
            {SETTINGS_LINKS.map((link) => (
              <NavLinkItem key={link.to} link={link} />
            ))}
          </ul>
        </div>
      ) : null}
      </div>
      <DrawerSignOut />
    </nav>
  );
}
