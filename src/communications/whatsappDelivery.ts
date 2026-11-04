import { ValidationError } from '../errors';

export type WhatsAppDeliveryMode = 'manual' | 'api';

export interface WhatsAppHandoffRequest {
  toE164: string;
  body: string;
}

export interface WhatsAppHandoffResult {
  mode: WhatsAppDeliveryMode;
  providerKey: string;
  url: string | null;
  providerMessageId: string | null;
}

/**
 * A delivery provider turns a rendered message into either a click-to-chat
 * link (manual) or a provider message id (a future WhatsApp Business API
 * adapter). The caller logs the communication row; this interface does not.
 */
export interface WhatsAppDeliveryProvider {
  readonly key: string;
  readonly mode: WhatsAppDeliveryMode;
  handoff(request: WhatsAppHandoffRequest): Promise<WhatsAppHandoffResult>;
}

export function toE164(storedPhone: string): string {
  const digits = storedPhone.replace(/\D/g, '');
  if (!/^[1-9]\d{7,14}$/.test(digits)) {
    throw new ValidationError('Invalid input', [
      'phone must be an international number in E.164 form',
    ]);
  }
  return `+${digits}`;
}

export function waMeUrl(phoneE164: string, body: string): string {
  const digits = phoneE164.startsWith('+') ? phoneE164.slice(1) : phoneE164;
  return `https://wa.me/${digits}?text=${encodeURIComponent(body)}`;
}

export class ManualClickToChatProvider implements WhatsAppDeliveryProvider {
  readonly key = 'whatsapp_manual';
  readonly mode = 'manual' as const;

  handoff(request: WhatsAppHandoffRequest): Promise<WhatsAppHandoffResult> {
    return Promise.resolve({
      mode: 'manual',
      providerKey: this.key,
      url: waMeUrl(request.toE164, request.body),
      providerMessageId: null,
    });
  }
}

export function manualWhatsAppDelivery(): WhatsAppDeliveryProvider {
  return new ManualClickToChatProvider();
}
