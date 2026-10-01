import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Link, useLocation } from 'react-router-dom';
import { useUnsavedChanges } from './useUnsavedChanges';

afterEach(() => {
  vi.restoreAllMocks();
});

function Home({ dirty }: { dirty: boolean }) {
  useUnsavedChanges(dirty);
  const location = useLocation();
  return (
    <div>
      <span data-testid="path">{location.pathname}</span>
      <Link to="/other">Leave</Link>
    </div>
  );
}

function Other() {
  return <div>Other page</div>;
}

function renderHome(dirty: boolean): void {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Home dirty={dirty} />} />
        <Route path="/other" element={<Other />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('useUnsavedChanges', () => {
  it('blocks internal navigation while dirty when the user cancels', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderHome(true);
    fireEvent.click(screen.getByRole('link', { name: 'Leave' }));
    expect(confirm).toHaveBeenCalledWith('You have unsaved changes. Leave this page?');
    expect(screen.getByTestId('path')).toHaveTextContent('/');
    expect(screen.queryByText('Other page')).not.toBeInTheDocument();
  });

  it('navigates after the user confirms leaving', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderHome(true);
    fireEvent.click(screen.getByRole('link', { name: 'Leave' }));
    expect(screen.getByText('Other page')).toBeInTheDocument();
  });

  it('navigates without prompting when nothing is unsaved', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderHome(false);
    fireEvent.click(screen.getByRole('link', { name: 'Leave' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByText('Other page')).toBeInTheDocument();
  });
});
