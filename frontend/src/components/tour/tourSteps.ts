export interface TourStep {
  id: string;
  target: string;
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    target: 'brand',
    title: 'Welcome aboard',
    body: 'This is your clinic home. Four short tips, then you can wander — every screen stays where you left it.',
  },
  {
    id: 'nav',
    target: 'nav',
    title: 'The front desk',
    body: 'Day-to-day work sits in this menu. Open anything. Empty lists include a peek so the idea is visible before real records exist.',
  },
  {
    id: 'account',
    target: 'account',
    title: 'This chip is you',
    body: 'Your email and role live here, along with the way out of the app when the day is done.',
  },
  {
    id: 'stage',
    target: 'main',
    title: 'The work surface',
    body: 'Lists, calendars, and forms land here. Filters, saves, and messages all behave exactly as they did before this tour.',
  },
];
