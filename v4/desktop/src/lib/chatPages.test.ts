import { describe, it, expect } from 'vitest';
import { mergeConversations, refreshConversations, prependMessages, clearUnread } from './chatPages';

type C = { chatId: string; unreadCount?: number; lastMessage?: string };
const c = (id: string, extra: Partial<C> = {}): C => ({ chatId: id, ...extra });
const m = (id: string) => ({ id });

describe('chatPages', () => {
  it('mergeConversations agrega al final sin repetir', () => {
    expect(mergeConversations([c('a'), c('b')], [c('b'), c('c')]).map((x) => x.chatId)).toEqual(['a', 'b', 'c']);
  });
  it('refreshConversations: la página nueva manda y conserva las cargadas después', () => {
    const fresh = [c('z', { lastMessage: 'nuevo' }), c('a', { lastMessage: 'a2' })];
    const current = [c('a', { lastMessage: 'a1' }), c('b'), c('c')];
    const out = refreshConversations(fresh, current);
    expect(out.map((x) => x.chatId)).toEqual(['z', 'a', 'b', 'c']);
    expect(out[1]).toMatchObject({ lastMessage: 'a2' });
  });
  it('prependMessages antepone sin repetir ids', () => {
    expect(prependMessages([m('1'), m('2'), m('3')], [m('3'), m('4')]).map((x) => x.id)).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
  });
  it('clearUnread pone 0 solo en ese chat', () => {
    const out = clearUnread([c('a', { unreadCount: 3 }), c('b', { unreadCount: 1 })], 'a');
    expect(out.map((x) => x.unreadCount)).toEqual([0, 1]);
  });
});
