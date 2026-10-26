import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  uploadAgentContacts,
  publishAgentContactsDeprecated,
  uploadAgentContactsLogging,
  getAgentContacts,
  listAgentAssignments,
  getAgentAssignments,
} from '../src/handlers/supervisors';
import { installMemS3 } from './helpers/memS3';

const s3 = mockClient(S3Client);
const KEY = 'test-admin-key';
const CSV = 'contact_phone,contact_name\n5215500000001,Ana';

const ev = (
  path: Record<string, string>,
  body?: string,
  headers: Record<string, string> = { 'content-type': 'application/json' }
) =>
  ({
    headers: { 'X-Admin-Key': KEY, ...headers },
    pathParameters: path,
    body: body ?? null,
    isBase64Encoded: false,
  }) as unknown as APIGatewayProxyEvent;

const spaced = { agent: ' Erick ', campaign: ' Prueba ' };
const putKeys = () => s3.commandCalls(PutObjectCommand).map((c) => (c.args[0].input as any).Key as string);
const listPrefixes = () => s3.commandCalls(ListObjectsV2Command).map((c) => (c.args[0].input as any).Prefix);
const getKeys = () => s3.commandCalls(GetObjectCommand).map((c) => (c.args[0].input as any).Key);

const multipart = (csv: string) => {
  const boundary = 'XBOUNDARY';
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="c.csv"\r\n` +
    `Content-Type: text/csv\r\n\r\n` +
    `${csv}\r\n` +
    `--${boundary}--\r\n`;
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
};

beforeEach(() => {
  s3.reset();
  process.env.ADMIN_API_KEY = KEY;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('escritura con agente y campaña normalizados', () => {
  it('uploadAgentContacts (pendiente) escribe assignments/ e historic/ en minúsculas', async () => {
    installMemS3(s3);
    const res = await uploadAgentContacts(ev(spaced, JSON.stringify({ csv: CSV, message: 'Hola' })));
    expect(res.statusCode).toBe(200);
    const keys = putKeys();
    expect(keys[0]).toMatch(/^assignments\/agents\/prueba\/erick-contacts-[0-9TZ-]+\.csv$/);
    expect(keys[1]).toMatch(/^historic\/agents\/prueba\/erick-contacts-[0-9TZ-]+\.csv$/);
    const { data } = JSON.parse(res.body);
    expect(data).toMatchObject({ agent: 'erick', campaign: 'prueba', key: keys[0], historic_key: keys[1] });
  });

  it('uploadAgentContacts (direct) escribe agents/ en minúsculas', async () => {
    installMemS3(s3);
    const res = await uploadAgentContacts(ev(spaced, JSON.stringify({ csv: CSV, message: 'Hola', direct: true })));
    expect(res.statusCode).toBe(200);
    expect(putKeys()[0]).toMatch(/^agents\/prueba\/erick-contacts-[0-9TZ-]+\.csv$/);
  });

  it('publishAgentContactsDeprecated escribe agents/ en minúsculas', async () => {
    installMemS3(s3);
    const mp = multipart(CSV);
    const res = await publishAgentContactsDeprecated(ev(spaced, mp.body, mp.headers));
    expect(res.statusCode).toBe(200);
    expect(putKeys()[0]).toMatch(/^agents\/prueba\/erick-contacts-[0-9TZ-]+\.csv$/);
    expect(JSON.parse(res.body).data).toMatchObject({ agent: 'erick', campaign: 'prueba' });
  });

  it('uploadAgentContactsLogging escribe logging/ en minúsculas', async () => {
    installMemS3(s3);
    const res = await uploadAgentContactsLogging(
      ev(spaced, JSON.stringify({ csv: CSV, message: 'Hola', metadata: 'm' }))
    );
    expect(res.statusCode).toBe(200);
    expect(putKeys()).toEqual(['logging/prueba/erick-contacts.csv']);
  });
});

describe('lectura con agente y campaña normalizados', () => {
  const objects = {
    'agents/prueba/erick-contacts-2026-01-01T00-00-00-000Z.csv': { body: 'nuevo', lastModified: new Date('2026-01-01') },
    'agents/prueba/Erick-contacts-2026-02-01T00-00-00-000Z.csv': { body: 'heredado', lastModified: new Date('2026-02-01') },
    'assignments/agents/prueba/erick-contacts-2026-01-01T00-00-00-000Z.csv': { body: 'pend', lastModified: new Date('2026-01-01') },
    'assignments/agents/prueba/Erick-contacts-2026-02-01T00-00-00-000Z.csv': { body: 'pend-her', lastModified: new Date('2026-02-01') },
  };

  it('getAgentContacts lee agents/prueba/ e ignora Erick-contacts heredado', async () => {
    installMemS3(s3, objects);
    const res = await getAgentContacts(ev(spaced));
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('nuevo');
    expect(listPrefixes()).toEqual(['agents/prueba/']);
  });

  it('listAgentAssignments con ERICK/PRUEBA lista solo erick-contacts y devuelve valores normalizados', async () => {
    installMemS3(s3, objects);
    const res = await listAgentAssignments(ev({ agent: 'ERICK', campaign: 'PRUEBA' }));
    expect(res.statusCode).toBe(200);
    const { data } = JSON.parse(res.body);
    expect(data).toMatchObject({ agent: 'erick', campaign: 'prueba', prefix: 'assignments/agents/prueba/' });
    expect(data.items.map((i: any) => i.key)).toEqual([
      'assignments/agents/prueba/erick-contacts-2026-01-01T00-00-00-000Z.csv',
    ]);
  });

  it('getAgentAssignments lee el archivo erick-contacts en minúsculas', async () => {
    installMemS3(s3, objects);
    const res = await getAgentAssignments(ev(spaced));
    expect(res.statusCode).toBe(200);
    expect(listPrefixes()).toEqual(['assignments/agents/prueba/']);
    expect(getKeys()).toEqual(['assignments/agents/prueba/erick-contacts-2026-01-01T00-00-00-000Z.csv']);
  });
});

describe('agente o campaña vacíos tras normalizar', () => {
  const handlers = {
    uploadAgentContacts,
    publishAgentContactsDeprecated,
    uploadAgentContactsLogging,
    getAgentContacts,
    listAgentAssignments,
    getAgentAssignments,
  };
  const cases = [
    { agent: '%20', campaign: 'prueba' },
    { agent: 'erick', campaign: '%20' },
    { agent: '   ', campaign: 'prueba' },
  ];

  it.each(Object.entries(handlers))('%s responde 400 sin tocar S3', async (_n, handler) => {
    for (const path of cases) {
      const res = await handler(ev(path, JSON.stringify({ csv: CSV, message: 'Hola', metadata: 'm' })));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toBe('Agente y campaña son requeridos');
    }
    expect(s3.calls()).toHaveLength(0);
  });
});
