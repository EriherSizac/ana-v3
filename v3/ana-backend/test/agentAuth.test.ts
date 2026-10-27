import { mockClient } from 'aws-sdk-client-mock';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateAgent, verifyAgentToken } from '../src/lib/agentAuth';
import { installCondS3, type CondS3 } from './helpers/condS3';
import { derivedList, derivedMembers } from './helpers/admin';
import { ISSUER, OTHER_CLIENT, bearer, setupAgentAuth, signIdToken } from './helpers/agentJwt';

const s3mock = mockClient(S3Client);
let s3: CondS3;

beforeEach(() => {
  s3mock.reset();
  process.env.BUCKET_NAME = 'ana-backend-storage-test';
  s3 = installCondS3(s3mock);
  setupAgentAuth();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const ev = (headers: Record<string, string>) => ({ headers });

describe('verificación del ID token (D4)', () => {
  it('token válido', async () => {
    const r = await verifyAgentToken(ev(bearer(signIdToken())));
    expect(r).toEqual({ ok: true, identity: { username: 'erick' } });
  });

  it('vencido → expired', async () => {
    const past = Math.floor(Date.now() / 1000) - 7200;
    const r = await verifyAgentToken(ev(bearer(signIdToken({ iat: past, exp: past + 3600 }))));
    expect(r).toEqual({ ok: false, reason: 'expired' });
  });

  it('firma alterada → invalid', async () => {
    const r = await verifyAgentToken(ev(bearer(signIdToken({}, { wrongKey: true }))));
    expect(r).toEqual({ ok: false, reason: 'invalid' });
  });

  it('payload modificado sin volver a firmar → invalid', async () => {
    const [h, , s] = signIdToken().split('.');
    const forged = Buffer.from(JSON.stringify({ iss: ISSUER, aud: 'cli-client-test', token_use: 'id', exp: 9999999999, 'cognito:username': 'ana' })).toString('base64url');
    const r = await verifyAgentToken(ev(bearer(`${h}.${forged}.${s}`)));
    expect(r).toEqual({ ok: false, reason: 'invalid' });
  });

  it('token_use=access → invalid', async () => {
    const r = await verifyAgentToken(ev(bearer(signIdToken({ token_use: 'access', aud: undefined, client_id: 'cli-client-test' }))));
    expect(r).toEqual({ ok: false, reason: 'invalid' });
  });

  it('aud fuera de la lista → wrong_client', async () => {
    const r = await verifyAgentToken(ev(bearer(signIdToken({ aud: OTHER_CLIENT }))));
    expect(r).toEqual({ ok: false, reason: 'wrong_client' });
  });

  it('aud en una lista de varios clients', async () => {
    setupAgentAuth({ clients: `cli-client-test, ${OTHER_CLIENT}` });
    const r = await verifyAgentToken(ev(bearer(signIdToken({ aud: OTHER_CLIENT }))));
    expect(r.ok).toBe(true);
  });

  it('otro emisor → invalid', async () => {
    const r = await verifyAgentToken(ev(bearer(signIdToken({ iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Otro' }))));
    expect(r).toEqual({ ok: false, reason: 'invalid' });
  });

  it('header sin Bearer → missing', async () => {
    expect(await verifyAgentToken(ev({ authorization: signIdToken() }))).toEqual({ ok: false, reason: 'missing' });
    expect(await verifyAgentToken(ev({ authorization: `Basic ${signIdToken()}` }))).toEqual({ ok: false, reason: 'missing' });
    expect(await verifyAgentToken(ev({}))).toEqual({ ok: false, reason: 'missing' });
  });

  it('nombre de header y esquema sin distinguir mayúsculas', async () => {
    expect((await verifyAgentToken(ev({ Authorization: `Bearer ${signIdToken()}` }))).ok).toBe(true);
    expect((await verifyAgentToken(ev({ AUTHORIZATION: `bearer ${signIdToken()}` }))).ok).toBe(true);
  });

  it('formato no reconocido → invalid', async () => {
    expect(await verifyAgentToken(ev(bearer('no-es-un-jwt')))).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('propiedad y roster (D5)', () => {
  const route = 'GET /get/chats';

  it('supervisora derivada sin excepción → ok (add-supervisor-contact-access)', async () => {
    s3.set('campaign-agents/prueba.json', derivedMembers('prueba', [['sara', 'supervisor']]));
    const r = await evaluateAgent(ev(bearer(signIdToken({ 'cognito:username': 'sara' }))), { route, agent: 'sara', campaign: 'prueba' });
    expect(r).toEqual({ reason: 'ok', user: 'sara' });
  });

  it('supervisora deshabilitada → not_in_roster', async () => {
    s3.set('campaign-agents/prueba.json', derivedMembers('prueba', [['sara', 'supervisor']]));
    s3.set(
      'rosters/prueba.json',
      JSON.stringify({ schemaVersion: 2, campaign: 'prueba', updatedAt: null, updatedBy: null, overrides: { sara: { enabled: false, updatedAt: 'x', updatedBy: 'lider' } } }),
    );
    const r = await evaluateAgent(ev(bearer(signIdToken({ 'cognito:username': 'sara' }))), { route, agent: 'sara', campaign: 'prueba' });
    expect(r.reason).toBe('not_in_roster');
  });

  it('Erick → erick: identidad normalizada y habilitado', async () => {
    s3.set('campaign-agents/prueba.json', derivedList('prueba', ['erick']));
    const r = await evaluateAgent(ev(bearer(signIdToken({ 'cognito:username': 'Erick' }))), { route, agent: ' ERICK ', campaign: 'Prueba' });
    expect(r).toEqual({ reason: 'ok', user: 'erick' });
  });

  it('agente ajeno → mismatch (sin leer roster)', async () => {
    s3.set('campaign-agents/prueba.json', derivedList('prueba', ['erick', 'ana']));
    const r = await evaluateAgent(ev(bearer(signIdToken())), { route, agent: 'ana', campaign: 'prueba' });
    expect(r).toEqual({ reason: 'mismatch', user: 'erick' });
    expect(s3mock.commandCalls(GetObjectCommand)).toHaveLength(0);
  });

  it('no derivado → not_in_roster', async () => {
    s3.set('campaign-agents/prueba.json', derivedList('prueba', ['ana']));
    const r = await evaluateAgent(ev(bearer(signIdToken())), { route, agent: 'erick', campaign: 'prueba' });
    expect(r.reason).toBe('not_in_roster');
  });

  it('campaña sin lista derivada → not_in_roster', async () => {
    const r = await evaluateAgent(ev(bearer(signIdToken())), { route, agent: 'erick', campaign: 'ventas' });
    expect(r.reason).toBe('not_in_roster');
  });

  it('derivado con enabled:false → not_in_roster', async () => {
    s3.set('campaign-agents/prueba.json', derivedList('prueba', ['erick']));
    s3.set(
      'rosters/prueba.json',
      JSON.stringify({ schemaVersion: 2, campaign: 'prueba', updatedAt: null, updatedBy: null, overrides: { erick: { enabled: false, updatedAt: 'x', updatedBy: 'lider' } } }),
    );
    const r = await evaluateAgent(ev(bearer(signIdToken())), { route, agent: 'erick', campaign: 'prueba' });
    expect(r.reason).toBe('not_in_roster');
  });

  it('lista vencida (> 24 h) → roster_error', async () => {
    s3.set('campaign-agents/prueba.json', derivedList('prueba', ['erick'], new Date(Date.now() - 25 * 3600_000).toISOString()));
    const r = await evaluateAgent(ev(bearer(signIdToken())), { route, agent: 'erick', campaign: 'prueba' });
    expect(r.reason).toBe('roster_error');
  });

  it('error de S3 → roster_error', async () => {
    s3mock.on(GetObjectCommand).rejects(Object.assign(new Error('AccessDenied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }));
    const r = await evaluateAgent(ev(bearer(signIdToken())), { route, agent: 'erick', campaign: 'prueba' });
    expect(r.reason).toBe('roster_error');
  });

  it('ruta sin agente (templates): solo roster de la campaña', async () => {
    s3.set('campaign-agents/prueba.json', derivedList('prueba', ['erick']));
    expect((await evaluateAgent(ev(bearer(signIdToken())), { route: 'GET /templates', campaign: 'prueba' })).reason).toBe('ok');
    expect((await evaluateAgent(ev(bearer(signIdToken())), { route: 'GET /templates', campaign: 'ventas' })).reason).toBe('not_in_roster');
  });

  it('la caché de 60 s retrasa una deshabilitación como máximo 60 s (reloj simulado)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T10:00:00Z'));
    s3.set('campaign-agents/prueba.json', derivedList('prueba', ['erick'], '2026-10-26T09:55:00Z'));
    const req = { route, agent: 'erick', campaign: 'prueba' };
    const token = signIdToken();
    expect((await evaluateAgent(ev(bearer(token)), req)).reason).toBe('ok');

    s3.set(
      'rosters/prueba.json',
      JSON.stringify({ schemaVersion: 2, campaign: 'prueba', updatedAt: null, updatedBy: null, overrides: { erick: { enabled: false, updatedAt: 'x', updatedBy: 'lider' } } }),
    );
    vi.setSystemTime(new Date('2026-10-26T10:00:59Z'));
    expect((await evaluateAgent(ev(bearer(token)), req)).reason).toBe('ok'); // caché vigente
    vi.setSystemTime(new Date('2026-10-26T10:01:01Z'));
    expect((await evaluateAgent(ev(bearer(token)), req)).reason).toBe('not_in_roster');
  });
});
