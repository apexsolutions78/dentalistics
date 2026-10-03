import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import type { PublicPlan } from '../lib/types';
import { LoadingState } from '../components/states';

function priceLabel(plan: PublicPlan): string {
  const dollars = plan.priceUsdCents / 100;
  const value = Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
  return `$${value}`;
}

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
  const [plansFailed, setPlansFailed] = useState(false);

  useEffect(() => {
    apiFetch<{ plans: PublicPlan[] }>('/api/public/plans')
      .then((res) => setPlans(res.plans))
      .catch(() => setPlansFailed(true));
  }, []);

  return (
    <div className="marketing-page">
      <header className="marketing-header">
        <span className="app-brand">Apex Dentalistics</span>
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
        <h1>Run your dental clinic from one place</h1>
        <p className="sub">
          Leads, appointments, recalls, and patient messages in a single workspace built for
          dental practices.
        </p>
        <Link to="/signup" className="btn btn-primary">
          Start your free trial
        </Link>
      </section>

      <section className="marketing-features" aria-label="Features">
        <h2>Everything your clinic needs</h2>
        <div className="card-grid marketing-feature-grid">
          {FEATURES.map((feature) => (
            <div className="card marketing-feature" key={feature.title}>
              <div className="card-title">{feature.title}</div>
              <p className="sub">{feature.description}</p>
            </div>
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
          <div className="card-grid marketing-plans">
            {plans.map((plan) => (
              <div className="card marketing-plan" key={plan.id}>
                <div className="card-title">{plan.name}</div>
                <div className="marketing-price">
                  {priceLabel(plan)}
                  {plan.interval === 'month' ? <span>/month</span> : null}
                </div>
                <p className="sub">{plan.headline}</p>
                <Link to="/signup" className="btn btn-primary" style={{ width: '100%' }}>
                  Start free trial
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      <footer className="marketing-footer">
        <span>Apex Dentalistics</span>
        <Link to="/login">Sign in</Link>
      </footer>
    </div>
  );
}
