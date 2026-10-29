import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { requireAdmin } from '../src/lib/adminAuth';
import { getCampaignCredentials } from '../src/handlers/credentials';
import { listAgentAssignments } from '../src/handlers/supervisors';

const ev = (headers: Record<string, string> = {}, pathParameters: Record<string, string> = {}) =>
  ({ headers, pathParameters }) as unknown as APIGatewayProxyEvent;

describe('X-Admin-Key obligatoria en rutas sensibles aunque ADMIN_AUTH_ENFORCED esté apagado', () => {
  beforeEach(() => {
    process.env.ADMIN_AUTH_ENFORCED = 'false';
    process.env.ADMIN_API_KEY = 'k';
  });
  afterEach(() => {
    process.env.ADMIN_AUTH_ENFORCED = 'true';
  });

  it('el guard normal deja pasar con el flag apagado (carga de motor-de-gestion)', () => {
    expect(requireAdmin(ev())).toBeNull();
  });

  it('el guard `always` exige la llave con el flag apagado', () => {
    expect(requireAdmin(ev(), { always: true })?.statusCode).toBe(401);
    expect(requireAdmin(ev({ 'X-Admin-Key': 'k' }), { always: true })).toBeNull();
  });

  it('GET /credentials/{campaign} sin llave responde 401', async () => {
    const res = await getCampaignCredentials(ev({}, { campaign: 'prueba' }));
    expect(res.statusCode).toBe(401);
  });

  it('GET /supervisors/assignments/agents/{agent}/{campaign} sin llave responde 401', async () => {
    const res = await listAgentAssignments(ev({}, { agent: 'zz', campaign: 'prueba' }));
    expect(res.statusCode).toBe(401);
  });
});
