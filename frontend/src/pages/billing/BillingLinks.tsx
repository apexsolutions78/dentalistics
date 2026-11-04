import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { can } from '../../lib/capabilities';

export function BillingLinks({ current }: { current: 'invoices' | 'expenses' | 'reports' }) {
  const { user } = useAuth();
  const manage = can(user, 'patientBilling.manage');
  const reports = can(user, 'patientBilling.reports');
  return (
    <div className="btn-row">
      <Link className={current === 'invoices' ? 'btn btn-primary' : 'btn btn-secondary'} to="/patient-billing">
        Invoices
      </Link>
      {manage ? (
        <Link
          className={current === 'expenses' ? 'btn btn-primary' : 'btn btn-secondary'}
          to="/patient-billing/expenses"
        >
          Expenses
        </Link>
      ) : null}
      {reports ? (
        <Link
          className={current === 'reports' ? 'btn btn-primary' : 'btn btn-secondary'}
          to="/patient-billing/reports"
        >
          Reports
        </Link>
      ) : null}
    </div>
  );
}
