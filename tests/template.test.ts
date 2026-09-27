import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEAD_ACK_TEMPLATE,
  LEAD_ACK_TEMPLATE_NAME,
  renderTemplate,
} from '../src/communications/template';

describe('template rendering', () => {
  it('substitutes known variables', () => {
    expect(renderTemplate('Hi {{first_name}}!', { first_name: 'Vera' })).toBe('Hi Vera!');
  });

  it('tolerates spaces inside the braces', () => {
    expect(renderTemplate('{{ clinic_name }}', { clinic_name: 'Smile Dental' })).toBe(
      'Smile Dental',
    );
  });

  it('renders missing and null variables as empty strings without leaving braces', () => {
    const out = renderTemplate('A{{missing}}B{{other}}C', { other: null });
    expect(out).toBe('ABC');
    expect(out).not.toContain('{{');
  });

  it('renders the default lead acknowledgement template with provided variables', () => {
    const out = renderTemplate(DEFAULT_LEAD_ACK_TEMPLATE, {
      first_name: 'Vera',
      clinic_name: 'M6 Clinic A',
    });
    expect(out).toContain('Vera');
    expect(out).toContain('M6 Clinic A');
    expect(out).not.toContain('{{');
  });

  it('exposes the lead acknowledgement template name', () => {
    expect(LEAD_ACK_TEMPLATE_NAME).toBe('lead_acknowledgement');
  });
});
