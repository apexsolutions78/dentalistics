import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { TOUR_STEPS } from './tourSteps';
import { readTourStatus, writeTourStatus, type TourStatus } from './tourStorage';

interface SpotBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function GuidedTour({ userId }: { userId: number }) {
  const [closed, setClosed] = useState(() => readTourStatus(userId) !== null);
  const [step, setStep] = useState(0);
  const [box, setBox] = useState<SpotBox | null>(null);
  const [reduced, setReduced] = useState(false);
  const skipRef = useRef<HTMLButtonElement>(null);

  const finish = useCallback(
    (status: TourStatus) => {
      writeTourStatus(userId, status);
      setClosed(true);
    },
    [userId],
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, []);

  useEffect(() => {
    if (closed) return undefined;
    const active = document.activeElement;
    const idle =
      active === null || active === document.body || active === document.documentElement;
    if (idle) skipRef.current?.focus();
    return undefined;
  }, [closed]);

  useEffect(() => {
    if (closed) return undefined;
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('[role="dialog"]') !== null &&
        target.closest('.tour-card') === null
      ) {
        return;
      }
      finish('skipped');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closed, finish]);

  useLayoutEffect(() => {
    if (closed) return undefined;
    const current = TOUR_STEPS[step];
    if (current === undefined) return undefined;
    let frame = 0;
    const measure = () => {
      const el = document.querySelector(`[data-tour="${current.target}"]`);
      if (!(el instanceof HTMLElement)) {
        setBox(null);
        return;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setBox(null);
        return;
      }
      setBox({
        top: Math.max(8, rect.top - 8),
        left: Math.max(8, rect.left - 8),
        width: rect.width + 16,
        height: rect.height + 16,
      });
    };
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };
    schedule();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [closed, step]);

  if (closed) return null;
  const current = TOUR_STEPS[step];
  if (current === undefined) return null;
  const last = step === TOUR_STEPS.length - 1;

  function onCardKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      finish('skipped');
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (last) finish('done');
      else setStep((value) => value + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setStep((value) => Math.max(0, value - 1));
    }
  }

  return (
    <div className={reduced || prefersReducedMotion() ? 'tour-layer tour-static' : 'tour-layer'}>
      {box !== null ? (
        <div
          className="tour-spot"
          style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
          aria-hidden="true"
        />
      ) : null}
      <div
        className="tour-card"
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        onKeyDown={onCardKey}
      >
        <p className="tour-kicker">
          Tip {step + 1} of {TOUR_STEPS.length}
        </p>
        <h2 id="tour-title" className="tour-title">
          {current.title}
        </h2>
        <p id="tour-body" className="tour-body">
          {current.body}
        </p>
        <div className="tour-actions">
          <button
            ref={skipRef}
            type="button"
            className="btn btn-ghost"
            onClick={() => finish('skipped')}
          >
            Skip the tour
          </button>
          <span className="tour-nav">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setStep((value) => Math.max(0, value - 1))}
              disabled={step === 0}
            >
              Previous tip
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (last) finish('done');
                else setStep((value) => value + 1);
              }}
            >
              {last ? 'Finish tour' : 'Next tip'}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
