import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  getAgentContacts,
  listAgentAssignments,
  getAgentAssignments,
  listReviewContacts,
} from '../src/handlers/supervisors';
import { installMemS3 } from './helpers/memS3';

const s3 = mockClient(S3Client);
const KEY = 'test-admin-key';

const event = (headers: Record<string, string> = {}): APIGatewayProxyEvent =>
  ({
    headers,
    pathParameters: { agent: 'erick', campaign: 'prueba' },
  }) as unknown as APIGatewayProxyEvent;

const csvBody = (text: string) => ({ transformToString: async () => text }) as any;

const handlers = {
  getAgentContacts,
  listAgentAssignments,
  getAgentAssignments,
  listReviewContacts,
};

beforeEach(() => {
  s3.reset();
  process.env.ADMIN_API_KEY = KEY;
});

describe.each(Object.entries(handlers))('%s', (_name, handler) => {
  it('responde 401 sin llave y no toca S3', async () => {
    const res = await handler(event());
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ success: false, message: 'No autorizado' });
    expect(s3.calls()).toHaveLength(0);
  });

  it('responde 401 con llave incorrecta y no toca S3', async () => {
    const res = await handler(event({ 'X-Admin-Key': 'otra' }));
    expect(res.statusCode).toBe(401);
    expect(s3.calls()).toHaveLength(0);
  });

  it('responde 503 si la llave no está configurada', async () => {
    process.env.ADMIN_API_KEY = '';
    const res = await handler(event({ 'X-Admin-Key': KEY }));
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body)).toEqual({ success: false, message: 'Admin key no configurada' });
    expect(s3.calls()).toHaveLength(0);
  });
});

describe('con llave válida conserva el comportamiento actual', () => {
  const ok = () => event({ 'x-admin-key': KEY });

  it('getAgentContacts devuelve el CSV más reciente', async () => {
    s3.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: 'agents/prueba/erick-contacts-1.csv', LastModified: new Date('2026-01-01') },
        { Key: 'agents/prueba/erick-contacts-2.csv', LastModified: new Date('2026-02-01') },
      ],
    });
    s3.on(GetObjectCommand, { Key: 'agents/prueba/erick-contacts-2.csv' }).resolves({
      Body: csvBody('contact_phone\n5215500000001'),
    });
    const res = await getAgentContacts(ok());
    expect(res.statusCode).toBe(200);
    expect(res.headers?.['Content-Type']).toBe('text/csv');
    expect(res.body).toBe('contact_phone\n5215500000001');
  });

  it('getAgentContacts responde 404 sin archivos', async () => {
    s3.on(ListObjectsV2Command).resolves({ Contents: [] });
    const res = await getAgentContacts(ok());
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).message).toBe('CSV no encontrado');
  });

  it('listAgentAssignments lista del más reciente al más antiguo', async () => {
    s3.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: 'assignments/agents/prueba/erick-contacts-a.csv', LastModified: new Date('2026-01-01'), Size: 10 },
        { Key: 'assignments/agents/prueba/otro-contacts-b.csv', LastModified: new Date('2026-03-01'), Size: 10 },
        { Key: 'assignments/agents/prueba/erick-contacts-c.csv', LastModified: new Date('2026-02-01'), Size: 20 },
      ],
    });
    const res = await listAgentAssignments(ok());
    expect(res.statusCode).toBe(200);
    const { data } = JSON.parse(res.body);
    expect(data.items.map((i: { key: string }) => i.key)).toEqual([
      'assignments/agents/prueba/erick-contacts-c.csv',
      'assignments/agents/prueba/erick-contacts-a.csv',
    ]);
  });

  it('getAgentAssignments responde 404 sin asignaciones', async () => {
    s3.on(ListObjectsV2Command).resolves({ Contents: [] });
    const res = await getAgentAssignments(ok());
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).message).toBe('CSV assignment no encontrado');
  });
});

describe('listReviewContacts (GET /supervisors/review/{campaign})', () => {
  const ok = (campaign = 'prueba') =>
    ({ headers: { 'X-Admin-Key': KEY }, pathParameters: { campaign } }) as unknown as APIGatewayProxyEvent;

  it('responde items vacío si no hay registros', async () => {
    installMemS3(s3);
    const res = await listReviewContacts(ok());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true, items: [] });
  });

  it('lista registros paginando, ordenados por updatedAt desc, con count', async () => {
    installMemS3(
      s3,
      {
        'review/prueba/erick/20261026T1530-ab12cd34.csv': {
          body: 'contact_phone,contact_name\n5500000001,A\n5500000002,B',
          lastModified: new Date('2026-10-26T15:30:00Z'),
        },
        'review/prueba/ana/20261027T0900-0011aabb.csv': {
          body: 'contact_phone,contact_name\n5500000003,C\n',
          lastModified: new Date('2026-10-27T09:00:00Z'),
        },
        'review/otra/erick/x.csv': 'contact_phone\n1',
        'review/prueba/suelto.csv': 'contact_phone\n1',
      },
      1
    );
    const res = await listReviewContacts(ok('%20Prueba'));
    expect(res.statusCode).toBe(200);
    const { success, items } = JSON.parse(res.body);
    expect(success).toBe(true);
    expect(items.map((i: any) => [i.agent, i.assignmentId, i.count, i.updatedAt])).toEqual([
      ['ana', '20261027T0900-0011aabb', 1, '2026-10-27T09:00:00.000Z'],
      ['erick', '20261026T1530-ab12cd34', 2, '2026-10-26T15:30:00.000Z'],
    ]);
    expect(items[1].csv).toBe('contact_phone,contact_name\n5500000001,A\n5500000002,B');
    // Paginación: una llamada List por objeto (pageSize 1) + 1 Get por registro válido
    expect(s3.commandCalls(ListObjectsV2Command).length).toBeGreaterThan(1);
  });
});
