import type { ReactNode } from 'react';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  useDocumentTitle(title);
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle ? <div className="page-subtitle">{subtitle}</div> : null}
      </div>
      {actions ? <div>{actions}</div> : null}
    </div>
  );
}
