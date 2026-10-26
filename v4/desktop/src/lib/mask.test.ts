import { describe, it, expect } from 'vitest';
import { maskPhone } from './mask';

describe('maskPhone', () => {
  it('*** + últimos 4', () => expect(maskPhone('5215512341922')).toBe('***1922'));
  it('acepta JID', () => expect(maskPhone('5215512341922@c.us')).toBe('***1922'));
  it('menos de 4 dígitos', () => expect(maskPhone('12')).toBe('***'));
});
