import { describe, it, expect, vi } from 'vitest';
import {
  INVALID,
  isAppUrl,
  isJid,
  vText,
  vToken,
  vCampaign,
  vIdList,
  vTemplates,
  vMedia,
  sanitizeFilename,
  createGuard,
  shouldBlockKey,
  MAX_MEDIA_BYTES,
} from './guard';

const b64 = (bytes: number) => Buffer.alloc(bytes, 1).toString('base64');

describe('isAppUrl', () => {
  const packaged = { packaged: true, devOrigin: 'http://localhost:5173' };
  const dev = { packaged: false, devOrigin: 'http://localhost:5173' };
  it('build instalado: solo file://…/dist/index.html', () => {
    expect(isAppUrl('file:///C:/Program%20Files/ana/resources/app.asar/dist/index.html', packaged)).toBe(true);
    expect(isAppUrl('file:///C:/otra/cosa.html', packaged)).toBe(false);
    expect(isAppUrl('https://evil.example/dist/index.html', packaged)).toBe(false);
  });
  it('dev: mismo origen del servidor de Vite', () => {
    expect(isAppUrl('http://localhost:5173/#/chats', dev)).toBe(true);
    expect(isAppUrl('http://localhost:5174/', dev)).toBe(false);
    expect(isAppUrl('basura', dev)).toBe(false);
  });
});

describe('validadores', () => {
  it('JID solo de contacto individual', () => {
    expect(isJid('5215512345678@c.us')).toBe(true);
    expect(isJid('123@g.us')).toBe(false);
    expect(isJid('120363025555555555@g.us')).toBe(false);
    expect(isJid('abc')).toBe(false);
    expect(isJid(5215512345678)).toBe(false);
  });
  it('texto 1–4096', () => {
    expect(vText('hola')).toBe('hola');
    expect(vText('')).toBeUndefined();
    expect(vText('x'.repeat(4097))).toBeUndefined();
    expect(vText(42)).toBeUndefined();
  });
  it('token: null o JWT', () => {
    expect(vToken(null)).toBeNull();
    expect(vToken('aaa.bbb.ccc')).toBe('aaa.bbb.ccc');
    expect(vToken('no-es-jwt')).toBeUndefined();
    expect(vToken({})).toBeUndefined();
  });
  it('campaña ≤ 100 o null', () => {
    expect(vCampaign('bancoppel')).toBe('bancoppel');
    expect(vCampaign(null)).toBeNull();
    expect(vCampaign('x'.repeat(101))).toBeUndefined();
  });
  it('lista de ids acotada', () => {
    expect(vIdList(['a', 'b'])).toEqual(['a', 'b']);
    expect(vIdList(new Array(5001).fill('a'))).toBeUndefined();
    expect(vIdList(['x'.repeat(201)])).toBeUndefined();
    expect(vIdList('a')).toBeUndefined();
  });
  it('plantillas por archivo', () => {
    expect(vTemplates({ 'csv/a.csv': 'Hola' })).toEqual({ 'csv/a.csv': 'Hola' });
    expect(vTemplates(undefined)).toEqual({});
    expect(vTemplates({ a: 'x'.repeat(4097) })).toBeUndefined();
    expect(vTemplates(['x'])).toBeUndefined();
  });
  it('filename saneado', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(sanitizeFilename('a'.repeat(200))).toHaveLength(120);
    expect(sanitizeFilename(3)).toBeUndefined();
  });
  it('media: tamaño, tipo y forma', () => {
    const ok = { dataBase64: b64(1000), mimetype: 'image/png', filename: 'foto 1.png', caption: 'hola' };
    expect(vMedia(ok)).toEqual(ok);
    expect(vMedia({ ...ok, mimetype: 'application/pdf' })).toBeTruthy();
    expect(vMedia({ ...ok, mimetype: 'text/html' })).toBeUndefined();
    expect(vMedia({ ...ok, mimetype: 'application/x-msdownload' })).toBeUndefined();
    expect(vMedia({ ...ok, dataBase64: 'no base64!' })).toBeUndefined();
    expect(vMedia({ ...ok, caption: 'x'.repeat(4097) })).toBeUndefined();
  });
  it('media de 40 MB → inválida (sin decodificar)', () => {
    const big = 'A'.repeat(Math.ceil((40 * 1024 * 1024 * 4) / 3 / 4) * 4);
    expect(vMedia({ dataBase64: big, mimetype: 'video/mp4', filename: 'v.mp4' })).toBeUndefined();
    const limit = b64(MAX_MEDIA_BYTES);
    expect(vMedia({ dataBase64: limit, mimetype: 'video/mp4', filename: 'v.mp4' })).toBeTruthy();
  });
});

describe('createGuard', () => {
  const trusted = (e: { senderFrame?: { url: string } | null }) => e.senderFrame?.url === 'app://main';
  const guard = createGuard(trusted, () => {});

  it('frame ajeno → rechazo sin llamar al handler', () => {
    const handler = vi.fn(() => ({ ok: true }));
    const h = guard('wa:send-reply', (a) => (isJid(a[0]) ? [a[0]] : undefined), handler);
    expect(h({ senderFrame: { url: 'https://evil' } }, '5215512345678@c.us')).toEqual(INVALID);
    expect(h({ senderFrame: null }, '5215512345678@c.us')).toEqual(INVALID);
    expect(handler).not.toHaveBeenCalled();
  });
  it('argumentos inválidos → rechazo sin llamar al handler', () => {
    const handler = vi.fn();
    const h = guard('wa:send-reply', (a) => (isJid(a[0]) ? [a[0]] : undefined), handler);
    expect(h({ senderFrame: { url: 'app://main' } }, '123@g.us')).toEqual(INVALID);
    expect(handler).not.toHaveBeenCalled();
  });
  it('válido → llama al handler con los argumentos normalizados', () => {
    const handler = vi.fn((jid: string) => ({ ok: true, jid }));
    const h = guard('wa:send-reply', (a) => (isJid(a[0]) ? ([a[0]] as [string]) : undefined), handler);
    expect(h({ senderFrame: { url: 'app://main' } }, '5215512345678@c.us')).toEqual({
      ok: true,
      jid: '5215512345678@c.us',
    });
  });
});

describe('shouldBlockKey', () => {
  it('Ctrl+Shift+I bloqueado', () => expect(shouldBlockKey({ key: 'I', control: true, shift: true })).toBe(true));
  it('Ctrl+U bloqueado', () => expect(shouldBlockKey({ key: 'u', control: true })).toBe(true));
  it('F12 bloqueado (aun con Alt)', () => {
    expect(shouldBlockKey({ key: 'F12' })).toBe(true);
    expect(shouldBlockKey({ key: 'F12', alt: true })).toBe(true);
  });
  it('AltGr (Ctrl+Alt+Q → @) permitido', () =>
    expect(shouldBlockKey({ key: '@', control: true, alt: true })).toBe(false));
  it('Ctrl+Alt+Shift+I permitido', () =>
    expect(shouldBlockKey({ key: 'I', control: true, alt: true, shift: true })).toBe(false));
  it('teclas normales permitidas', () => expect(shouldBlockKey({ key: 'a' })).toBe(false));
});
