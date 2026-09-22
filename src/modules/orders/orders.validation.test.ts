import { describe, expect, it } from 'vitest';
import { assertContactValueMatchesChannel, createOrderSchema } from './orders.validation';
import { ValidationError } from '../../lib/errors';

describe('createOrderSchema', () => {
  it('accepts a well-formed order', () => {
    const result = createOrderSchema.safeParse({
      items: [{ menu_item_id: '11111111-1111-1111-1111-111111111111', quantity: 2 }],
      contact_channel: 'sms',
      contact_value: '+254712345678',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty items array', () => {
    const result = createOrderSchema.safeParse({
      items: [],
      contact_channel: 'sms',
      contact_value: '+254712345678',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-uuid menu_item_id', () => {
    const result = createOrderSchema.safeParse({
      items: [{ menu_item_id: 'not-a-uuid', quantity: 1 }],
      contact_channel: 'sms',
      contact_value: '+254712345678',
    });
    expect(result.success).toBe(false);
  });
});

describe('assertContactValueMatchesChannel', () => {
  it('accepts an E.164 phone number for sms', () => {
    expect(() =>
      assertContactValueMatchesChannel({
        items: [],
        contact_channel: 'sms',
        contact_value: '+254712345678',
      }),
    ).not.toThrow();
  });

  it('rejects a local-format phone number for sms', () => {
    expect(() =>
      assertContactValueMatchesChannel({
        items: [],
        contact_channel: 'sms',
        contact_value: '0712345678',
      }),
    ).toThrow(ValidationError);
  });

  it('accepts a well-formed email for email channel', () => {
    expect(() =>
      assertContactValueMatchesChannel({
        items: [],
        contact_channel: 'email',
        contact_value: 'diner@example.com',
      }),
    ).not.toThrow();
  });

  it('rejects a malformed email for email channel', () => {
    expect(() =>
      assertContactValueMatchesChannel({
        items: [],
        contact_channel: 'email',
        contact_value: 'not-an-email',
      }),
    ).toThrow(ValidationError);
  });
});
