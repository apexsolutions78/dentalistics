import { Link } from 'react-router-dom';
import { EmptyState } from '../components/states';

export function UnauthorizedPage() {
  return (
    <div className="center-narrow">
      <EmptyState
        heading
        title="Access denied"
        description="Your role does not have permission to view settings. Contact your clinic owner if you believe this is a mistake."
      />
      <p style={{ marginTop: 'var(--space-4)' }}>
        <Link to="/">Back to start</Link>
      </p>
    </div>
  );
}
