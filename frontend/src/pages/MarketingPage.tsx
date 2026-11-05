import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import logoBlue from '../assets/apex-logo-blue.png';
import leadsShot from '../assets/marketing/leads.png';
import recallShot from '../assets/marketing/recall.png';
import automationsShot from '../assets/marketing/automations.png';
import reviewsShot from '../assets/marketing/reviews.png';
import { apiFetch } from '../lib/api';
import { formatMinor } from '../lib/money';
import { browserLanguages, pickRegion, readStoredRegion, storeRegion } from '../lib/region';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import type { PublicPlan, RegionalPrice } from '../lib/types';
import { LoadingState } from '../components/states';
import { FeatureGrid, FeaturePlayground, VisitorWelcome } from '../components/playground/FeaturePlayground';

function planPrice(plan: PublicPlan, region: RegionalPrice | null): string {
  if (plan.id === 'full' && region !== null) {
    return formatMinor(Number(region.amountMinor), region.currency);
  }
  return formatMinor(plan.priceUsdCents, 'USD');
}

const DIFFERENTIATORS: Array<{ title: string; body: string; image: string; alt: string }> = [
  {
    title: 'Leads',
    body: 'Website enquiries, missed calls, and walk-ins land in one list, with urgency and the next open slot beside the name.',
    image: leadsShot,
    alt: 'Leads page in Dentalistics showing sample enquiries',
  },
  {
    title: 'Recall',
    body: 'Hygiene and treatment follow-ups open on their own after a completed visit and stay visible until the patient rebooks.',
    image: recallShot,
    alt: 'Recall page in Dentalistics showing a sample hygiene recall',
  },
  {
    title: 'Automations',
    body: 'Reminders, no-show recovery, recall, and review requests run on the clinic’s schedule. Staff see what was sent.',
    image: automationsShot,
    alt: 'Automations page in Dentalistics showing reminder, recall, and review jobs',
  },
  {
    title: 'Reviews',
    body: 'Every eligible patient gets the same review request. There is no filter that sends the link only to happy patients.',
    image: reviewsShot,
    alt: 'Review settings in Dentalistics for the post-visit review request',
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
          <Link to="/login" className="btn btn-ghost">
            Sign in
          </Link>
          <Link to="/signup" className="btn btn-primary">
            Start free trial
          </Link>
        </nav>
      </header>

      <section className="marketing-hero">
        <VisitorWelcome />
        <div className="hero-copy">
          <h1>Run your dental clinic from one place</h1>
          <p className="sub">
            Leads, appointments, recalls, and patient messages in a single workspace built for
            dental practices.
          </p>
          <Link to="/signup" className="btn btn-primary">
            Start your free trial
          </Link>
        </div>
        <FeaturePlayground />
      </section>

      <section className="marketing-features" aria-label="Features">
        <h2>Everything your clinic needs</h2>
        <FeatureGrid features={FEATURES} />
      </section>

      <section className="marketing-diff" aria-label="What sets Dentalistics apart">
        <h2>What sets Dentalistics apart</h2>
        <p className="sub">
          Leads, recall, automations, and reviews are the parts clinics usually bolt on later. They are
          in the product from the first day. These are screens from the app, filled with sample records.
        </p>
        <div className="marketing-diff-grid">
          {DIFFERENTIATORS.map((item) => (
            <article className="card marketing-diff-card" key={item.title}>
              <img src={item.image} alt={item.alt} />
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

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
                const local = plan.id === 'full' && selected !== null;
                return (
                  <div className="card marketing-plan" key={plan.id}>
                    <div className="card-title">{plan.name}</div>
                    <div className="marketing-price">
                      {planPrice(plan, local ? selected : null)}
                      {plan.interval === 'month' ? <span>/month</span> : null}
                    </div>
                    <p className="sub">{plan.headline}</p>
                    {local && selected.placeholder ? (
                      <p className="placeholder-note">
                        Placeholder amount — the operator still needs to set this price.
                      </p>
                    ) : null}
                    <Link to="/signup" className="btn btn-primary" style={{ width: '100%' }}>
                      Start free trial
                    </Link>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      <footer className="marketing-footer">
        <span>Apex Dentalistics</span>
        <Link to="/login">Sign in</Link>
      </footer>
    </div>
  );
}
