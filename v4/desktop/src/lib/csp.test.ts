import { describe, it, expect } from 'vitest';
import { buildCsp, originOf } from './csp';

const directive = (csp: string, name: string) =>
  csp.split('; ').find((d) => d.startsWith(name + ' ')) ?? '';

describe('buildCsp', () => {
  const prod = buildCsp({ apiBase: 'https://abc.execute-api.us-east-2.amazonaws.com/' });
  it('scripts y fuentes solo del paquete', () => {
    expect(directive(prod, 'script-src')).toBe("script-src 'self'");
    expect(directive(prod, 'font-src')).toBe("font-src 'self' data:");
    expect(prod).not.toContain('googleapis');
  });
  it('conexiones: API, Cognito y AWS', () => {
    const c = directive(prod, 'connect-src');
    expect(c).toContain('https://abc.execute-api.us-east-2.amazonaws.com');
    expect(c).toContain('https://cognito-idp.us-east-2.amazonaws.com');
    expect(c).toContain('https://*.amazonaws.com');
  });
  it('sin objetos embebidos', () => expect(directive(prod, 'object-src')).toBe("object-src 'none'"));
  it('dev agrega el servidor de Vite y ws', () => {
    const dev = buildCsp({ apiBase: undefined, devServer: 'http://localhost:5173' });
    expect(directive(dev, 'connect-src')).toContain('ws://localhost:5173');
    expect(directive(dev, 'script-src')).toContain('http://localhost:5173');
  });
  it('originOf ignora esquemas no http(s)', () => {
    expect(originOf('javascript:alert(1)')).toBeNull();
    expect(originOf('nada')).toBeNull();
  });
});
