export function Flash({
  kind,
  message,
  onDismiss,
}: {
  kind: 'success' | 'error';
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div
      className={`flash ${kind === 'success' ? 'flash-success' : 'flash-error'}`}
      role={kind === 'error' ? 'alert' : 'status'}
    >
      <span>{message}</span>
      {onDismiss ? (
        <button type="button" className="btn btn-ghost" onClick={onDismiss}>
          Dismiss
        </button>
      ) : null}
    </div>
  );
}
