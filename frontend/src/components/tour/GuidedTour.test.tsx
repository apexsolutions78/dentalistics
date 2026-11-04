import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GuidedTour } from './GuidedTour';
import { readTourStatus } from './tourStorage';

function installMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

describe('GuidedTour', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    localStorage.clear();
    Reflect.deleteProperty(window, 'matchMedia');
  });

  function renderTour(userId = 4) {
    return render(
      <div>
        <div data-tour="brand">Brand</div>
        <div data-tour="nav">Menu</div>
        <div data-tour="account">Account</div>
        <div data-tour="main">Main</div>
        <GuidedTour userId={userId} />
      </div>,
    );
  }

  it('shows the first tip for a user who has not seen it', () => {
    renderTour();
    expect(screen.getByRole('dialog', { name: 'Welcome aboard' })).toBeInTheDocument();
    expect(screen.getByText('Tip 1 of 4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous tip' })).toBeDisabled();
  });

  it('moves forward and back between tips', () => {
    renderTour();
    fireEvent.click(screen.getByRole('button', { name: 'Next tip' }));
    expect(screen.getByRole('heading', { name: 'The front desk' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous tip' }));
    expect(screen.getByRole('heading', { name: 'Welcome aboard' })).toBeInTheDocument();
  });

  it('advances with the right arrow and returns with the left arrow', () => {
    renderTour();
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(screen.getByRole('heading', { name: 'The front desk' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowLeft' });
    expect(screen.getByRole('heading', { name: 'Welcome aboard' })).toBeInTheDocument();
  });

  it('skips with the button and remembers that user', () => {
    const view = renderTour(4);
    fireEvent.click(screen.getByRole('button', { name: 'Skip the tour' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(readTourStatus(4)).toBe('skipped');
    view.rerender(
      <div>
        <GuidedTour userId={4} />
      </div>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the tour again for a different user', () => {
    const view = renderTour(4);
    fireEvent.click(screen.getByRole('button', { name: 'Skip the tour' }));
    view.rerender(
      <div>
        <GuidedTour key={8} userId={8} />
      </div>,
    );
    expect(screen.getByRole('dialog', { name: 'Welcome aboard' })).toBeInTheDocument();
  });

  it('finishes on the last tip and does not return for that user', () => {
    renderTour(4);
    fireEvent.click(screen.getByRole('button', { name: 'Next tip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next tip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next tip' }));
    expect(screen.getByRole('heading', { name: 'The work surface' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Finish tour' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(readTourStatus(4)).toBe('done');
    render(<GuidedTour userId={4} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('skips when Escape is pressed', () => {
    renderTour(4);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(readTourStatus(4)).toBe('skipped');
  });

  it('marks itself static when reduced motion is requested', () => {
    installMatchMedia(true);
    renderTour();
    expect(document.querySelector('.tour-static')).not.toBeNull();
  });
});
