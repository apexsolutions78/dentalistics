import type { Message } from '../lib/types';
import { dayKey, formatDay, formatDateTime, formatTime } from '../lib/format';

function describe(message: Message): { who: string; label: string } {
  if (message.direction === 'INBOUND') {
    return { who: 'Patient', label: 'Patient replied' };
  }
  if (message.template !== null && message.template !== '') {
    return { who: 'Automated', label: 'Clinic sent (automated)' };
  }
  return { who: 'Clinic', label: 'Clinic sent' };
}

export function CommunicationTimeline({ messages }: { messages: Message[] }) {
  if (messages.length === 0) {
    return (
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--fs-label)' }}>
        No messages yet.
      </p>
    );
  }

  const ordered = [...messages].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const groups: Array<{ day: string; items: Message[] }> = [];
  for (const message of ordered) {
    const day = dayKey(String(message.createdAt));
    const last = groups[groups.length - 1];
    if (last !== undefined && last.day === day) {
      last.items.push(message);
    } else {
      groups.push({ day, items: [message] });
    }
  }

  return (
    <div className="timeline">
      {groups.map((group) => (
        <div key={group.day} className="timeline-day">
          <h3 className="timeline-day-title" style={{ fontSize: 'var(--fs-label)', margin: '12px 0 6px' }}>
            {formatDay(group.day)}
          </h3>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '8px' }}>
            {group.items.map((message) => {
              const info = describe(message);
              return (
                <li
                  key={message.id}
                  className="timeline-entry"
                  style={{
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                    padding: '8px 10px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '8px',
                      fontSize: 'var(--fs-label)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    <span>
                      {formatTime(String(message.createdAt))} — {info.label} ({message.channel.toLowerCase()})
                    </span>
                    <span title={formatDateTime(String(message.createdAt))}>{message.status}</span>
                  </div>
                  <div style={{ marginTop: '4px', whiteSpace: 'pre-wrap' }}>{message.body}</div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
