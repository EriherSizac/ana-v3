import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { uploadAgentContacts } from '../src/handlers/supervisors';
import { getChats } from '../src/handlers/chats';
import { updatePendingContacts } from '../src/handlers/contacts';
import { installMemS3 } from './helpers/memS3';

const s3 = mockClient(S3Client);
const KEY = 'test-admin-key';

beforeEach(() => {
  s3.reset();
  process.env.ADMIN_API_KEY = KEY;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('/get/chats consume cargas de supervisor con mayúsculas', () => {
  it('carga directa a Erick/Prueba es consumida por GET /get/chats/erick/prueba', async () => {
    const store = installMemS3(s3);
    const up = await uploadAgentContacts({
      headers: { 'X-Admin-Key': KEY, 'content-type': 'application/json' },
      pathParameters: { agent: 'Erick', campaign: 'Prueba' },
      body: JSON.stringify({ csv: 'contact_phone\n5215500000001', message: 'Hola', direct: true }),
    } as unknown as APIGatewayProxyEvent);
    expect(up.statusCode).toBe(200);
    const directKey = JSON.parse(up.body).data.key as string;
    expect(directKey).toMatch(/^agents\/prueba\/erick-contacts-/);

    const res = await getChats({
      headers: {},
      pathParameters: { agentId: 'erick', campaignId: 'prueba' },
    } as unknown as APIGatewayProxyEvent);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('5215500000001');
    expect(store.has(directKey)).toBe(false); // consumido
  });

  it('GET /get/chats con ERICK/PRUEBA también lee el prefijo en minúsculas', async () => {
    installMemS3(s3, { 'agents/prueba/erick-contacts-1.csv': 'contact_phone\n1' });
    const res = await getChats({
      headers: {},
      pathParameters: { agentId: ' ERICK ', campaignId: 'PRUEBA' },
    } as unknown as APIGatewayProxyEvent);
    expect(res.statusCode).toBe(200);
  });
});

describe('/contacts/pending', () => {
  const ev = (body: unknown) => ({ headers: {}, body: JSON.stringify(body) }) as unknown as APIGatewayProxyEvent;

  it('normaliza la llave chats/{agent}-{campaign}.csv', async () => {
    installMemS3(s3);
    const res = await updatePendingContacts(ev({ campaign: ' Prueba ', agent_id: 'Erick', contacts: [] }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).path).toBe('chats/erick-prueba.csv');
    expect(s3.commandCalls(PutObjectCommand).map((c) => (c.args[0].input as any).Key)).toEqual([
      'chats/erick-prueba.csv',
    ]);
  });

  it.each([
    { campaign: '   ', agent_id: 'erick' },
    { campaign: 'prueba', agent_id: '   ' },
  ])('responde 400 con valor solo de espacios (%o)', async (body) => {
    const res = await updatePendingContacts(ev({ ...body, contacts: [] }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'campaign y agent_id son requeridos' });
    expect(s3.calls()).toHaveLength(0);
  });
});
