import { describe, expect, it } from 'vitest';
import { parseEstimatedFee, readConditionCodes } from '../src/clinical/chart';
import { universalNumber } from '../src/clinical/teeth';
import { pickReminderOffset } from '../src/communications/reminderPick';
import { ManualClickToChatProvider, toE164, waMeUrl } from '../src/communications/whatsappDelivery';
import { ValidationError } from '../src/errors';

describe('permanent tooth numbering', () => {
  it('maps FDI to Universal for the ends of each quadrant', () => {
    expect(universalNumber('18')).toBe(1);
    expect(universalNumber('11')).toBe(8);
    expect(universalNumber('21')).toBe(9);
    expect(universalNumber('28')).toBe(16);
    expect(universalNumber('38')).toBe(17);
    expect(universalNumber('31')).toBe(24);
    expect(universalNumber('41')).toBe(25);
    expect(universalNumber('48')).toBe(32);
  });
});

describe('tooth chart values', () => {
  it('keeps known condition codes and drops anything else when reading stored JSON', () => {
    expect(readConditionCodes('["caries","nope","filled","caries"]')).toEqual(['caries', 'filled']);
    expect(readConditionCodes(['implant', 'missing'])).toEqual(['implant', 'missing']);
  });

  it('accepts a non-negative fee with at most two decimal places', () => {
    expect(parseEstimatedFee('180')).toBe('180.00');
    expect(parseEstimatedFee(12.5)).toBe('12.50');
    expect(parseEstimatedFee(null)).toBeNull();
    expect(() => parseEstimatedFee(-1)).toThrow(ValidationError);
    expect(() => parseEstimatedFee('12.345')).toThrow(ValidationError);
  });
});

describe('reminder template choice', () => {
  const offsets = [48, 24, 2];

  it('picks the closest offset and prefers the larger one on a tie', () => {
    expect(pickReminderOffset(50, offsets)).toBe(48);
    expect(pickReminderOffset(20, offsets)).toBe(24);
    expect(pickReminderOffset(3, offsets)).toBe(2);
    expect(pickReminderOffset(13, offsets)).toBe(24);
    expect(pickReminderOffset(-4, offsets)).toBe(48);
    expect(pickReminderOffset(10, [72, 6])).toBe(6);
  });
});

describe('WhatsApp click-to-chat', () => {
  it('builds an E.164 number and a wa.me link without calling an API', async () => {
    expect(toE164('971501234567')).toBe('+971501234567');
    expect(toE164('+1 (555) 010-0199')).toBe('+15550100199');
    expect(() => toE164('01234567')).toThrow(ValidationError);
    expect(() => toE164('1234567')).toThrow(ValidationError);

    const result = await new ManualClickToChatProvider().handoff({
      toE164: '+971501234567',
      body: 'Hi Layla, see you Thursday',
    });
    expect(result.mode).toBe('manual');
    expect(result.providerKey).toBe('whatsapp_manual');
    expect(result.providerMessageId).toBeNull();
    expect(result.url).toBe(waMeUrl('+971501234567', 'Hi Layla, see you Thursday'));
    expect(result.url).toBe('https://wa.me/971501234567?text=Hi%20Layla%2C%20see%20you%20Thursday');
  });
});
