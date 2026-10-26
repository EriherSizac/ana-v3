import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { verifyCredentials } from '../src/handlers/auth';
import { installMemS3 } from './helpers/memS3';

const s3 = mockClient(S3Client);
const ev = (body: unknown) => ({ headers: {}, body: JSON.stringify(body) }) as unknown as APIGatewayProxyEvent;
const getKeys = () => s3.commandCalls(GetObjectCommand).map((c) => (c.args[0].input as any).Key);

beforeEach(() => s3.reset());

describe('POST /auth/verify normaliza la campaña', () => {
  it('" Prueba " lee agents/prueba/credentials.csv y responde campaign "prueba"', async () => {
    installMemS3(s3, { 'agents/prueba/credentials.csv': 'user,dailyPassword\nErick,frase-1' });
    const res = await verifyCredentials(ev({ user: 'Erick', campaign: ' Prueba ', dailyPassword: 'frase-1' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data).toMatchObject({ user: 'erick', campaign: 'prueba' });
    expect(getKeys()).toEqual(['agents/prueba/credentials.csv']);
  });

  it('usuario "Erick" en el CSV valida al usuario "erick"', async () => {
    installMemS3(s3, { 'agents/prueba/credentials.csv': 'user,dailyPassword\nErick,frase-1' });
    const res = await verifyCredentials(ev({ user: 'erick', campaign: 'prueba', dailyPassword: 'frase-1' }));
    expect(res.statusCode).toBe(200);
  });

  it('campaña solo con espacios responde 400 sin acceder a S3', async () => {
    const res = await verifyCredentials(ev({ user: 'erick', campaign: '   ', dailyPassword: 'x' }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      success: false,
      message: 'Usuario, campaña y palabra del día son requeridos',
    });
    expect(s3.calls()).toHaveLength(0);
  });

  it('con solo agents/Prueba/credentials.csv responde 401', async () => {
    installMemS3(s3, { 'agents/Prueba/credentials.csv': 'user,dailyPassword\nerick,frase-1' });
    const res = await verifyCredentials(ev({ user: 'erick', campaign: 'Prueba', dailyPassword: 'frase-1' }));
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).message).toBe('Campaña no encontrada o sin credenciales configuradas');
    expect(getKeys()).toEqual(['agents/prueba/credentials.csv']);
  });
});
