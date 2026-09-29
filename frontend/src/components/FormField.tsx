import { Children, cloneElement, isValidElement, useId } from 'react';
import type { ReactElement, ReactNode } from 'react';

export function FormField({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
}) {
  const generatedId = useId();
  const id = htmlFor ?? generatedId;
  const only = Children.only(children);
  const control = isValidElement(only)
    ? cloneElement(only as ReactElement<{ id?: string }>, { id })
    : only;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {control}
      {hint ? <span className="hint">{hint}</span> : null}
      {error ? <span className="error">{error}</span> : null}
    </div>
  );
}
