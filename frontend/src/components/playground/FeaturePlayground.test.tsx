import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordExplored, readExplored } from './exploreStorage';
import { FeatureGrid, FeaturePlayground, VisitorWelcome } from './FeaturePlayground';

const SAMPLE = [
  { title: 'Lead capture', description: 'Pipeline copy.' },
  { title: 'Missed-call recovery', description: 'Call copy.' },
  { title: 'Recall automation', description: 'Recall copy.' },
];

describe('explore storage', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('records each feature once', () => {
    expect(recordExplored('Lead capture')).toEqual(['Lead capture']);
    expect(recordExplored('Lead capture')).toEqual(['Lead capture']);
    expect(recordExplored('Recall automation')).toEqual(['Lead capture', 'Recall automation']);
    expect(readExplored()).toEqual(['Lead capture', 'Recall automation']);
  });
});

describe('FeaturePlayground', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it('starts on the enquiry and lets a visitor drive the next scene', () => {
    render(<FeaturePlayground />);
    expect(screen.getByRole('tab', { name: '1 · Enquiry', selected: true })).toBeInTheDocument();
    expect(screen.getByText('Samir asked about a cleaning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send the reply' }));
    expect(screen.getByText('The clinic answers in seconds')).toBeInTheDocument();
    expect(screen.getByText('You drove that one.')).toBeInTheDocument();
  });

  it('selects a scene from the keyboard tabs', () => {
    render(<FeaturePlayground />);
    fireEvent.click(screen.getByRole('tab', { name: '3 · Booked' }));
    expect(screen.getByRole('tab', { name: '3 · Booked', selected: true })).toBeInTheDocument();
    expect(screen.getByText('Thursday at 10:30 is held')).toBeInTheDocument();
  });

  it('does not autoplay when motion preference cannot be read', () => {
    vi.useFakeTimers();
    render(<FeaturePlayground />);
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.getByText('Samir asked about a cleaning')).toBeInTheDocument();
    expect(screen.queryByText('The clinic answers in seconds')).not.toBeInTheDocument();
  });
});

describe('VisitorWelcome', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('can be dismissed and stays dismissed for the next visit', () => {
    const view = render(<VisitorWelcome />);
    expect(screen.getByRole('note')).toHaveTextContent('First visit?');
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    view.unmount();
    render(<VisitorWelcome />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});

describe('FeatureGrid', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('reveals a play and rewards the third distinct one', () => {
    render(
      <MemoryRouter>
        <FeatureGrid features={SAMPLE} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Try a 5-second play' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Catch the enquiry' }));
    expect(screen.getByText(/Caught\./)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Try a 5-second play' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Save the missed call' }));

    fireEvent.click(screen.getByRole('button', { name: 'Try a 5-second play' }));
    fireEvent.click(screen.getByRole('button', { name: 'Queue a recall' }));

    expect(screen.getByText(/Three plays in/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a clinic' })).toHaveAttribute('href', '/signup');
  });
});
