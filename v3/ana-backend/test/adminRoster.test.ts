import { mockClient } from 'aws-sdk-client-mock';
import { S3Client } from '@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRoster, updateRosterAgents } from '../src/handlers/adminRoster';
import { installCondS3, type CondS3 } from './helpers/condS3';
import { ADMIN, AGENT, LEADER_DIDI, LEADER_PRUEBA, adminEvent, derivedList, mockV4Me, parse } from './helpers/admin';

const s3mock = mockClient(S3Client);
let s3: CondS3;

beforeEach(() => {
  s3mock.reset();
  process.env.BUCKET_NAME = 'ana-backend-storage-test';
  s3 = installCondS3(s3mock);
  s3.set('campaign-agents/prueba.json', derivedList('prueba', ['ana.lopez', 'luis'], '2026-10-26T09:55:00.000Z'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const s3Calls = () => s3mock.calls().length;

describe('GET /admin/campaigns/{campaign}/roster', () => {
  it('campaña con una excepción', async () => {
    mockV4Me(ADMIN);
    s3.set(
      'rosters/prueba.json',
      JSON.stringify({
        schemaVersion: 2,
        campaign: 'prueba',
        updatedAt: 'x',
        updatedBy: 'erick.silva',
        overrides: { luis: { enabled: false, updatedAt: '2026-10-25T00:00:00Z', updatedBy: 'erick.silva' } },
      }),
    );
    const res = await getRoster(adminEvent({ path: { campaign: 'PRUEBA' } }));
    expect(res.statusCode).toBe(200);
    expect(parse(res)).toEqual({
      success: true,
      data: {
        campaign: 'prueba',
        generatedAt: '2026-10-26T09:55:00.000Z',
        agents: [
          { username: 'ana.lopez', enabled: true, override: null },
          { username: 'luis', enabled: false, override: { enabled: false, updatedAt: '2026-10-25T00:00:00Z', updatedBy: 'erick.silva' } },
        ],
        inactiveOverrides: [],
      },
    });
  });

  it('lista ilegible → 500 "Roster ilegible" sin modificar', async () => {
    mockV4Me(ADMIN);
    s3.set('campaign-agents/prueba.json', '{roto');
    const res = await getRoster(adminEvent({ path: { campaign: 'prueba' } }));
    expect(res.statusCode).toBe(500);
    expect(parse(res)).toEqual({ success: false, message: 'Roster ilegible' });
    expect(s3.puts).toHaveLength(0);
  });

  it('campaña con barra → 400 sin S3 ni v4', async () => {
    const fetch = mockV4Me(ADMIN);
    const res = await getRoster(adminEvent({ path: { campaign: 'ventas/norte' } }));
    expect(res.statusCode).toBe(400);
    expect(parse(res)).toEqual({ success: false, message: 'Campaña inválida' });
    expect(s3Calls()).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('v4 caído → 503 sin S3', async () => {
    mockV4Me('down');
    const res = await getRoster(adminEvent({ path: { campaign: 'prueba' } }));
    expect(res.statusCode).toBe(503);
    expect(s3Calls()).toBe(0);
  });

  it('S3 AccessDenied → 500 genérico sin campo error', async () => {
    mockV4Me(ADMIN);
    s3mock.reset();
    s3mock.onAnyCommand().rejects(Object.assign(new Error('Access Denied arn:aws:s3:::secret'), { name: 'AccessDenied' }));
    const res = await getRoster(adminEvent({ path: { campaign: 'prueba' } }));
    expect(res.statusCode).toBe(500);
    expect(parse(res)).toEqual({ success: false, message: 'Error interno del servidor' });
  });
});

describe('POST /admin/campaigns/{campaign}/roster/agents', () => {
  it('deshabilitar y rehabilitar: queda habilitada con updatedBy del último cambio', async () => {
    mockV4Me(LEADER_PRUEBA);
    const ev = (enabled: boolean, username: string) =>
      adminEvent({ username, path: { campaign: 'prueba' }, body: { agents: [{ username: ' Ana.Lopez ', enabled }] } });
    const r1 = await updateRosterAgents(ev(false, 'Erick.Silva'));
    expect(r1.statusCode).toBe(200);
    expect(parse(r1).data.agents[0]).toMatchObject({ username: 'ana.lopez', enabled: false });
    mockV4Me(LEADER_PRUEBA);
    const r2 = await updateRosterAgents(ev(true, 'otro.lider'));
    expect(parse(r2).data.agents[0]).toMatchObject({ username: 'ana.lopez', enabled: true, override: { enabled: true, updatedBy: 'otro.lider' } });
    expect(s3.json('rosters/prueba.json').overrides['ana.lopez'].updatedBy).toBe('otro.lider');
  });

  it('habilitar a quien no es agente → 409 con la lista, sin escribir', async () => {
    mockV4Me(ADMIN);
    s3.set('campaign-agents/prueba.json', derivedList('prueba', ['ana.lopez']));
    const res = await updateRosterAgents(adminEvent({ path: { campaign: 'prueba' }, body: { agents: [{ username: 'luis', enabled: true }] } }));
    expect(res.statusCode).toBe(409);
    expect(parse(res)).toEqual({ success: false, message: 'No es agente de la campaña', data: { agents: ['luis'] } });
    expect(s3.puts).toHaveLength(0);
  });

  it.each([
    ['no JSON', { rawBody: '{no' }],
    ['agents vacío', { body: { agents: [] } }],
    ['más de 200', { body: { agents: Array.from({ length: 201 }, (_, i) => ({ username: `u${i}`, enabled: false })) } }],
    ['repetido tras normalizar', { body: { agents: [{ username: 'Ana', enabled: false }, { username: 'ana ', enabled: true }] } }],
    ['enabled no booleano', { body: { agents: [{ username: 'ana', enabled: 'false' }] } }],
    ['username inválido', { body: { agents: [{ username: 'a/b', enabled: false }] } }],
  ])('body inválido (%s) → 400 sin escribir', async (_n, extra) => {
    mockV4Me(ADMIN);
    const res = await updateRosterAgents(adminEvent({ path: { campaign: 'prueba' }, ...(extra as object) }));
    expect(res.statusCode).toBe(400);
    expect(parse(res).success).toBe(false);
    expect(typeof parse(res).message).toBe('string');
    expect(s3.puts).toHaveLength(0);
  });

  it('líder de otra campaña → 403 sin S3', async () => {
    mockV4Me(LEADER_DIDI);
    const res = await updateRosterAgents(adminEvent({ path: { campaign: 'zendere' }, body: { agents: [{ username: 'a', enabled: false }] } }));
    expect(res.statusCode).toBe(403);
    expect(parse(res)).toEqual({ success: false, message: 'Sin permiso para esta campaña' });
    expect(s3Calls()).toBe(0);
  });

  it('agente sin permiso → 403 "Sin permiso"', async () => {
    mockV4Me(AGENT);
    const res = await updateRosterAgents(adminEvent({ path: { campaign: 'prueba' }, body: { agents: [{ username: 'a', enabled: false }] } }));
    expect(parse(res)).toEqual({ success: false, message: 'Sin permiso' });
    expect(s3Calls()).toBe(0);
  });

  it('conflicto persistente → 409 "El roster cambió, intenta de nuevo"', async () => {
    mockV4Me(ADMIN);
    s3.set('rosters/prueba.json', JSON.stringify({ schemaVersion: 2, campaign: 'prueba', overrides: {} }));
    s3.beforePut = () => s3.set('rosters/prueba.json', JSON.stringify({ schemaVersion: 2, campaign: 'prueba', overrides: {} }));
    const res = await updateRosterAgents(adminEvent({ path: { campaign: 'prueba' }, body: { agents: [{ username: 'luis', enabled: false }] } }));
    expect(res.statusCode).toBe(409);
    expect(parse(res)).toEqual({ success: false, message: 'El roster cambió, intenta de nuevo' });
  });

  it('nunca escribe fuera de rosters/', async () => {
    mockV4Me(ADMIN);
    await updateRosterAgents(adminEvent({ path: { campaign: 'prueba' }, body: { agents: [{ username: 'luis', enabled: false }] } }));
    expect(s3.puts.map((p) => p.key)).toEqual(['rosters/prueba.json']);
  });
});
