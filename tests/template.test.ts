import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEAD_ACK_TEMPLATE,
  LEAD_ACK_TEMPLATE_NAME,
  listTemplateVariables,
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

describe('listTemplateVariables', () => {
  it('extracts unique variable names in order of appearance', () => {
    expect(listTemplateVariables('{{b}} {{a}} {{b}} {{ c_d }}')).toEqual(['b', 'a', 'c_d']);
  });

  it('returns an empty list for text without variables', () => {
    expect(listTemplateVariables('no variables here')).toEqual([]);
  });

  it('matches what renderTemplate substitutes', () => {
    const text = 'Hi {{first_name}}, call {{clinic_phone}} or {{unknown_one}}';
    const names = listTemplateVariables(text);
    const out = renderTemplate(text, { first_name: 'Vera', clinic_phone: '123' });
    for (const name of names) {
      expect(text).toContain(`{{${name}}}`);
    }
    expect(out).toContain('Vera');
    expect(out).not.toContain('{{');
  });
});
