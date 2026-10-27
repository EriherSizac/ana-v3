import { mockClient } from 'aws-sdk-client-mock';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAssignmentFile,
  isOwnPendingKey,
  listAssignments,
  listPublications,
  publishAssignments,
  type AgentEvent,
} from '../src/handlers/agentAssignments';
import { getChats } from '../src/handlers/chats';
import { installCondS3, type CondS3 } from './helpers/condS3';
import { derivedList, derivedMembers } from './helpers/admin';
import { bearer, setupAgentAuth, signIdToken } from './helpers/agentJwt';

/** add-agent-workspace: rutas /agent/assignments* (spec v3/agent-workspace). */
const s3mock = mockClient(S3Client);
let s3: CondS3;

const cli = (await import(/* @vite-ignore */ pathToFileURL(join(__dirname, '..', '..', 'cli-whatsapp', 'assignment-csv.js')).href)) as {
  parseAssignmentCsv: (t: string) => Array<Record<string, string>>;
};

const A1 = 'assignments/agents/prueba/ana.lopez-contacts-2026-10-26T10-00-00-000Z.csv';
const A2 = 'assignments/agents/prueba/ana.lopez-contacts-2026-10-26T11-00-00-000Z.csv';
const L1 = 'assignments/agents/prueba/luis-contacts-2026-10-26T10-00-00-000Z.csv';
const CSV1 = [
  'phone_number,first_name,total_balance,ana_upload_id',
  '5215500000001,Ana,1000,U1',
  '5215500000002,Beto,200,U1',
  '5215500000003,Carla,300,U1',
  '5215500000004,Incompleta',
].join('\n') + '\n';
const CSV2 = ['contact_phone,first_name,telefono_2', '5215500000010,Dana,5215500000011', '5215500000001,Ana repetida,'].join('\n') + '\n';

const ev = (opts: { user?: string | null; campaign?: string; query?: Record<string, string>; body?: unknown }): AgentEvent => ({
  headers: opts.user === null ? {} : bearer(signIdToken({ 'cognito:username': opts.user ?? 'Ana.Lopez' })),
  pathParameters: { campaign: opts.campaign ?? 'prueba' },
  queryStringParameters: opts.query ?? {},
  body: opts.body === undefined ? null : JSON.stringify(opts.body),
});
const parse = (r: { body: string }) => JSON.parse(r.body);
const etag = (k: string) => s3.store.get(k)!.etag;

beforeEach(() => {
  s3mock.reset();
  process.env.BUCKET_NAME = 'ana-backend-storage-test';
  s3 = installCondS3(s3mock, {}, 2);
  setupAgentAuth({ enforced: true });
  s3.set('campaign-agents/prueba.json', derivedList('prueba', ['ana.lopez', 'luis']));
  s3.set(A1, CSV1, new Date('2026-10-26T10:00:00Z'));
  s3.set(A2, CSV2, new Date('2026-10-26T11:00:00Z'));
  s3.set(L1, CSV1);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const publishBody = (over: Record<string, unknown> = {}) => ({
  publishId: '20261026T120000-abcdef12',
  template: 'Hola {{first_name}}, paga {{total_balance*0.5}}',
  phoneColumns: ['phone_number'],
  sources: [{ key: A1, etag: etag(A1), rows: [0, 1] }],
  ...over,
});

describe('autenticación', () => {
  it('sin token → 401 sin S3 de datos', async () => {
    const res = await listAssignments(ev({ user: null }));
    expect(res.statusCode).toBe(401);
    expect(s3mock.commandCalls(GetObjectCommand)).toHaveLength(0);
  });

  it('campaña donde no está habilitado → 403 sin listar', async () => {
    const res = await listAssignments(ev({ campaign: 'zendere' }));
    expect(res.statusCode).toBe(403);
    expect(parse(res)).toEqual({ error: 'Forbidden' });
  });

  it('deshabilitado en el roster → 403', async () => {
    s3.set(
      'rosters/prueba.json',
      JSON.stringify({ schemaVersion: 2, campaign: 'prueba', updatedAt: null, updatedBy: null, overrides: { 'ana.lopez': { enabled: false, updatedAt: 'x', updatedBy: 'l' } } }),
    );
    expect((await listAssignments(ev({}))).statusCode).toBe(403);
  });

  it('supervisora habilitada entra a sus asignaciones', async () => {
    s3.set('campaign-agents/prueba.json', derivedMembers('prueba', [['sara', 'supervisor']]));
    s3.set('assignments/agents/prueba/sara-contacts-T.csv', CSV1);
    const res = await listAssignments(ev({ user: 'sara' }));
    expect(res.statusCode).toBe(200);
    expect(parse(res).data.items.map((i: any) => i.fileName)).toEqual(['sara-contacts-T.csv']);
  });
});

describe('GET /agent/assignments/{campaign}', () => {
  it('solo los archivos del agente del token, del más reciente al más antiguo (paginado)', async () => {
    const res = await listAssignments(ev({}));
    expect(res.statusCode).toBe(200);
    const d = parse(res).data;
    expect(d.agent).toBe('ana.lopez');
    expect(d.items.map((i: any) => i.key)).toEqual([A2, A1]);
    expect(d.items[0]).toMatchObject({ fileName: 'ana.lopez-contacts-2026-10-26T11-00-00-000Z.csv', etag: etag(A2), size: CSV2.length });
  });
});

describe('GET /agent/assignments/{campaign}/file', () => {
  it('devuelve csv y etag de un pendiente propio', async () => {
    const res = await getAssignmentFile(ev({ query: { key: A1 } }));
    expect(parse(res).data).toMatchObject({ key: A1, etag: etag(A1), csv: CSV1 });
  });

  it.each([L1, 'assignments/agents/prueba/../zendere/ana.lopez-contacts-x.csv', 'agents/prueba/ana.lopez-contacts-x.csv', 'assignments/agents/prueba/ana.lopez-contacts-x.txt'])(
    'llave no permitida %s → 403 sin leer',
    async (key) => {
      const res = await getAssignmentFile(ev({ query: { key } }));
      expect(res.statusCode).toBe(403);
      expect(parse(res)).toEqual({ error: 'Archivo no permitido' });
      expect(s3mock.commandCalls(GetObjectCommand).filter((c) => c.args[0].input.Key === key)).toHaveLength(0);
    },
  );

  it('inexistente → 404; > 5 MB → 413', async () => {
    expect((await getAssignmentFile(ev({ query: { key: 'assignments/agents/prueba/ana.lopez-contacts-nada.csv' } }))).statusCode).toBe(404);
    s3.set('assignments/agents/prueba/ana.lopez-contacts-big.csv', 'phone\n' + '5'.repeat(5 * 1024 * 1024 + 10));
    expect((await getAssignmentFile(ev({ query: { key: 'assignments/agents/prueba/ana.lopez-contacts-big.csv' } }))).statusCode).toBe(413);
  });

  it('isOwnPendingKey', () => {
    expect(isOwnPendingKey(A1, 'prueba', 'ana.lopez')).toBe(true);
    expect(isOwnPendingKey('assignments/agents/prueba/sub/ana.lopez-contacts.csv', 'prueba', 'ana.lopez')).toBe(false);
  });
});

describe('POST /agent/assignments/{campaign}/publish', () => {
  it('publica al layout del CLI con mensaje renderizado y ana_upload_id; consume las filas', async () => {
    const res = await publishAssignments(ev({ body: publishBody() }));
    expect(res.statusCode).toBe(200);
    const m = parse(res).data;
    expect(m).toMatchObject({ schemaVersion: 1, agent: 'ana.lopez', campaign: 'prueba', contacts: 2, rows: 2, uploadIds: ['U1'] });
    expect(m.key).toMatch(/^agents\/prueba\/ana\.lopez-contacts-.+\.csv$/);
    const file = s3.store.get(m.key)!.body;
    expect(file).toBe(s3.store.get(m.historicKey)!.body);
    expect(file.split('\n')[0]).toBe('phone_number,first_name,total_balance,message,ana_upload_id');
    expect(file.split('\n')[1]).toBe('5215500000001,Ana,1000,"Hola Ana, paga 500",U1');
    // Lo que el CLI lee y envía.
    const contacts = cli.parseAssignmentCsv(file);
    expect(contacts.map((c) => [c.phone, c.message])).toEqual([
      ['5215500000001', 'Hola Ana, paga 500'],
      ['5215500000002', 'Hola Beto, paga 100'],
    ]);
    // Pendiente reescrito con las filas restantes (líneas originales, incluida la inválida).
    expect(s3.store.get(A1)!.body).toBe('phone_number,first_name,total_balance,ana_upload_id\n5215500000003,Carla,300,U1\n5215500000004,Incompleta\n');
    expect(s3.puts.find((p) => p.key === A1)!.ifMatch).toBeDefined();
    expect(m.sources).toEqual([{ key: A1, rows: 2, remaining: 2, action: 'rewritten' }]);
    expect(s3.json(`agent-publications/prueba/ana.lopez/20261026T120000-abcdef12.json`).publishId).toBe('20261026T120000-abcdef12');
    const chats = await getChats({ headers: bearer(signIdToken({ 'cognito:username': 'ana.lopez' })), pathParameters: { agentId: 'ana.lopez', campaignId: 'prueba' } } as unknown as APIGatewayProxyEvent);
    expect(chats.statusCode).toBe(200);
    expect(chats.body).toBe(file);
  });

  it('publicación total: la fuente se borra (las inválidas restantes se descartan)', async () => {
    const res = await publishAssignments(ev({ body: publishBody({ sources: [{ key: A1, etag: etag(A1), rows: [0, 1, 2] }] }) }));
    expect(parse(res).data.sources[0]).toMatchObject({ action: 'deleted', remaining: 0 });
    expect(s3.store.has(A1)).toBe(false);
  });

  it('combina dos archivos, varias columnas de teléfono y descarta repetidos', async () => {
    const res = await publishAssignments(
      ev({
        body: publishBody({
          template: 'Hola {first_name}\\nAdiós',
          phoneColumns: ['contact_phone', 'telefono_2', 'phone_number'],
          sources: [
            { key: A1, etag: etag(A1), rows: [0] },
            { key: A2, etag: etag(A2), rows: [0, 1] },
          ],
        }),
      }),
    );
    expect(res.statusCode).toBe(200);
    const file = s3.store.get(parse(res).data.key)!.body;
    const lines = file.trimEnd().split('\n');
    expect(lines[0]).toBe('phone_number,first_name,total_balance,telefono_2,message,ana_upload_id');
    expect(lines.slice(1)).toEqual([
      '5215500000001,Ana,1000,,Hola Ana\\nAdiós,U1',
      '5215500000010,Dana,,5215500000011,Hola Dana\\nAdiós,',
      '5215500000011,Dana,,5215500000011,Hola Dana\\nAdiós,',
    ]);
    expect(parse(res).data).toMatchObject({ contacts: 3, rows: 3 });
    expect(cli.parseAssignmentCsv(file)[0]!.message).toBe('Hola Ana\nAdiós');
  });

  it('variable desconocida → 400 sin escribir', async () => {
    const res = await publishAssignments(ev({ body: publishBody({ template: 'Hola {{apodo}}' }) }));
    expect(parse(res)).toEqual({ success: false, message: 'Variable desconocida: {{apodo}}' });
    expect(s3.puts).toHaveLength(0);
  });

  it('{upload} que solo resolvería contra ana_upload_id → 400', async () => {
    const res = await publishAssignments(ev({ body: publishBody({ template: 'Ref {upload}' }) }));
    expect(parse(res).message).toBe('Variable desconocida: {upload}');
  });

  it('ETag cambiado (otra pestaña) → 409 sin escribir', async () => {
    const body = publishBody();
    s3.set(A1, CSV1);
    const res = await publishAssignments(ev({ body }));
    expect(res.statusCode).toBe(409);
    expect(parse(res)).toEqual({ success: false, message: 'La asignación cambió; vuelve a cargarla' });
    expect(s3.puts).toHaveLength(0);
  });

  it('fuente de otro agente → 403 sin escribir', async () => {
    const res = await publishAssignments(ev({ body: publishBody({ sources: [{ key: L1, etag: etag(L1), rows: [0] }] }) }));
    expect(res.statusCode).toBe(403);
    expect(s3.puts).toHaveLength(0);
  });

  it.each([
    [{ sources: [{ key: A1, etag: 'x', rows: [] }] }, 'Selecciona al menos una fila'],
    [{ template: '  ' }, 'Escribe el mensaje'],
    [{ publishId: 'corto' }, 'publishId inválido'],
    [{ phoneColumns: [] }, 'Elige entre 1 y 5 columnas de teléfono'],
    [{ phoneColumns: ['nope'] }, 'Columna de teléfono inexistente: nope'],
  ])('body inválido %j → 400', async (over, message) => {
    const res = await publishAssignments(ev({ body: publishBody(over) }));
    expect(res.statusCode).toBe(400);
    expect(parse(res).message).toBe(message);
  });

  it('fila inválida o inexistente → 400', async () => {
    expect(parse(await publishAssignments(ev({ body: publishBody({ sources: [{ key: A1, etag: etag(A1), rows: [3] }] }) }))).message).toBe('Fila inválida: 4');
    expect(parse(await publishAssignments(ev({ body: publishBody({ sources: [{ key: A1, etag: etag(A1), rows: [9] }] }) }))).message).toBe('Fila inexistente: 10');
  });

  it('sin teléfonos válidos → 400', async () => {
    s3.set(A1, 'phone_number,first_name\n123,Corto\n');
    const res = await publishAssignments(ev({ body: publishBody({ template: 'Hola', sources: [{ key: A1, etag: etag(A1), rows: [0] }] }) }));
    expect(parse(res).message).toBe('Sin teléfonos válidos');
  });

  it('mismo publishId → 200 con el manifiesto original y un solo archivo para el CLI', async () => {
    const body = publishBody();
    const first = parse(await publishAssignments(ev({ body }))).data;
    const second = await publishAssignments(ev({ body }));
    expect(second.statusCode).toBe(200);
    expect(parse(second).data).toEqual(first);
    expect([...s3.store.keys()].filter((k) => k.startsWith('agents/prueba/ana.lopez-contacts'))).toHaveLength(1);
  });

  it('falla al consumir la segunda fuente → borra lo publicado y restaura la primera', async () => {
    const before = s3.store.get(A1)!.body;
    s3.beforePut = (key) => {
      if (key === A2) throw Object.assign(new Error('boom'), { name: 'InternalError' });
    };
    const res = await publishAssignments(
      ev({ body: publishBody({ sources: [{ key: A1, etag: etag(A1), rows: [0] }, { key: A2, etag: etag(A2), rows: [0] }] }) }),
    );
    expect(res.statusCode).toBe(500);
    expect(parse(res)).toEqual({ success: false, message: 'Error interno del servidor' });
    expect([...s3.store.keys()].filter((k) => k.startsWith('agents/') || k.startsWith('historic/'))).toEqual([]);
    expect(s3.store.get(A1)!.body).toBe(before);
    expect(s3.store.has('agent-publications/prueba/ana.lopez/20261026T120000-abcdef12.json')).toBe(false);
  });

  it('nunca registra teléfonos ni mensajes', async () => {
    const log = vi.spyOn(console, 'log');
    await publishAssignments(ev({ body: publishBody() }));
    const out = log.mock.calls.flat().join(' ');
    expect(out).toContain('agent_publish');
    for (const s of ['5215500000001', 'Hola Ana', 'Ana']) expect(out).not.toContain(s);
  });
});

describe('GET /agent/assignments/{campaign}/publications', () => {
  it('las del agente, la más reciente primero', async () => {
    const mk = (id: string, at: string, agent = 'ana.lopez') =>
      s3.set(`agent-publications/prueba/${agent}/${id}.json`, JSON.stringify({ schemaVersion: 1, publishId: id, agent, publishedAt: at, contacts: 1 }));
    mk('p1-aaaaaaaa', '2026-10-01T00:00:00Z');
    mk('p2-aaaaaaaa', '2026-10-03T00:00:00Z');
    mk('p3-aaaaaaaa', '2026-10-02T00:00:00Z');
    mk('px-aaaaaaaa', '2026-10-04T00:00:00Z', 'luis');
    const res = await listPublications(ev({}));
    expect(parse(res).data.items.map((i: any) => i.publishId)).toEqual(['p2-aaaaaaaa', 'p3-aaaaaaaa', 'p1-aaaaaaaa']);
  });

  it('sin publicaciones → items vacío', async () => {
    expect(parse(await listPublications(ev({}))).data.items).toEqual([]);
  });
});

describe('serverless.yml', () => {
  it('las cuatro rutas /agent/assignments* con cognitoAgentJwt; publish con timeout 29', () => {
    const cfg = parseYaml(readFileSync(join(__dirname, '..', 'serverless.yml'), 'utf8'));
    const expected: Record<string, [string, string]> = {
      agentListAssignments: ['get', '/agent/assignments/{campaign}'],
      agentGetAssignmentFile: ['get', '/agent/assignments/{campaign}/file'],
      agentPublishAssignments: ['post', '/agent/assignments/{campaign}/publish'],
      agentListPublications: ['get', '/agent/assignments/{campaign}/publications'],
    };
    for (const [fn, [method, path]] of Object.entries(expected)) {
      const e = cfg.functions[fn].events[0].httpApi;
      expect([e.method, e.path, e.authorizer.name]).toEqual([method, path, 'cognitoAgentJwt']);
    }
    expect(cfg.functions.agentPublishAssignments.timeout).toBe(29);
  });
});
