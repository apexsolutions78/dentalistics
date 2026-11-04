import type { ReactNode } from 'react';

export function SampleLine({ children }: { children: ReactNode }) {
  return (
    <p>
      <span className="badge badge-success">Sample</span> Example only — {children} Not saved data.
    </p>
  );
}
