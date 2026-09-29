import type { ReactNode } from 'react';
import { ErrorState, LoadingState } from '../../components/states';
import type { SettingsState } from '../../lib/settings';
import type { Settings } from '../../lib/types';

export function SettingsBody({
  state,
  onRetry,
  children,
}: {
  state: SettingsState;
  onRetry: () => void;
  children: (settings: Settings) => ReactNode;
}) {
  if (state.status === 'loading') {
    return <LoadingState label="Loading settings…" />;
  }
  if (state.status === 'error' || state.settings === null) {
    return <ErrorState message={state.error ?? 'Settings could not be loaded.'} onRetry={onRetry} />;
  }
  return <>{children(state.settings)}</>;
}
