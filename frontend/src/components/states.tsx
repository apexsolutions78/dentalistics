import { useState } from 'react';
import type { ReactNode } from 'react';

export type BadgeTone = 'default' | 'new' | 'success' | 'warn' | 'danger';

const toneClass: Record<BadgeTone, string> = {
  default: 'badge',
  new: 'badge badge-new',
  success: 'badge badge-success',
  warn: 'badge badge-warn',
  danger: 'badge badge-danger',
};

export function StatusBadge({ label, tone = 'default' }: { label: string; tone?: BadgeTone }) {
  return <span className={toneClass[tone]}>{label}</span>;
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="state-block" role="status">
      <div className="skeleton-stack" aria-hidden="true">
        <span className="skeleton" />
        <span className="skeleton is-short" />
      </div>
      <span className="spinner" aria-hidden="true" /> {label}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  retryLabel = 'Try again',
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="state-block error" role="alert">
      <div className="state-title">Something went wrong</div>
      <div>{message}</div>
      {onRetry ? (
        <div className="btn-row" style={{ justifyContent: 'center' }}>
          <button type="button" className="btn btn-secondary" onClick={onRetry}>
            {retryLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ExamplePeek({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="example-peek">
      <button
        type="button"
        className="btn btn-secondary"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Hide the example' : 'Peek at an example'}
      </button>
      {open ? <div className="example-peek-body">{children}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  heading = false,
  preview,
}: {
  title: string;
  description: string;
  heading?: boolean;
  preview?: ReactNode;
}) {
  return (
    <div className="state-block">
      {heading ? (
        <h1 className="state-title">{title}</h1>
      ) : (
        <div className="state-title">{title}</div>
      )}
      <div>{description}</div>
      {preview != null ? <ExamplePeek>{preview}</ExamplePeek> : null}
    </div>
  );
}
