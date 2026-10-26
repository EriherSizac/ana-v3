import { mockClient } from 'aws-sdk-client-mock';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updatePendingContacts } from '../src/handlers/contacts';
import { installMemS3 } from './helpers/memS3';
import { derivedList } from './helpers/admin';
import { bearer, captureAuthLogs, setupAgentAuth, signIdToken } from './helpers/agentJwt';

const s3 = mockClient(S3Client);
let out: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  s3.reset();
  installMemS3(s3, { 'campaign-agents/prueba.json': derivedList('prueba', ['erick', 'ana']) });
  out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});
afterEach(() => vi.restoreAllMocks());

const ev = (headers: Record<string, string>, body: unknown) => ({ headers, body: JSON.stringify(body) }) as unknown as APIGatewayProxyEvent;
const body = { campaign: 'prueba', agent_id: 'erick', contacts: [{ contact_phone: '1' }] };

describe('POST /contacts/pending', () => {
  it('estricto sin token → 401 sin PutObject', async () => {
    setupAgentAuth({ enforced: true });
    expect((await updatePendingContacts(ev({}, body))).statusCode).toBe(401);
    expect(s3.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it('estricto: token de ana con agent_id erick → 403 sin sobrescribir', async () => {
    setupAgentAuth({ enforced: true });
    const res = await updatePendingContacts(ev(bearer(signIdToken({ 'cognito:username': 'ana' })), body));
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'Forbidden' });
    expect(s3.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it('estricto: campaña fuera del roster → 403', async () => {
    setupAgentAuth({ enforced: true });
    expect((await updatePendingContacts(ev(bearer(signIdToken()), { ...body, campaign: 'ventas' }))).statusCode).toBe(403);
    expect(s3.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it('estricto: token válido → 200', async () => {
    setupAgentAuth({ enforced: true });
    const res = await updatePendingContacts(ev(bearer(signIdToken()), body));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).remainingContacts).toBe(1);
  });

  it('validaciones 400 antes de autenticar (no tocan S3)', async () => {
    setupAgentAuth({ enforced: true });
    expect((await updatePendingContacts(ev({}, { campaign: 'prueba' }))).statusCode).toBe(400);
    expect(s3.calls()).toHaveLength(0);
  });

  it('reporte sin token → 200 con log missing', async () => {
    setupAgentAuth({ enforced: false });
    expect((await updatePendingContacts(ev({}, body))).statusCode).toBe(200);
    expect(captureAuthLogs(out)[0]).toMatchObject({ reason: 'missing', route: 'POST /contacts/pending' });
  });
});
