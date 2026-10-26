import { describe, expect, it } from 'vitest';
import { shouldReportOpen } from './chatOpen';

describe('shouldReportOpen', () => {
  it('desactivado o sin configuración → no notifica', () => {
    expect(shouldReportOpen({ openChatInteraction: false }, false)).toBe(false);
    expect(shouldReportOpen(null, false)).toBe(false);
  });
  it('activado → notifica en cada apertura propia', () => {
    expect(shouldReportOpen({ openChatInteraction: true }, false)).toBe(true);
  });
  it('viendo a otro agente → nunca', () => {
    expect(shouldReportOpen({ openChatInteraction: true }, true)).toBe(false);
  });
});
