const TEMPLATE_PATTERN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export function renderTemplate(
  text: string,
  variables: Record<string, string | null | undefined>,
): string {
  return text.replace(TEMPLATE_PATTERN, (_match, name: string) => {
    const value = variables[name];
    return value === undefined || value === null ? '' : value;
  });
}

export const LEAD_ACK_TEMPLATE_NAME = 'lead_acknowledgement';

export const DEFAULT_LEAD_ACK_TEMPLATE =
  'Hi {{first_name}}, thank you for contacting {{clinic_name}}. Our team will get back to you shortly.';
