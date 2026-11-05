import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import logoBlue from '../assets/apex-logo-blue.png';
import heroClinic from '../assets/marketing/hero-clinic.webp';
import leadsShot from '../assets/marketing/leads.png';
import recallShot from '../assets/marketing/recall.png';
import automationsShot from '../assets/marketing/automations.png';
import reviewsShot from '../assets/marketing/reviews.png';
import { apiFetch } from '../lib/api';
import { fullPlanAmount, priceForVisitor } from '../lib/subscriptionPrice';
import { browserLanguages, pickRegion, readStoredRegion, storeRegion } from '../lib/region';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import type { PublicPlan, RegionalPrice } from '../lib/types';
import { LoadingState } from '../components/states';
import { FeatureGrid, FeaturePlayground, VisitorWelcome } from '../components/playground/FeaturePlayground';

const SHOWCASE: Array<{ title: string; kicker: string; description: string; image: string; imageAlt: string }> = [
  {
    title: 'Lead capture',
    kicker: 'Leads',
    description: 'Website enquiries, manual calls, and patient messages.',
    image: leadsShot,
    imageAlt: 'Leads page in Dentalistics showing sample enquiries',
  },
  {
    title: 'Recall automation',
    kicker: 'Recall',
    description: 'Hygiene and treatment follow-ups open on their own after a visit.',
    image: recallShot,
    imageAlt: 'Recall page in Dentalistics showing a sample hygiene recall',
  },
  {
    title: 'Appointment reminders',
    kicker: 'Automations',
    description: 'Reminders, no-show recovery, recall requests and reviewing.',
    image: automationsShot,
    imageAlt: 'Automations page in Dentalistics showing reminder, recall, and review jobs',
  },
  {
    title: 'Review requests',
    kicker: 'Reviews',
    description: 'Every eligible patient gets the same review request, no filter to happy patients.',
    image: reviewsShot,
    imageAlt: 'Review settings in Dentalistics for the post-visit review request',
  },
];

const FEATURES: Array<{ title: string; description: string }> = [
  {
    title: 'Lead capture',
    description:
      'Website forms, manual entry, missed calls, and webhook sources flow into one pipeline with a complete activity history.',
  },
  {
    title: 'Instant lead acknowledgement',
    description: 'Configurable automated replies go out the moment a new lead arrives.',
  },
  {
    title: 'Missed-call recovery',
    description: 'Missed calls become leads that get an automated response and staff notification.',
  },
  {
    title: 'Appointment management',
    description: 'Appointment list, detail, and calendar views for the whole schedule.',
  },
  {
    title: 'Appointment reminders',
    description:
      'Configurable reminder sequences - 48 hours, 24 hours, and 2 hours before by default - with confirmations and rescheduling.',
  },
  {
    title: 'No-show recovery',
    description:
      'Automated rebooking outreach when a patient misses an appointment, with follow-up until they rebook.',
  },
  {
    title: 'Recall automation',
    description: 'Overdue hygiene, check-up, and treatment follow-up recalls with tracked responses.',
  },
  {
    title: 'Review requests',
    description:
      'Automatic review requests after eligible appointments, respecting consent rules and preventing duplicates.',
  },
  {
    title: 'Receptionist workspace',
    description:
      'New leads, missed calls, patient replies, and upcoming appointments in priority queues.',
  },
  {
    title: 'Communication center',
    description:
      'Messages and patient replies across your configured channels, with delivery tracking.',
  },
  {
    title: 'Owner dashboard',
    description:
      'Leads, bookings, no-shows, recalls, and message delivery, with trends over time.',
  },
  {
    title: 'Templates and settings',
    description:
      'Message templates, clinic profile, business hours, users and roles, and automation configuration.',
  },
];

export function MarketingPage() {
  useDocumentTitle('Dental practice management software');
  const [plans, setPlans] = useState<PublicPlan[] | null>(null);
  const [regions, setRegions] = useState<RegionalPrice[]>([]);
  const [regionCode, setRegionCode] = useState(() => readStoredRegion() ?? '');
  const [plansFailed, setPlansFailed] = useState(false);

  useEffect(() => {
    apiFetch<{ plans: PublicPlan[]; regions?: RegionalPrice[] }>('/api/public/plans')
      .then((res) => {
        setPlans(res.plans);
        const nextRegions = res.regions ?? [];
        setRegions(nextRegions);
        setRegionCode((current) =>
          pickRegion(
            nextRegions.map((region) => region.code),
            browserLanguages(),
            current === '' ? readStoredRegion() : current,
          ),
        );
      })
      .catch(() => setPlansFailed(true));
  }, []);

  function chooseRegion(code: string): void {
    setRegionCode(code);
    storeRegion(code);
  }

  const selected = regions.find((region) => region.code === regionCode) ?? null;

  return (
    <div className="marketing-page">
      <header className="marketing-header">
        <img className="brand-logo" src={logoBlue} alt="Apex Dentalistics" />
        <nav className="marketing-nav">
          <Link to="/login" className="marketing-signin">
            Sign in
          </Link>
          <Link to="/signup" className="btn marketing-cta">
            Start free trial
          </Link>
        </nav>
      </header>

      <section className="marketing-hero">
        <VisitorWelcome />
        <div className="hero-copy">
          <h1>Every front-desk task, solved in one simple workspace.</h1>
          <p className="sub">
            Connect instant automatic replies, appointment booking, and recall reminders into one
            effortless dashboard.
          </p>
          <Link to="/signup" className="btn marketing-cta">
            Start your free trial
          </Link>
        </div>
        <div className="hero-visual">
          <img
            className="hero-photo"
            src={heroClinic}
            alt="A dentist and a dental assistant reviewing a tablet together in a bright clinic"
            width={1280}
            height={720}
            sizes="(max-width: 860px) 100vw, 58vw"
            fetchPriority="high"
            decoding="async"
          />
          <div className="hero-preview">
            <span className="hero-float hero-float-calendar" aria-hidden="true">
              <svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3.5V7M16 3.5V7M4 10h16" /></svg>
            </span>
            <span className="hero-float hero-float-tooth" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M12 3c2.2 0 3.4 1.6 3.6 3.2.2 1.4-.2 2.4.4 3.6.7 1.4 2 2.2 2 4.2 0 2.6-1.6 6-3.2 6-.9 0-1.4-1.2-2.8-1.2S9.1 20 8.2 20C6.6 20 5 16.6 5 14c0-2 1.3-2.8 2-4.2.6-1.2.2-2.2.4-3.6C7.6 4.6 8.8 3 12 3z" /></svg>
            </span>
            <span className="hero-float hero-float-chat" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M5 6h14v9H8l-3 3z" /></svg>
            </span>
            <span className="hero-float hero-float-note" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M6 4h9l4 4v12H6z" /><path d="M14 4v5h5" /></svg>
            </span>
            <FeaturePlayground />
          </div>
        </div>
      </section>

      <section className="marketing-showcase" aria-label="What sets Dentalistics apart">
        <div className="marketing-diff">
          <h2>What sets Dentalistics apart</h2>
          <FeatureGrid features={SHOWCASE} />
        </div>
        <section className="marketing-pricing" aria-label="Pricing">
        <h2>Simple pricing</h2>
        {plansFailed ? (
          <p className="sub">Pricing is unavailable right now. Please try again later.</p>
        ) : plans === null ? (
          <LoadingState label="Loading pricing…" />
        ) : (
          <>
            {regions.length > 0 ? (
              <label className="region-picker">
                Prices for
                <select
                  aria-label="Price region"
                  value={selected?.code ?? regionCode}
                  onChange={(event) => chooseRegion(event.target.value)}
                >
                  {regions.map((region) => (
                    <option key={region.code} value={region.code}>
                      {region.label} ({region.currency})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="card-grid marketing-plans">
              {plans.map((plan) => {
                const shown = plan.id === 'full' ? priceForVisitor(regions, selected?.code ?? regionCode) : null;
                const amount = fullPlanAmount(plan, regions, selected?.code ?? regionCode);
                return (
                  <div className={plan.id === 'full' ? 'card marketing-plan is-featured' : 'card marketing-plan'} key={plan.id}>
                    <div className="card-title">{plan.name}</div>
                    <div className="marketing-price">
                      {amount}
                      {plan.interval === 'month' && amount !== 'Contact us' ? <span>/month</span> : null}
                    </div>
                    <p className="sub">{plan.headline}</p>
                    {plan.limitations ? <p className="sub">{plan.limitations}</p> : null}
                    {plan.bullets !== undefined && plan.bullets.length > 0 ? (
                      <ul>
                        {plan.bullets.map((bullet) => (
                          <li key={bullet}>{bullet}</li>
                        ))}
                      </ul>
                    ) : null}
                    {shown?.placeholder ? (
                      <p className="placeholder-note">
                        Placeholder amount — the operator still needs to set this price.
                      </p>
                    ) : null}
                    <Link to="/signup" className="btn marketing-cta">
                      Start free trial
                    </Link>
                  </div>
                );
              })}
            </div>
          </>
        )}
        </section>
      </section>

      <section className="marketing-features" aria-label="Features">
        <h2>Everything your clinic needs</h2>
        <FeatureGrid features={FEATURES} />
      </section>

      <footer className="marketing-footer">
        <span>Apex Dentalistics</span>
        <Link to="/login">Sign in</Link>
      </footer>
    </div>
  );
}
