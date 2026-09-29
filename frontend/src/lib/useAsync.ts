import { useCallback, useState } from 'react';
import { errorMessage } from './api';

export function useSubmit(): {
  submit: <T>(fn: () => Promise<T>) => Promise<T | null>;
  saving: boolean;
  error: string | null;
  saved: boolean;
  clearFeedback: () => void;
  setError: (message: string | null) => void;
} {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await fn();
      setSaved(true);
      return result;
    } catch (err) {
      setError(errorMessage(err));
      return null;
    } finally {
      setSaving(false);
    }
  }, []);

  const clearFeedback = useCallback(() => {
    setSaved(false);
    setError(null);
  }, []);

  return { submit, saving, error, saved, clearFeedback, setError };
}
