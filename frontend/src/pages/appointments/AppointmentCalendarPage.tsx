import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/useApi';
import type { Appointment, Paged } from '../../lib/types';
import { formatTime, fullName } from '../../lib/format';
import { PageHeader } from '../../components/PageHeader';
import { ErrorState, LoadingState, EmptyState, StatusBadge } from '../../components/states';
import { statusTone } from './AppointmentsPage';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const RANGE_LIMIT = 100;
const MAX_PER_CELL = 3;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function firstWeekday(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

export function AppointmentCalendarPage() {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? null;

  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selected, setSelected] = useState(() => {
    const now = new Date();
    return dateKey(now.getFullYear(), now.getMonth(), now.getDate());
  });

  const todayKey = useMemo(() => {
    const now = new Date();
    return dateKey(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);

  const from = dateKey(cursor.year, cursor.month, 1);
  const to = dateKey(cursor.year, cursor.month, daysInMonth(cursor.year, cursor.month));
  const path =
    orgId === null
      ? null
      : `/api/organizations/${orgId}/appointments?from=${from}&to=${to}&limit=${RANGE_LIMIT}`;
  const { status, data, error, reload } = useApi<Paged & { appointments: Appointment[] }>(path);

  const byDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const appointment of data?.appointments ?? []) {
      const key = String(appointment.date).slice(0, 10);
      const list = map.get(key) ?? [];
      list.push(appointment);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.time.localeCompare(b.time));
    }
    return map;
  }, [data]);

  const selectedAppointments = byDay.get(selected) ?? [];

  const moveTo = (year: number, month: number): void => {
    setCursor({ year, month });
    const now = new Date();
    const sameMonth = now.getFullYear() === year && now.getMonth() === month;
    setSelected(
      sameMonth ? dateKey(year, month, now.getDate()) : dateKey(year, month, 1),
    );
  };

  const shift = (delta: number): void => {
    const next = new Date(cursor.year, cursor.month + delta, 1);
    moveTo(next.getFullYear(), next.getMonth());
  };

  const dayCount = daysInMonth(cursor.year, cursor.month);
  const leading = firstWeekday(cursor.year, cursor.month);
  const cells: Array<number | null> = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: dayCount }, (_, index) => index + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthTotal = data?.total ?? 0;
  const truncated = data !== null && monthTotal > data.limit;

  return (
    <div>
      <PageHeader
        title="Appointment calendar"
        subtitle="A day-by-day view of the month — bookings only, no resource planning"
        actions={
          <div className="btn-row">
            <Link className="btn btn-secondary" to="/appointments">
              List view
            </Link>
          </div>
        }
      />

      <section className="card">
        <div className="calendar-toolbar">
          <button type="button" className="btn btn-secondary" onClick={() => shift(-1)}>
            Previous month
          </button>
          <h2 className="card-title" style={{ margin: 0 }}>
            {MONTH_NAMES[cursor.month]} {cursor.year}
          </h2>
          <button type="button" className="btn btn-secondary" onClick={() => shift(1)}>
            Next month
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              const now = new Date();
              moveTo(now.getFullYear(), now.getMonth());
            }}
          >
            Today
          </button>
        </div>

        {orgId === null ? (
          <EmptyState
            title="No clinic context"
            description="This account is not attached to a clinic, so there are no appointments to show."
          />
        ) : null}
        {orgId !== null && status === 'loading' && data === null ? (
          <LoadingState label="Loading appointments…" />
        ) : null}
        {orgId !== null && status === 'error' && data === null ? (
          <ErrorState
            message={error ?? 'Appointments could not be loaded.'}
            onRetry={reload}
          />
        ) : null}
        {data !== null && monthTotal === 0 ? (
          <EmptyState
            title="No appointments this month"
            description="Book an appointment from the list view and it will appear here."
          />
        ) : null}

        {data !== null && monthTotal > 0 ? (
          <>
            {truncated ? (
              <p style={{ fontSize: 'var(--fs-label)', color: 'var(--color-text-secondary)' }}>
                Showing the first {data.limit} of {monthTotal} appointments this month. Use the
                list view for the full set.
              </p>
            ) : null}
            <div className="calendar-scroll" role="region" aria-label="Appointment calendar">
              <div className="calendar-weekdays">
                {WEEKDAYS.map((day) => (
                  <div key={day}>{day}</div>
                ))}
              </div>
              <div className="calendar-grid">
                {cells.map((day, index) => {
                  if (day === null) {
                    return <div key={`blank-${index}`} className="calendar-cell empty" aria-hidden="true" />;
                  }
                  const key = dateKey(cursor.year, cursor.month, day);
                  const appointments = byDay.get(key) ?? [];
                  const isSelected = key === selected;
                  const isToday = key === todayKey;
                  return (
                    <div key={key} className="calendar-cell">
                      <button
                        type="button"
                        className={[
                          'calendar-day',
                          isSelected ? 'selected' : '',
                          isToday ? 'today' : '',
                        ]
                          .filter((value) => value !== '')
                          .join(' ')}
                        aria-pressed={isSelected}
                        onClick={() => setSelected(key)}
                      >
                        {day}
                      </button>
                      <ul className="calendar-events">
                        {appointments.slice(0, MAX_PER_CELL).map((appointment) => (
                          <li key={appointment.id}>
                            <Link to={`/appointments/${appointment.id}`}>
                              {formatTime(appointment.time)}{' '}
                              {fullName(appointment.patient.firstName, appointment.patient.lastName)}
                            </Link>
                          </li>
                        ))}
                        {appointments.length > MAX_PER_CELL ? (
                          <li className="calendar-more">
                            +{appointments.length - MAX_PER_CELL} more
                          </li>
                        ) : null}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}
      </section>

      <section className="card">
        <h2 className="card-title">
          {new Date(`${selected}T00:00:00`).toLocaleDateString(undefined, {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </h2>
        {data !== null && selectedAppointments.length === 0 ? (
          <EmptyState
            title="No appointments"
            description="Nothing is booked on this day. Pick another day in the calendar above."
          />
        ) : null}
        {data !== null && selectedAppointments.length > 0 ? (
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Selected day appointments"
          >
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Patient</th>
                  <th scope="col">Service</th>
                  <th scope="col">Provider</th>
                  <th scope="col">Status</th>
                  <th scope="col" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {selectedAppointments.map((appointment) => (
                  <tr key={appointment.id}>
                    <td>{formatTime(appointment.time)}</td>
                    <td>
                      <Link to={`/appointments/${appointment.id}`}>
                        {fullName(appointment.patient.firstName, appointment.patient.lastName)}
                      </Link>
                    </td>
                    <td>{appointment.service ?? '—'}</td>
                    <td>{appointment.provider ?? '—'}</td>
                    <td>
                      <StatusBadge label={appointment.status} tone={statusTone(appointment.status)} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Link className="btn btn-secondary" to={`/appointments/${appointment.id}`}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
