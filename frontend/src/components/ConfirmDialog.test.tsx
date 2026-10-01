import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialog } from './ConfirmDialog';

function noop(): void {}

describe('ConfirmDialog', () => {
  it('starts with focus on Cancel', () => {
    render(<ConfirmDialog open title="Discard?" body="Unsaved changes." onConfirm={noop} onCancel={noop} />);
    expect(screen.getByRole('dialog', { name: 'Discard?' })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('keeps Tab inside the dialog by wrapping from Cancel to Confirm', () => {
    render(<ConfirmDialog open title="Discard?" body="Unsaved changes." onConfirm={noop} onCancel={noop} />);
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    cancel.focus();
    fireEvent.keyDown(cancel, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Confirm' }));
  });

  it('keeps Shift+Tab inside the dialog by wrapping from Confirm to Cancel', () => {
    render(<ConfirmDialog open title="Discard?" body="Unsaved changes." onConfirm={noop} onCancel={noop} />);
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    confirm.focus();
    fireEvent.keyDown(confirm, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('calls onCancel on Escape and renders nothing when closed', () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <ConfirmDialog open title="Discard?" body="Unsaved changes." onConfirm={noop} onCancel={onCancel} />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    rerender(<ConfirmDialog open={false} title="Discard?" body="Unsaved changes." onConfirm={noop} onCancel={noop} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
