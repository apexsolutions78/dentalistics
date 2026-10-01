import { Children, cloneElement, isValidElement, useId } from 'react';
import type { ReactElement, ReactNode } from 'react';

export function FormField({
  label,
  hint,
  error,
  required = false,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  htmlFor?: string;
}) {
  const generatedId = useId();
  const id = htmlFor ?? generatedId;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const only = Children.only(children);
  const isLabelChild = isValidElement(only) && only.type === 'label';
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  const control =
    isValidElement(only) && !isLabelChild
      ? cloneElement(only as ReactElement<Record<string, unknown>>, {
          id,
          'aria-invalid': error ? true : undefined,
          'aria-describedby': describedBy,
          ...(required ? { required: true } : {}),
        })
      : only;
  return (
    <div className="field">
      {isLabelChild ? (
        <span className="group-label">{label}</span>
      ) : (
        <label htmlFor={id}>
          {label}
          {required ? ' *' : ''}
        </label>
      )}
      {control}
      {hint ? (
        <span className="hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
