import { describe, expect, it } from 'vitest';
import { isSessionUpdate, updateBannerView } from './updateBanner';

describe('updateBannerView (add-in-session-updates)', () => {
  it('solo estados a media sesión; nunca ofrece posponer', () => {
    expect(updateBannerView({ phase: 'downloading', percent: 10 })).toBeNull();
    expect(isSessionUpdate({ phase: 'downloading', inSession: true })).toBe(true);
    const views = [
      { phase: 'downloading', version: '1.5.1', percent: 41.6, inSession: true },
      { phase: 'installing', version: '1.5.1', waitingForJob: true, inSession: true },
      { phase: 'restarting', version: '1.5.1', secondsLeft: 12, inSession: true },
      { phase: 'installing', version: '1.5.1', inSession: true },
    ].map(updateBannerView);
    expect(views[0]).toMatchObject({ tone: 'info', title: 'Nueva versión 1.5.1 — se actualizará automáticamente', percent: 42 });
    expect(views[1]?.detail).toBe('Terminando el envío en curso…');
    expect(views[2]?.detail).toBe('Reiniciando para actualizar en 12 s');
    for (const v of views) expect(JSON.stringify(v)).not.toMatch(/Más tarde/);
  });

  it('error: tono error con el mensaje', () => {
    const v = updateBannerView({ phase: 'error', version: '1.5.1', message: 'sin red', inSession: true });
    expect(v).toMatchObject({ tone: 'error', title: 'No se pudo actualizar 1.5.1' });
    expect(v?.detail).toContain('sin red');
  });
});
