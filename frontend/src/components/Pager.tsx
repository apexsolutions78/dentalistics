export function Pager({
  total,
  limit,
  offset,
  onOffset,
}: {
  total: number;
  limit: number;
  offset: number;
  onOffset: (offset: number) => void;
}) {
  if (total <= limit) {
    return (
      <div className="pager" style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--fs-label)' }}>
        {total === 0 ? '0 results' : `${total} result${total === 1 ? '' : 's'}`}
      </div>
    );
  }
  const start = offset + 1;
  const end = Math.min(offset + limit, total);
  return (
    <div className="pager" style={{ display: 'flex', gap: 'var(--space-2, 8px)', alignItems: 'center' }}>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={offset === 0}
        onClick={() => onOffset(Math.max(0, offset - limit))}
      >
        Previous
      </button>
      <span aria-live="polite" style={{ fontSize: 'var(--fs-label)', color: 'var(--color-text-secondary)' }}>
        {start}–{end} of {total}
      </span>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={end >= total}
        onClick={() => onOffset(offset + limit)}
      >
        Next
      </button>
    </div>
  );
}
