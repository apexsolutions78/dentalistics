import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { EmptyState } from '../components/states';

export function NotFoundPage() {
  useDocumentTitle('Page not found');
  return (
    <div className="center-narrow">
      <EmptyState
        heading
        title="Page not found"
        description="The page you are looking for does not exist."
      />
      <p style={{ marginTop: 'var(--space-4)' }}>
        <Link to="/">Back to start</Link>
      </p>
    </div>
  );
}
