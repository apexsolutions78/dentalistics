export interface WhatsAppInboundMessage {
  wamid: string;
  from: string;
  timestamp: string;
  type: string;
  textBody: string | null;
}

export interface WhatsAppStatusEvent {
  wamid: string;
  status: string;
  recipientId: string | null;
}

export interface ParsedWhatsAppPayload {
  inbound: WhatsAppInboundMessage[];
  statuses: WhatsAppStatusEvent[];
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

export function parseWhatsAppPayload(body: unknown): ParsedWhatsAppPayload | null {
  const root = asObject(body);
  if (root === null) {
    return null;
  }
  const entry = root.entry;
  if (!Array.isArray(entry)) {
    return null;
  }

  const inbound: WhatsAppInboundMessage[] = [];
  const statuses: WhatsAppStatusEvent[] = [];

  for (const entryItem of entry) {
    const entryObj = asObject(entryItem);
    if (entryObj === null || !Array.isArray(entryObj.changes)) {
      continue;
    }
    for (const changeItem of entryObj.changes) {
      const change = asObject(changeItem);
      if (change === null || change.field !== 'messages') {
        continue;
      }
      const value = asObject(change.value);
      if (value === null) {
        continue;
      }

      if (Array.isArray(value.messages)) {
        for (const messageItem of value.messages) {
          const message = asObject(messageItem);
          if (message === null) {
            continue;
          }
          const wamid = asString(message.id);
          const from = asString(message.from);
          if (wamid === null || from === null) {
            continue;
          }
          const type = asString(message.type) ?? 'unknown';
          const timestamp =
            typeof message.timestamp === 'string' || typeof message.timestamp === 'number'
              ? String(message.timestamp)
              : '';
          let textBody: string | null = null;
          if (type === 'text') {
            const text = asObject(message.text);
            textBody = text === null ? null : asString(text.body);
            if (textBody === null) {
              continue;
            }
          }
          inbound.push({ wamid, from, timestamp, type, textBody });
        }
      }

      if (Array.isArray(value.statuses)) {
        for (const statusItem of value.statuses) {
          const status = asObject(statusItem);
          if (status === null) {
            continue;
          }
          const wamid = asString(status.id);
          const statusName = asString(status.status);
          if (wamid === null || statusName === null) {
            continue;
          }
          statuses.push({
            wamid,
            status: statusName,
            recipientId: asString(status.recipient_id),
          });
        }
      }
    }
  }

  return { inbound, statuses };
}
