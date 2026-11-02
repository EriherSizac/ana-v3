import { describe, expect, it } from 'vitest';
import { centralLoginUrl, centralLogoutUrl, loginBaseUrl } from '@/lib/central-login';

describe('central-login', () => {
  it('URL base por entorno', () => {
    expect(loginBaseUrl(undefined, 'production')).toBe('https://login.pernexium.com.mx');
    expect(loginBaseUrl(undefined, 'development')).toBe('http://localhost:3100');
    expect(loginBaseUrl('', 'production')).toBe('https://login.pernexium.com.mx');
  });

  it('NEXT_PUBLIC_LOGIN_URL tiene prioridad (sin diagonal final)', () => {
    expect(loginBaseUrl('http://localhost:4100/', 'development')).toBe('http://localhost:4100');
    expect(loginBaseUrl('https://login.pernexium.com.mx', 'development')).toBe('https://login.pernexium.com.mx');
  });

  it('codifica el redirect', () => {
    const base = 'https://login.pernexium.com.mx';
    expect(centralLoginUrl('https://ana-admin.pernexium.com.mx/agentes?x=1&y=2', base)).toBe(
      'https://login.pernexium.com.mx/?redirect=https%3A%2F%2Fana-admin.pernexium.com.mx%2Fagentes%3Fx%3D1%26y%3D2',
    );
    expect(centralLogoutUrl('https://ana-admin.pernexium.com.mx', base)).toBe(
      'https://login.pernexium.com.mx/logout?redirect=https%3A%2F%2Fana-admin.pernexium.com.mx',
    );
  });
});
