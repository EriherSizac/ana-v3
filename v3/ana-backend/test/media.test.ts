import { mockClient } from 'aws-sdk-client-mock';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadMedia } from '../src/handlers/media';
import { installMemS3 } from './helpers/memS3';
import { derivedList } from './helpers/admin';
import { bearer, setupAgentAuth, signIdToken } from './helpers/agentJwt';

const s3 = mockClient(S3Client);

beforeEach(() => {
  s3.reset();
  installMemS3(s3, { 'campaign-agents/prueba.json': derivedList('prueba', ['erick']) });
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  setupAgentAuth({ enforced: true });
});
afterEach(() => vi.restoreAllMocks());

const ev = (headers: Record<string, string>, body: unknown) => ({ headers, body: JSON.stringify(body) }) as unknown as APIGatewayProxyEvent;
const body = { campaign: 'prueba', agent_id: 'erick', filename: 'a.jpg', content_type: 'image/jpeg', data: Buffer.from('img').toString('base64') };

describe('POST /media (estricto)', () => {
  it('sin token → 401 sin escribir', async () => {
    expect((await uploadMedia(ev({}, body))).statusCode).toBe(401);
    expect(s3.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it('otro agente → 403; campaña fuera del roster → 403', async () => {
    expect((await uploadMedia(ev(bearer(signIdToken({ 'cognito:username': 'ana' })), body))).statusCode).toBe(403);
    expect((await uploadMedia(ev(bearer(signIdToken()), { ...body, campaign: 'ventas' }))).statusCode).toBe(403);
    expect(s3.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it('dueño → 200; el 400 se conserva', async () => {
    const res = await uploadMedia(ev(bearer(signIdToken()), body));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).path).toBe('media/prueba/erick/a.jpg');
    expect((await uploadMedia(ev(bearer(signIdToken()), { ...body, data: undefined }))).statusCode).toBe(400);
  });
});
