import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import { PUBLIC_ACTIVITY_POLL_MS, parsePublicActivity } from './publicActivity';
import type { PublicActivityEvent } from './publicActivity';

export type PublicActivityStatus = 'loading' | 'ready' | 'empty' | 'error';

export function usePublicActivity(): {
  status: PublicActivityStatus;
  events: PublicActivityEvent[];
} {
  const [status, setStatus] = useState<PublicActivityStatus>('loading');
  const [events, setEvents] = useState<PublicActivityEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async (): Promise<void> => {
      try {
        const payload = await apiFetch<unknown>('/api/public/activity');
        if (cancelled) return;
        const next = parsePublicActivity(payload);
        setEvents(next);
        setStatus(next.length === 0 ? 'empty' : 'ready');
      } catch {
        if (cancelled) return;
        setStatus((current) => (current === 'ready' ? 'ready' : 'error'));
      }
    };

    const clearTimer = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    const arm = (): void => {
      clearTimer();
      timer = setTimeout(() => {
        timer = undefined;
        if (cancelled) return;
        if (document.visibilityState === 'hidden') {
          arm();
          return;
        }
        void load().finally(() => {
          if (!cancelled) arm();
        });
      }, PUBLIC_ACTIVITY_POLL_MS);
    };

    const kick = (): void => {
      clearTimer();
      if (document.visibilityState === 'hidden') {
        arm();
        return;
      }
      void load().finally(() => {
        if (!cancelled) arm();
      });
    };

    const onVisibility = (): void => {
      if (cancelled || document.visibilityState !== 'visible') return;
      kick();
    };

    kick();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return { status, events };
}
