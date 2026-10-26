import { mockClient } from 'aws-sdk-client-mock';
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTemplates, putTemplate } from '../src/handlers/templates';
import { installMemS3 } from './helpers/memS3';
import { derivedList } from './helpers/admin';
import { bearer, setupAgentAuth, signIdToken } from './helpers/agentJwt';

const s3 = mockClient(S3Client);

beforeEach(() => {
  s3.reset();
  installMemS3(s3, {
    'campaign-agents/prueba.json': derivedList('prueba', ['erick']),
    'templates/prueba/whatsapp/hola.txt': 'Hola {{nombre}}',
  });
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  setupAgentAuth({ enforced: true });
});
afterEach(() => vi.restoreAllMocks());

const ev = (headers: Record<string, string>, q: Record<string, string>) =>
  ({ headers, queryStringParameters: q }) as unknown as APIGatewayProxyEvent;
const templateCalls = () =>
  [...s3.commandCalls(GetObjectCommand), ...s3.commandCalls(ListObjectsV2Command)].filter((c) =>
    String((c.args[0].input as any).Key ?? (c.args[0].input as any).Prefix ?? '').startsWith('templates/'),
  );

describe('GET /templates (estricto)', () => {
  it('campaña fuera del roster → 403 sin listar ni leer (también con key)', async () => {
    const token = bearer(signIdToken());
    expect((await getTemplates(ev(token, { campaign: 'ventas', channel: 'whatsapp' }))).statusCode).toBe(403);
    expect(
      (await getTemplates(ev(token, { campaign: 'ventas', channel: 'whatsapp', key: 'templates/prueba/whatsapp/hola.txt' }))).statusCode,
    ).toBe(403);
    expect(templateCalls()).toHaveLength(0);
  });

  it('sin token → 401 sin S3', async () => {
    expect((await getTemplates(ev({}, { campaign: 'prueba', channel: 'whatsapp' }))).statusCode).toBe(401);
    expect(s3.calls()).toHaveLength(0);
  });

  it('habilitado → 200 con la lista', async () => {
    const res = await getTemplates(ev(bearer(signIdToken()), { campaign: 'prueba', channel: 'whatsapp' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ files: [{ key: 'templates/prueba/whatsapp/hola.txt', filename: 'hola.txt' }] });
  });

  it('faltan parámetros → 400', async () => {
    expect((await getTemplates(ev({}, { campaign: 'prueba' }))).statusCode).toBe(400);
  });
});

describe('POST /templates sigue exigiendo solo X-Admin-Key', () => {
  it('token de agente sin llave → 401; con llave → 200', async () => {
    process.env.ADMIN_API_KEY = 'k';
    const body = JSON.stringify({ campaign: 'prueba', channel: 'whatsapp', filename: 'x', content: 'hola' });
    expect((await putTemplate({ headers: bearer(signIdToken()), body } as unknown as APIGatewayProxyEvent)).statusCode).toBe(401);
    expect(s3.commandCalls(PutObjectCommand)).toHaveLength(0);
    expect((await putTemplate({ headers: { 'X-Admin-Key': 'k' }, body } as unknown as APIGatewayProxyEvent)).statusCode).toBe(200);
  });
});
