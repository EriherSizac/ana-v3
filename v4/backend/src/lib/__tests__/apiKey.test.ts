import { describe, it, expect } from 'vitest';
import { matchesApiKey } from '../apiKey';

describe('matchesApiKey', () => {
  const keys = ['current-key', 'next-key'];
  it('acepta la key actual', () => expect(matchesApiKey('current-key', keys)).toBe(true));
  it('acepta la key NEXT', () => expect(matchesApiKey('next-key', keys)).toBe(true));
  it('rechaza una key incorrecta', () => expect(matchesApiKey('otra', keys)).toBe(false));
  it('rechaza header ausente', () => {
    expect(matchesApiKey(undefined, keys)).toBe(false);
    expect(matchesApiKey('', keys)).toBe(false);
  });
  it('rechaza todo si ambas keys están vacías', () => {
    expect(matchesApiKey('', ['', ''])).toBe(false);
    expect(matchesApiKey('x', ['', undefined])).toBe(false);
  });
  it('ignora keys vacías y acepta la configurada', () =>
    expect(matchesApiKey('next-key', ['', 'next-key'])).toBe(true));
});
