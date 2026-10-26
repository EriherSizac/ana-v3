import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  listConversations,
  listMessages,
  putMessage,
  markRead,
  putConversationMeta,
  RECENT_INDEX,
} from '../conversations';

const ddbMock = mockClient(DynamoDBDocumentClient);
const ccf = () => new ConditionalCheckFailedException({ message: 'c', $metadata: {} });
const body = (r: any) => JSON.parse(r.body);

beforeEach(() => ddbMock.reset());

/** Simula un Query paginado sobre `items` ya ordenados ascendentemente por `sortKey`. */
function fakeQuery(items: Record<string, any>[], keyAttrs: string[], sortKey: string) {
  ddbMock.on(QueryCommand).callsFake((input) => {
    const ordered = input.ScanIndexForward === false ? [...items].reverse() : items;
    let from = 0;
    if (input.ExclusiveStartKey) {
      const k = input.ExclusiveStartKey as Record<string, any>;
      from = ordered.findIndex((it) => it[sortKey] === k[sortKey]) + 1;
    }
    const page = ordered.slice(from, from + (input.Limit ?? ordered.length));
    const last = page[page.length - 1];
    const more = from + page.length < ordered.length;
    return {
      Items: page,
      LastEvaluatedKey: more ? Object.fromEntries(keyAttrs.map((a) => [a, last[a]])) : undefined,
    };
  });
}

describe('putMessage', () => {
  const msg = { chatId: '5215512345678@c.us', id: 'm1', timestamp: 1000, body: 'hola', fromMe: false };

  it('mensaje repetido → sin UpdateCommand', async () => {
    ddbMock.on(PutCommand).rejects(ccf());
    const r: any = await putMessage('ana', msg);
    expect(r.statusCode).toBe(201);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('entrante nuevo → resumen condicionado + ADD unreadCount 1', async () => {
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});
    await putMessage('ana', msg);
    const ups = ddbMock.commandCalls(UpdateCommand).map((c) => c.args[0].input);
    expect(ups[0].UpdateExpression).toBe('SET lastMessage = :b, lastMessageTime = :t');
    expect(ups[0].ConditionExpression).toBe('attribute_not_exists(lastMessageTime) OR lastMessageTime <= :t');
    expect(ups[1].UpdateExpression).toBe('ADD unreadCount :one');
  });

  it('propio nuevo → no toca unreadCount', async () => {
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});
    await putMessage('ana', { ...msg, fromMe: true });
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
  });

  it('mensaje viejo → el resumen falla por condición pero sí cuenta el no leído', async () => {
    ddbMock.on(PutCommand).resolves({});
    ddbMock
      .on(UpdateCommand, { UpdateExpression: 'SET lastMessage = :b, lastMessageTime = :t' })
      .rejects(ccf());
    ddbMock.on(UpdateCommand, { UpdateExpression: 'ADD unreadCount :one' }).resolves({});
    const r: any = await putMessage('ana', { ...msg, timestamp: 1 });
    expect(r.statusCode).toBe(201);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(2);
  });

  it('faltan campos → 400', async () => {
    expect(((await putMessage('ana', { id: 'x' })) as any).statusCode).toBe(400);
  });
});

describe('markRead', () => {
  it('pone 0 en la partición propia, condicionado a existir', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    const r: any = await markRead('ana', 'c1@c.us');
    expect(body(r)).toEqual({ ok: true });
    const up = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(up.Key).toEqual({ operatorId: 'ana', chatId: 'c1@c.us' });
    expect(up.ConditionExpression).toBe('attribute_exists(chatId)');
  });
  it('inexistente → 200 sin crear', async () => {
    ddbMock.on(UpdateCommand).rejects(ccf());
    expect(body(await markRead('ana', 'nada@c.us'))).toEqual({ ok: true });
  });
});

describe('listConversations', () => {
  const items = Array.from({ length: 450 }, (_, i) => ({
    operatorId: 'ana',
    chatId: `c${i}@c.us`,
    lastMessageTime: i + 1,
  }));

  it('450 conversaciones en páginas de 200 → 200, 200, 50 (más recientes primero)', async () => {
    fakeQuery(items, ['operatorId', 'chatId', 'lastMessageTime'], 'lastMessageTime');
    const p1 = body(await listConversations('ana', { limit: '200' }));
    expect(p1.conversations).toHaveLength(200);
    expect(p1.conversations[0].lastMessageTime).toBe(450);
    const p2 = body(await listConversations('ana', { limit: '200', nextToken: p1.nextToken }));
    expect(p2.conversations).toHaveLength(200);
    const p3 = body(await listConversations('ana', { limit: '200', nextToken: p2.nextToken }));
    expect(p3.conversations).toHaveLength(50);
    expect(p3.nextToken).toBeUndefined();
    const ids = new Set([...p1.conversations, ...p2.conversations, ...p3.conversations].map((c: any) => c.chatId));
    expect(ids.size).toBe(450);
    const q = ddbMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(q.IndexName).toBe(RECENT_INDEX);
    expect(q.ScanIndexForward).toBe(false);
  });

  it('default 100 y máximo 200', async () => {
    fakeQuery(items, ['operatorId', 'chatId', 'lastMessageTime'], 'lastMessageTime');
    await listConversations('ana');
    await listConversations('ana', { limit: '9999' });
    const limits = ddbMock.commandCalls(QueryCommand).map((c) => c.args[0].input.Limit);
    expect(limits).toEqual([100, 200]);
  });

  it('nextToken inválido o de otra partición → 400', async () => {
    const r1: any = await listConversations('ana', { nextToken: 'no-es-json' });
    expect(r1.statusCode).toBe(400);
    expect(body(r1)).toEqual({ error: 'nextToken inválido' });
    const foreign = Buffer.from(JSON.stringify({ operatorId: 'otro', chatId: 'x', lastMessageTime: 1 })).toString(
      'base64url',
    );
    expect(((await listConversations('ana', { nextToken: foreign })) as any).statusCode).toBe(400);
  });
});

describe('listMessages', () => {
  const k = 'ana#c1@c.us';
  const msgs = Array.from({ length: 700 }, (_, i) => ({
    convKey: k,
    sk: `${String(i).padStart(6, '0')}#m${i}`,
    id: `m${i}`,
  }));

  it('700 mensajes sin limit → los 200 más recientes ascendentes + nextToken', async () => {
    fakeQuery(msgs, ['convKey', 'sk'], 'sk');
    const p1 = body(await listMessages('ana', 'c1@c.us'));
    expect(p1.messages).toHaveLength(200);
    expect(p1.messages[0].id).toBe('m500');
    expect(p1.messages[199].id).toBe('m699');
    expect(p1.nextToken).toBeTruthy();
    const p2 = body(await listMessages('ana', 'c1@c.us', { nextToken: p1.nextToken }));
    expect(p2.messages[0].id).toBe('m300');
    expect(p2.messages[199].id).toBe('m499');
  });

  it('chat sin mensajes → []', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    expect(body(await listMessages('ana', 'x@c.us'))).toEqual({ chatId: 'x@c.us', messages: [] });
  });

  it('sin chatId → 400', async () => {
    expect(body(await listMessages('ana', undefined))).toEqual({ error: 'falta chatId' });
  });
});

describe('putConversationMeta', () => {
  it('fija lastMessageTime con if_not_exists', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await putConversationMeta('ana', { chatId: 'c1@c.us', campaign: 'b', contact: { nombre: 'Ana' } });
    const up = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(up.UpdateExpression).toContain('lastMessageTime = if_not_exists(lastMessageTime, :zero)');
  });
});
