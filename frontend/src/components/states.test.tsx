import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState, LoadingState } from './states';

describe('LoadingState', () => {
  it('keeps the status label and adds a non-text skeleton', () => {
    render(<LoadingState label="Loading leads…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading leads…');
    expect(document.querySelector('.skeleton')).not.toBeNull();
  });
});

describe('EmptyState', () => {
  it('renders the title and description without a peek when none is provided', () => {
    render(<EmptyState title="No leads found" description="New website enquiries will appear here." />);
    expect(screen.getByText('No leads found')).toBeInTheDocument();
    expect(screen.getByText('New website enquiries will appear here.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Peek at an example' })).not.toBeInTheDocument();
  });

  it('opens and closes an example without replacing the empty copy', () => {
    render(
      <EmptyState
        title="No appointments found"
        description="Book the first appointment to see it here."
        preview={<p>Example only — a Thursday cleaning.</p>}
      />,
    );
    expect(screen.queryByText(/Example only/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Peek at an example' }));
    expect(screen.getByText('No appointments found')).toBeInTheDocument();
    expect(screen.getByText(/Example only/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide the example' }));
    expect(screen.queryByText(/Example only/)).not.toBeInTheDocument();
  });
});
