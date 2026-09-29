import { Link } from 'react-router-dom';
import { EmptyState } from '../components/states';

export function NotFoundPage() {
  return (
    <div className="center-narrow">
      <EmptyState
        title="Page not found"
        description="The page you are looking for does not exist."
      />
      <p style={{ marginTop: 'var(--space-4)' }}>
        <Link to="/">Back to start</Link>
      </p>
    </div>
  );
}
