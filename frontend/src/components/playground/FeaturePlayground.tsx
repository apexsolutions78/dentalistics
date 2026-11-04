import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { canAutoplay, dismissWelcome, isWelcomeDismissed, readExplored, recordExplored } from './exploreStorage';

export const PLAY_SCENES = [
  {
    id: 'arrive',
    label: '1 · Enquiry',
    kicker: 'A new lead',
    title: 'Samir asked about a cleaning',
    detail: 'The enquiry lands in the pipeline with a phone number and a source, even after hours.',
    chip: 'NEW',
    nudge: 'Send the reply',
  },
  {
    id: 'reply',
    label: '2 · Reply',
    kicker: 'Automatic note',
    title: 'The clinic answers in seconds',
    detail: 'A short acknowledgement goes out while the front desk is still with a patient.',
    chip: 'SENT',
    nudge: 'Hold the time',
  },
  {
    id: 'book',
    label: '3 · Booked',
    kicker: 'On the calendar',
    title: 'Thursday at 10:30 is held',
    detail: 'Reminders queue themselves. Staff step in only when a person needs a person.',
    chip: 'BOOKED',
    nudge: 'Replay from the start',
  },
] as const;

export const FEATURE_PLAYS: Record<string, { prompt: string; action: string; result: string }> = {
  'Lead capture': {
    prompt: 'A website form just arrived after hours.',
    action: 'Catch the enquiry',
    result: 'Caught. It would sit at the top of the pipeline with its source attached.',
  },
  'Instant lead acknowledgement': {
    prompt: 'That enquiry is waiting while someone is with a patient.',
    action: 'Send the automatic note',
    result: 'Sent. The person hears back in seconds, and the thread is kept.',
  },
  'Missed-call recovery': {
    prompt: 'The phone rang through to voicemail.',
    action: 'Save the missed call',
    result: 'Saved as a lead, with a reply ready so the caller is not left hanging.',
  },
  'Appointment management': {
    prompt: 'Thursday morning still has an open chair.',
    action: 'Drop it on the calendar',
    result: 'Booked. The list, the detail, and the calendar would all show the same visit.',
  },
  'Appointment reminders': {
    prompt: 'A visit is two days away.',
    action: 'Queue the reminders',
    result: 'Queued. The 48, 24, and 2 hour notes would go out on their own.',
  },
  'No-show recovery': {
    prompt: 'The 10:30 chair stayed empty.',
    action: 'Start the rebook',
    result: 'Started. Outreach would continue until the visit is rebooked.',
  },
  'Recall automation': {
    prompt: 'A hygiene visit is overdue.',
    action: 'Queue a recall',
    result: 'Queued. The recall would show up for the front desk with the response tracked.',
  },
  'Review requests': {
    prompt: 'A completed visit is eligible for a review.',
    action: 'Ask for the review',
    result: 'Asked once. Consent rules would keep it from being sent twice.',
  },
  'Receptionist workspace': {
    prompt: 'The morning queue is the first thing on the desk.',
    action: 'Open the queue',
    result: 'Opened. New leads, replies, and today\u2019s visits would be waiting in order.',
  },
  'Communication center': {
    prompt: 'A patient just wrote back.',
    action: 'Show the thread',
    result: 'Shown. Delivery and the reply would live on the same conversation.',
  },
  'Owner dashboard': {
    prompt: 'The week\u2019s numbers are in.',
    action: 'Reveal the week',
    result: 'Revealed. Leads, bookings, and delivery would sit on one page with the trend.',
  },
  'Templates and settings': {
    prompt: 'The wording should sound like this clinic.',
    action: 'Preview the wording',
    result: 'Previewed. Templates, hours, and teammates would all be editable later.',
  },
};

export function VisitorWelcome() {
  const [open, setOpen] = useState(() => !isWelcomeDismissed());
  if (!open) return null;
  return (
    <div className="visitor-welcome" role="note">
      <p>
        <strong>First visit?</strong> Play the three scenes — a new enquiry, the automatic reply, then a booking.
      </p>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => {
          dismissWelcome();
          setOpen(false);
        }}
      >
        Got it
      </button>
    </div>
  );
}

export function FeaturePlayground({ compact = false }: { compact?: boolean }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [driven, setDriven] = useState(false);
  const scene = PLAY_SCENES[index] ?? PLAY_SCENES[0];

  useEffect(() => {
    if (paused || !canAutoplay()) return undefined;
    const id = window.setInterval(() => {
      setIndex((current) => (current + 1) % PLAY_SCENES.length);
    }, 4200);
    return () => window.clearInterval(id);
  }, [paused]);

  function choose(next: number) {
    setPaused(true);
    setDriven(true);
    setIndex((next + PLAY_SCENES.length) % PLAY_SCENES.length);
  }

  function onTabsKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    choose(index + delta);
  }

  return (
    <div className={compact ? 'feature-playground is-compact' : 'feature-playground'}>
      <p className="playground-kicker">Interactive preview</p>
      <h2 className="playground-title">{compact ? 'See a morning move' : 'Try a one-minute clinic morning'}</h2>
      <div className="playground-tabs" role="tablist" aria-label="Clinic morning preview" onKeyDown={onTabsKey}>
        {PLAY_SCENES.map((item, itemIndex) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`play-tab-${item.id}`}
            aria-selected={itemIndex === index}
            aria-controls={`play-panel-${item.id}`}
            className={itemIndex === index ? 'playground-tab is-active' : 'playground-tab'}
            onClick={() => choose(itemIndex)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        key={scene.id}
        className="playground-stage"
        role="tabpanel"
        id={`play-panel-${scene.id}`}
        aria-labelledby={`play-tab-${scene.id}`}
      >
        <span className="badge badge-new">{scene.chip}</span>
        <p className="playground-scene-kicker">{scene.kicker}</p>
        <p className="playground-scene-title">{scene.title}</p>
        <p className="playground-scene-detail">{scene.detail}</p>
        <button type="button" className="btn btn-secondary" onClick={() => choose(index + 1)}>
          {scene.nudge}
        </button>
        {driven ? <p className="playground-reward">You drove that one.</p> : null}
      </div>
    </div>
  );
}

export function FeatureGrid({
  features,
}: {
  features: Array<{ title: string; description: string }>;
}) {
  const [found, setFound] = useState(() => readExplored().length);
  return (
    <>
      {found >= 3 ? (
        <p className="explore-reward">
          Three plays in. The live clinic is one signup away.{' '}
          <Link to="/signup">Create a clinic</Link>
        </p>
      ) : null}
      <div className="card-grid marketing-feature-grid">
        {features.map((feature) => {
          const play = FEATURE_PLAYS[feature.title];
          return (
            <FeatureCard
              key={feature.title}
              title={feature.title}
              description={feature.description}
              play={play}
              found={found}
              onPlayed={(count) => setFound(count)}
            />
          );
        })}
      </div>
    </>
  );
}

function FeatureCard({
  title,
  description,
  play,
  found,
  onPlayed,
}: {
  title: string;
  description: string;
  play: { prompt: string; action: string; result: string } | undefined;
  found: number;
  onPlayed: (count: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [played, setPlayed] = useState(false);
  return (
    <article className={open ? 'card marketing-feature is-open' : 'card marketing-feature'}>
      <div className="card-title">{title}</div>
      <p className="sub">{description}</p>
      {play !== undefined ? (
        <div className="feature-peek">
          <button
            type="button"
            className="btn btn-ghost"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? 'Hide this play' : 'Try a 5-second play'}
          </button>
          {open ? (
            <div className="feature-peek-panel">
              <p>{play.prompt}</p>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setPlayed(true);
                  onPlayed(recordExplored(title).length);
                }}
              >
                {play.action}
              </button>
              {played ? <p className="play-result">{play.result}</p> : null}
              {found < 3 ? <p className="play-progress">{found} of 3 plays</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
