import type { CommunicationProvider, OutboundMessage, ProviderSendResult } from './types';
import { ProviderSendError } from './types';

export interface WhatsAppSendCredentials {
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
}

export type WhatsAppCredentialsLoader = (
  organizationId: number,
) => Promise<WhatsAppSendCredentials | null>;

export class WhatsAppProvider implements CommunicationProvider {
  readonly key = 'whatsapp';

  private readonly loadCredentials: WhatsAppCredentialsLoader;

  constructor(loadCredentials: WhatsAppCredentialsLoader) {
    this.loadCredentials = loadCredentials;
  }

  async send(message: OutboundMessage): Promise<ProviderSendResult> {
    const credentials = await this.loadCredentials(message.organizationId);
    if (
      credentials === null ||
      credentials.accessToken === '' ||
      credentials.phoneNumberId === '' ||
      credentials.apiVersion === ''
    ) {
      throw new ProviderSendError(
        'whatsapp_not_configured',
        'WhatsApp provider credentials are not configured',
      );
    }

    const url = `https://graph.facebook.com/${credentials.apiVersion}/${credentials.phoneNumberId}/messages`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          type: 'text',
          to: message.to,
          text: {
            preview_url: false,
            body: message.body,
          },
        }),
      });
    } catch (err) {
      throw new ProviderSendError(
        'whatsapp_network_error',
        err instanceof Error ? err.message : String(err),
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new ProviderSendError(
        'whatsapp_api_error',
        `HTTP ${response.status}: ${text.slice(0, 500)}`,
      );
    }

    const data = (await response.json()) as { messages?: Array<{ id?: string }> };
    const providerMessageId = data.messages?.[0]?.id;
    if (typeof providerMessageId !== 'string' || providerMessageId === '') {
      throw new ProviderSendError(
        'whatsapp_api_error',
        'Missing message id in provider response',
      );
    }
    return { providerMessageId };
  }
}
