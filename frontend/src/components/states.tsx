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

export function EmptyState({
  title,
  description,
  heading = false,
}: {
  title: string;
  description: string;
  heading?: boolean;
}) {
  return (
    <div className="state-block">
      {heading ? (
        <h1 className="state-title">{title}</h1>
      ) : (
        <div className="state-title">{title}</div>
      )}
      <div>{description}</div>
    </div>
  );
}
