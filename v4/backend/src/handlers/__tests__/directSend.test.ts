import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';

vi.mock('../../lib/campaignsDb', () => ({ campaignExists: vi.fn(async () => true) }));
vi.mock('../../lib/dashboard', () => ({ fetchEligibleAgents: vi.fn() }));

import { handler } from '../directSend';
import { fetchEligibleAgents } from '../../lib/dashboard';

const ddbMock = mockClient(DynamoDBDocumentClient);
const agentsMock = vi.mocked(fetchEligibleAgents);

const ev = (body: unknown, key = 'k-current') =>
  ({
    routeKey: 'POST /send',
    headers: key ? { 'x-api-key': key } : {},
    body: JSON.stringify(body),
  }) as any;
const base = { message: 'Hola', username: 'agente1', phone: '55 1234 5678', campaign: 'bancoppel' };
const json = (r: any) => JSON.parse(r.body);

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(PutCommand).resolves({});
  agentsMock.mockReset();
  agentsMock.mockResolvedValue(['Agente1', 'otro']);
  process.env.SEND_API_KEY = 'k-current';
  process.env.SEND_API_KEY_NEXT = '';
});

describe('POST /send — auth', () => {
  it('sin keys configuradas responde 401 aunque llegue header', async () => {
    process.env.SEND_API_KEY = '';
    const r: any = await handler(ev(base, 'k-current'));
    expect(r.statusCode).toBe(401);
    expect(json(r)).toEqual({ error: 'no autorizado' });
    process.env.SEND_API_KEY = '';
    process.env.SEND_API_KEY_NEXT = '';
    expect(((await handler(ev(base, ''))) as any).statusCode).toBe(401);
  });
  it('key incorrecta → 401', async () => {
    expect(((await handler(ev(base, 'nope'))) as any).statusCode).toBe(401);
  });
  it('acepta SEND_API_KEY_NEXT durante la rotación', async () => {
    process.env.SEND_API_KEY_NEXT = 'k-next';
    expect(((await handler(ev(base, 'k-next'))) as any).statusCode).toBe(200);
  });
});

describe('POST /send — encolado', () => {
  it('dos llamadas en el mismo ms generan jobIds distintos', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1765400000000);
    const a = json(await handler(ev(base)));
    const b = json(await handler(ev(base)));
    vi.restoreAllMocks();
    expect(a.jobId).not.toBe(b.jobId);
    expect(a.jobId).toMatch(/^direct#1765400000000#5512345678#[0-9a-f]{8}$/);
    const puts = ddbMock.commandCalls(PutCommand);
    expect(puts).toHaveLength(2);
    expect(puts[0].args[0].input.ConditionExpression).toBe('attribute_not_exists(jobId)');
  });

  it('misma idempotencyKey → un solo Put exitoso y misma respuesta con duplicate', async () => {
    let first = true;
    ddbMock.on(PutCommand).callsFake(() => {
      if (first) {
        first = false;
        return {};
      }
      throw new ConditionalCheckFailedException({ message: 'exists', $metadata: {} });
    });
    const body = { ...base, idempotencyKey: 'crm-123' };
    const r1 = json(await handler(ev(body)));
    const r2Raw: any = await handler(ev(body));
    const r2 = json(r2Raw);
    expect(r2Raw.statusCode).toBe(200);
    expect(r1.jobId).toBe('direct#key#crm-123');
    expect(r2.jobId).toBe(r1.jobId);
    expect(r2.duplicate).toBe(true);
    expect(r1.duplicate).toBeUndefined();
  });

  it('idempotencyKey inválida → 400', async () => {
    for (const k of ['', 'con espacio', 'x'.repeat(65), 'a#b']) {
      const r: any = await handler(ev({ ...base, idempotencyKey: k }));
      expect(r.statusCode).toBe(400);
      expect(json(r)).toEqual({ error: 'idempotencyKey inválida' });
    }
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });
});

describe('POST /send — validación del agente', () => {
  it('agente elegible (sin distinguir mayúsculas) se escribe con la grafía de la fuente', async () => {
    const r: any = await handler(ev({ ...base, username: 'AGENTE1' }));
    expect(r.statusCode).toBe(200);
    expect(json(r).operatorId).toBe('Agente1');
    expect(ddbMock.commandCalls(PutCommand)[0].args[0].input.Item?.operatorId).toBe('Agente1');
  });
  it('username inexistente → 400 sin encolar', async () => {
    const r: any = await handler(ev({ ...base, username: 'nadie' }));
    expect(r.statusCode).toBe(400);
    expect(json(r)).toEqual({ error: 'el agente "nadie" no pertenece a la campaña' });
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });
  it('fuente de agentes caída → 503 sin encolar', async () => {
    agentsMock.mockResolvedValue(null);
    const r: any = await handler(ev(base));
    expect(r.statusCode).toBe(503);
    expect(json(r)).toEqual({ error: 'no se pudo validar el agente' });
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });
});
