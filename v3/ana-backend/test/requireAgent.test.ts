import { mockClient } from 'aws-sdk-client-mock';
import { S3Client } from '@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAgent, requireAgentToken } from '../src/lib/agentAuth';
import { installCondS3, type CondS3 } from './helpers/condS3';
import { derivedList } from './helpers/admin';
import { OTHER_CLIENT, bearer, captureAuthLogs, setupAgentAuth, signIdToken } from './helpers/agentJwt';

const s3mock = mockClient(S3Client);
let s3: CondS3;
let out: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  s3mock.reset();
  process.env.BUCKET_NAME = 'ana-backend-storage-test';
  s3 = installCondS3(s3mock);
  s3.set('campaign-agents/prueba.json', derivedList('prueba', ['erick', 'luis']));
  s3.set(
    'rosters/prueba.json',
    JSON.stringify({ schemaVersion: 2, campaign: 'prueba', updatedAt: null, updatedBy: null, overrides: { luis: { enabled: false, updatedAt: 'x', updatedBy: 'l' } } }),
  );
  s3.set('campaign-agents/vieja.json', derivedList('vieja', ['erick'], new Date(Date.now() - 48 * 3600_000).toISOString()));
  out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.AGENT_AUTH_ENFORCED;
});

const past = () => Math.floor(Date.now() / 1000) - 7200;

/** Casos por motivo: [motivo, headers, agente, campaña, status estricto]. */
const cases = (): Array<[string, Record<string, string>, string, string, number | null]> => [
  ['ok', bearer(signIdToken()), 'erick', 'prueba', null],
  ['missing', {}, 'erick', 'prueba', 401],
  ['invalid', bearer('xxx.yyy.zzz'), 'erick', 'prueba', 401],
  ['expired', bearer(signIdToken({ iat: past(), exp: past() + 3600 })), 'erick', 'prueba', 401],
  ['wrong_client', bearer(signIdToken({ aud: OTHER_CLIENT })), 'erick', 'prueba', 401],
  ['mismatch', bearer(signIdToken()), 'ana', 'prueba', 403],
  ['not_in_roster', bearer(signIdToken({ 'cognito:username': 'luis' })), 'luis', 'prueba', 403],
  ['roster_error', bearer(signIdToken()), 'erick', 'vieja', 403],
];

describe('requireAgent en modo reporte', () => {
  beforeEach(() => setupAgentAuth({ enforced: false }));

  it.each(cases())('%s → continúa y registra el motivo', async (reason, headers, agent, campaign) => {
    const res = await requireAgent({ headers }, { route: 'POST /backups', agent, campaign });
    expect(res).toBeNull();
    const [log] = captureAuthLogs(out);
    expect(log).toMatchObject({ evt: 'agent_auth', mode: 'report', route: 'POST /backups', reason, agent, campaign, cliVersion: 'unknown' });
  });

  it('CLI antiguo sin token: log missing con agente y campaña del body', async () => {
    await requireAgent({ headers: { 'content-type': 'application/json' } }, { route: 'POST /backups', agent: 'Erick', campaign: 'Prueba' });
    expect(captureAuthLogs(out)).toEqual([
      { evt: 'agent_auth', mode: 'report', route: 'POST /backups', reason: 'missing', agent: 'erick', campaign: 'prueba', user: null, cliVersion: 'unknown' },
    ]);
  });

  it('registra la versión del CLI y el usuario del token', async () => {
    await requireAgent({ headers: bearer(signIdToken(), { 'X-Ana-Cli-Version': '1.0.47' }) }, { route: 'GET /get/chats', agent: 'erick', campaign: 'prueba' });
    expect(captureAuthLogs(out)[0]).toMatchObject({ reason: 'ok', user: 'erick', cliVersion: '1.0.47' });
  });

  it('versión del CLI con caracteres raros → unknown', async () => {
    await requireAgent({ headers: { 'x-ana-cli-version': '1.0 "}\n' } }, { route: 'GET /get/chats', agent: 'erick', campaign: 'prueba' });
    expect(captureAuthLogs(out)[0].cliVersion).toBe('unknown');
  });

  it('sin configuración en reporte: continúa', async () => {
    setupAgentAuth({ enforced: false, clients: '' });
    expect(await requireAgent({ headers: bearer(signIdToken()) }, { route: 'POST /media', agent: 'erick', campaign: 'prueba' })).toBeNull();
    expect(captureAuthLogs(out)[0]).toMatchObject({ reason: 'invalid', config: 'missing' });
  });
});

describe('requireAgent en modo estricto', () => {
  beforeEach(() => setupAgentAuth({ enforced: true }));

  it.each(cases())('%s → status estricto', async (reason, headers, agent, campaign, status) => {
    const res = await requireAgent({ headers }, { route: 'GET /get/chats', agent, campaign });
    if (status === null) {
      expect(res).toBeNull();
    } else {
      expect(res?.statusCode).toBe(status);
      expect(JSON.parse(res!.body)).toEqual({ error: status === 401 ? 'Unauthorized' : 'Forbidden' });
      expect(res?.headers['Content-Type']).toBe('application/json');
    }
    expect(captureAuthLogs(out)[0]).toMatchObject({ mode: 'strict', reason });
  });

  it('X-Admin-Key sola cuenta como missing', async () => {
    process.env.ADMIN_API_KEY = 'k';
    const res = await requireAgent({ headers: { 'X-Admin-Key': 'k' } }, { route: 'GET /get/chats', agent: 'erick', campaign: 'prueba' });
    expect(res?.statusCode).toBe(401);
    expect(captureAuthLogs(out)[0].reason).toBe('missing');
  });

  it.each([
    ['sin COGNITO_USER_POOL_ID', { pool: '' }],
    ['sin COGNITO_AGENT_CLIENT_IDS', { clients: '' }],
  ])('503 %s, sin importar el header', async (_n, cfg) => {
    setupAgentAuth({ enforced: true, ...cfg });
    for (const headers of [{}, bearer(signIdToken())]) {
      const res = await requireAgent({ headers }, { route: 'GET /get/chats', agent: 'erick', campaign: 'prueba' });
      expect(res?.statusCode).toBe(503);
      expect(JSON.parse(res!.body)).toEqual({ error: 'Agent auth not configured' });
    }
    expect(s3mock.calls()).toHaveLength(0);
  });

  it('401 sin tocar S3', async () => {
    await requireAgent({ headers: {} }, { route: 'GET /get/chats', agent: 'erick', campaign: 'prueba' });
    expect(s3mock.calls()).toHaveLength(0);
  });
});

describe('requireAgentToken (/agent/*)', () => {
  it('sin token en modo reporte → 401', async () => {
    setupAgentAuth({ enforced: false });
    const r = await requireAgentToken({ headers: {} }, 'GET /agent/campaigns');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.statusCode).toBe(401);
    expect(captureAuthLogs(out)[0]).toMatchObject({ mode: 'strict', reason: 'missing', route: 'GET /agent/campaigns' });
  });

  it('token válido → username normalizado', async () => {
    setupAgentAuth({ enforced: false });
    expect(await requireAgentToken({ headers: bearer(signIdToken({ 'cognito:username': 'Erick' })) }, 'GET /agent/settings')).toEqual({ ok: true, username: 'erick' });
  });

  it('sin configuración → 503', async () => {
    setupAgentAuth({ enforced: false, clients: '' });
    const r = await requireAgentToken({ headers: bearer(signIdToken()) }, 'GET /agent/settings');
    expect(!r.ok && r.response.statusCode).toBe(503);
  });
});

describe('logs sin token', () => {
  it('ninguna línea (stdout ni console) contiene el token', async () => {
    const log = vi.spyOn(console, 'log');
    const err = vi.spyOn(console, 'error');
    const tokens = [signIdToken(), signIdToken({ aud: OTHER_CLIENT }), signIdToken({}, { wrongKey: true })];
    for (const enforced of [false, true]) {
      setupAgentAuth({ enforced });
      for (const t of tokens) {
        await requireAgent({ headers: bearer(t) }, { route: 'POST /backups/chat', agent: 'erick', campaign: 'prueba' });
        await requireAgentToken({ headers: bearer(t) }, 'GET /agent/campaigns');
      }
    }
    const all = [...out.mock.calls, ...log.mock.calls, ...err.mock.calls].map((c) => c.map(String).join(' ')).join('\n');
    expect(all.length).toBeGreaterThan(0);
    for (const t of tokens) {
      expect(all).not.toContain(t);
      expect(all).not.toContain(t.split('.')[2]);
    }
    expect(all).not.toMatch(/Bearer/i);
  });
});
