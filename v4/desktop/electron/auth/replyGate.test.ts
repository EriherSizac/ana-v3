import { describe, expect, it } from 'vitest';
import { decideReply, NO_REPLY_ERROR, UNKNOWN_ACCESS_ERROR } from './replyGate';

describe('decideReply', () => {
  it('con ana:chats:message:reply o admin → ok', () => {
    expect(decideReply({ isAdmin: false, permissions: ['ana:chats:message:reply'] })).toEqual({ ok: true });
    expect(decideReply({ isAdmin: true, permissions: [] })).toEqual({ ok: true });
  });
  it('rol con -ana:chats:message:reply (sin el permiso efectivo) → sin permiso para responder', () => {
    expect(decideReply({ isAdmin: false, permissions: ['ana:chats:conversation:view'] })).toEqual({ ok: false, error: NO_REPLY_ERROR });
    expect(NO_REPLY_ERROR).toBe('sin permiso para responder');
  });
  it('acceso desconocido → no envía', () => {
    expect(decideReply(null)).toEqual({ ok: false, error: UNKNOWN_ACCESS_ERROR });
  });
});
