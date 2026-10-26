import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  getCampaignCredentials,
  uploadCampaignCredentials,
  regenerateDailyPasswords,
} from '../src/handlers/credentials';
import { verifyCredentials } from '../src/handlers/auth';
import { installMemS3 } from './helpers/memS3';

const s3 = mockClient(S3Client);
const KEY = 'test-admin-key';
const admin = { 'X-Admin-Key': KEY };

const ev = (opts: { body?: unknown; path?: Record<string, string>; headers?: Record<string, string> }) =>
  ({
    headers: opts.headers ?? admin,
    pathParameters: opts.path ?? null,
    body: opts.body === undefined ? null : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
  }) as unknown as APIGatewayProxyEvent;

const keysOf = (cmd: any) => s3.commandCalls(cmd).map((c) => (c.args[0].input as any).Key);

beforeEach(() => {
  s3.reset();
  process.env.ADMIN_API_KEY = KEY;
});

describe('normalización de campaña en credenciales', () => {
  it('upload con " Prueba " escribe agents/prueba/credentials.csv y devuelve la campaña normalizada', async () => {
    const store = installMemS3(s3);
    const csv = 'user,dailyPassword\nErick,frase-1';
    const res = await uploadCampaignCredentials(ev({ body: { campaign: ' Prueba ', csv } }));
    expect(res.statusCode).toBe(200);
    const { data } = JSON.parse(res.body);
    expect(data.campaign).toBe('prueba');
    expect(data.key).toBe('agents/prueba/credentials.csv');
    expect(data.usersCount).toBe(1);
    expect(keysOf(PutObjectCommand)).toEqual(['agents/prueba/credentials.csv']);
    // La columna user se guarda tal cual.
    expect(store.get('agents/prueba/credentials.csv')!.body).toBe(csv);
  });

  it('GET /credentials/PRUEBA lee la llave en minúsculas', async () => {
    installMemS3(s3, { 'agents/prueba/credentials.csv': 'user,dailyPassword\nerick,x' });
    const res = await getCampaignCredentials(ev({ path: { campaign: 'PRUEBA' } }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('user,dailyPassword\nerick,x');
    expect(keysOf(GetObjectCommand)).toEqual(['agents/prueba/credentials.csv']);
  });

  it('regenerate con " Prueba " opera sobre agents/prueba/credentials.csv', async () => {
    installMemS3(s3, { 'agents/prueba/credentials.csv': 'user,dailyPassword\nErick,vieja' });
    const res = await regenerateDailyPasswords(ev({ body: { campaign: ' Prueba ' } }));
    expect(res.statusCode).toBe(200);
    const { data } = JSON.parse(res.body);
    expect(data.campaign).toBe('prueba');
    expect(data.updates[0].user).toBe('Erick');
    expect(keysOf(GetObjectCommand)).toEqual(['agents/prueba/credentials.csv']);
    expect(keysOf(PutObjectCommand)).toEqual(['agents/prueba/credentials.csv']);
  });

  it('campaña solo con espacios responde 400 sin tocar S3', async () => {
    const up = await uploadCampaignCredentials(ev({ body: { campaign: '   ', csv: 'user,dailyPassword\na,b' } }));
    expect(up.statusCode).toBe(400);
    expect(JSON.parse(up.body).message).toBe('Campaña y CSV son requeridos');

    const regen = await regenerateDailyPasswords(ev({ body: { campaign: '   ' } }));
    expect(regen.statusCode).toBe(400);
    expect(JSON.parse(regen.body).message).toBe('Campaña requerida');

    const get = await getCampaignCredentials(ev({ path: { campaign: ' ' } }));
    expect(get.statusCode).toBe(400);
    expect(JSON.parse(get.body).message).toBe('Campaña requerida');

    expect(s3.calls()).toHaveLength(0);
  });
});

describe('contratos existentes', () => {
  const handlers = {
    getCampaignCredentials: () => ev({ path: { campaign: 'prueba' }, headers: {} }),
    uploadCampaignCredentials: () => ev({ body: { campaign: 'prueba', csv: 'user,dailyPassword' }, headers: {} }),
    regenerateDailyPasswords: () => ev({ body: { campaign: 'prueba' }, headers: {} }),
  };
  const fns = { getCampaignCredentials, uploadCampaignCredentials, regenerateDailyPasswords } as const;

  it.each(Object.keys(handlers) as (keyof typeof handlers)[])('%s: 401 sin llave y 503 sin configurar, sin tocar S3', async (name) => {
    const res = await fns[name](handlers[name]());
    expect(res.statusCode).toBe(401);
    process.env.ADMIN_API_KEY = '';
    const res2 = await fns[name]({ ...handlers[name](), headers: admin } as any);
    expect(res2.statusCode).toBe(503);
    expect(s3.calls()).toHaveLength(0);
  });

  it('GET responde 404 si la campaña no tiene credenciales', async () => {
    installMemS3(s3);
    const res = await getCampaignCredentials(ev({ path: { campaign: 'prueba' } }));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).message).toBe('Campaña sin credenciales; súbelas con POST /credentials/upload');
  });

  it('regenerate responde 404 si no existe el CSV', async () => {
    installMemS3(s3);
    const res = await regenerateDailyPasswords(ev({ body: { campaign: 'prueba' } }));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).message).toBe('CSV de credenciales no encontrado');
  });

  it('upload responde 400 con encabezado inválido', async () => {
    installMemS3(s3);
    const res = await uploadCampaignCredentials(ev({ body: { campaign: 'prueba', csv: 'usuario,clave\na,b' } }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toBe('CSV debe tener columnas: user,dailyPassword');
    expect(s3.commandCalls(PutObjectCommand)).toHaveLength(0);
  });
});

describe('integración carga + verificación', () => {
  it('upload con "Prueba" y verify con "prueba" → 200', async () => {
    installMemS3(s3);
    const up = await uploadCampaignCredentials(
      ev({ body: { campaign: 'Prueba', csv: 'user,dailyPassword\nErick,frase-1234' } })
    );
    expect(up.statusCode).toBe(200);
    const res = await verifyCredentials(
      ev({ body: { user: 'erick', campaign: 'prueba', dailyPassword: 'frase-1234' }, headers: {} })
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data).toMatchObject({ user: 'erick', campaign: 'prueba' });
  });
});
