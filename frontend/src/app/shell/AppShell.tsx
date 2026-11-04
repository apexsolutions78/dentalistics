import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import logoWhite from '../../assets/apex-logo-white.png';
import { useAuth } from '../../lib/auth';
import { DRAWER_QUERY } from '../../lib/breakpoints';
import { stampCardTables } from '../../lib/cardTables';
import { useMediaQuery } from '../../lib/useMediaQuery';
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
  const drawer = useMediaQuery(DRAWER_QUERY);
  const [open, setOpen] = useState(false);
  const [trackedPath, setTrackedPath] = useState(location.pathname);
  const [trackedDrawer, setTrackedDrawer] = useState(drawer);
  const navRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const segment = location.pathname.split('/').filter((part) => part !== '')[0] ?? '';
  const title = SECTION_TITLES[segment] ?? 'Home';

  if (location.pathname !== trackedPath) {
    setTrackedPath(location.pathname);
    setOpen(false);
  }
  if (drawer !== trackedDrawer) {
    setTrackedDrawer(drawer);
    if (!drawer) setOpen(false);
  }

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const close = toggleRef.current;
    const first = navRef.current?.querySelector<HTMLElement>('button, a');
    first?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      close?.focus();
    };
  }, [open]);

  useLayoutEffect(() => {
    const root = document.getElementById('main-content');
    if (root === null) return undefined;
    const run = (): void => stampCardTables(root);
    run();
    const observer = new MutationObserver(run);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [location.pathname]);

  const closeMenu = (): void => setOpen(false);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {drawer ? null : (
        <div className="app-brand" data-tour="brand">
          <img className="brand-logo" src={logoWhite} alt="Apex Dentalistics" />
        </div>
      )}
      <header className={drawer ? 'app-header app-header-compact' : 'app-header'}>
        {drawer ? (
          <img className="brand-logo" src={logoWhite} alt="Apex Dentalistics" data-tour="brand" />
        ) : (
          <span className="shell-crumb">{title}</span>
        )}
        {drawer ? (
          <button
            ref={toggleRef}
            type="button"
            className="nav-toggle"
            aria-expanded={open}
            aria-controls="app-nav"
            onClick={() => setOpen((value) => !value)}
          >
            <svg className="nav-toggle-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
            <span className="sr-only">Menu</span>
          </button>
        ) : (
          <AccountMenu />
        )}
      </header>
      <TrialLockBanner />
      {drawer && open ? (
        <div className="nav-backdrop" onClick={closeMenu} />
      ) : null}
      <Sidebar drawer={drawer} open={open} onClose={closeMenu} navRef={navRef} />
      <main className="app-main" id="main-content" data-tour="main" tabIndex={-1}>
        <div key={location.pathname} className="page-stage">
          <Outlet />
        </div>
      </main>
      {user !== null ? <GuidedTour key={user.id} userId={user.id} /> : null}
    </div>
  );
}
