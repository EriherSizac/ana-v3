import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { uploadBackup, getLatestBackup } from '../src/handlers/backups';
import { saveChatBackup, listChatBackups, getChatBackup } from '../src/handlers/chatBackups';
import { uploadMedia } from '../src/handlers/media';
import { installMemS3 } from './helpers/memS3';

const s3 = mockClient(S3Client);
const bodyEv = (body: unknown) => ({ headers: {}, body: JSON.stringify(body) }) as unknown as APIGatewayProxyEvent;
const pathEv = (path: Record<string, string>) => ({ headers: {}, pathParameters: path }) as unknown as APIGatewayProxyEvent;
const putKeys = () => s3.commandCalls(PutObjectCommand).map((c) => (c.args[0].input as any).Key as string);

beforeEach(() => {
  s3.reset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('respaldos de chat', () => {
  it('POST /backups/chat con Erick/Prueba escribe backups/prueba/erick/… y GET /backups/chats/PRUEBA/ERICK lo lista', async () => {
    installMemS3(s3);
    const save = await saveChatBackup(
      bodyEv({ campaign: 'Prueba', agent_id: 'Erick', contact_phone: '5215500000001', messages: [{ id: 1, body: 'hola', timestamp: 1 }] })
    );
    expect(save.statusCode).toBe(200);
    expect(putKeys()).toEqual(['backups/prueba/erick/5215500000001/chat_backup.json']);

    const list = await listChatBackups(pathEv({ campaign: 'PRUEBA', agentId: 'ERICK' }));
    expect(list.statusCode).toBe(200);
    expect(s3.commandCalls(ListObjectsV2Command)[0].args[0].input.Prefix).toBe('backups/prueba/erick/');
    const listed = JSON.parse(list.body);
    expect(listed).toMatchObject({ campaign: 'prueba', agent_id: 'erick', total_chats: 1 });

    const one = await getChatBackup(pathEv({ campaign: ' Prueba ', agentId: 'Erick', contactPhone: '5215500000001' }));
    expect(one.statusCode).toBe(200);
  });
});

describe('respaldo diario', () => {
  it('POST /backups con agent_id " Erick " es encontrado por GET /backups/latest/erick/prueba', async () => {
    installMemS3(s3);
    const up = await uploadBackup(bodyEv({ campaign: 'Prueba', agent_id: ' Erick ', data: { a: 1 } }));
    expect(up.statusCode).toBe(200);
    expect(putKeys()[0]).toMatch(/^backups\/prueba\/\d{4}-\d{2}\/erick_\d{2}\.json$/);

    const latest = await getLatestBackup(pathEv({ agentId: 'erick', campaign: 'prueba' }));
    expect(latest.statusCode).toBe(200);
    expect(JSON.parse(latest.body).data).toEqual({ a: 1 });
  });

  it.each([
    { campaign: '   ', agent_id: 'erick' },
    { campaign: 'prueba', agent_id: '   ' },
  ])('valor solo con espacios responde 400 sin escribir (%o)', async (b) => {
    const res = await uploadBackup(bodyEv({ ...b, data: { a: 1 } }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'campaign, agent_id and data fields are required' });
    expect(s3.calls()).toHaveLength(0);
  });
});

describe('multimedia', () => {
  it('POST /media devuelve una URL con media/prueba/erick/', async () => {
    installMemS3(s3);
    const res = await uploadMedia(
      bodyEv({ campaign: ' Prueba ', agent_id: 'Erick', filename: 'f.jpg', data: Buffer.from('x').toString('base64') })
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.path).toBe('media/prueba/erick/f.jpg');
    expect(body.url).toContain('/media/prueba/erick/f.jpg');
    expect(putKeys()).toEqual(['media/prueba/erick/f.jpg']);
  });

  it('POST /media con campaña vacía responde 400', async () => {
    const res = await uploadMedia(bodyEv({ campaign: ' ', agent_id: 'Erick', filename: 'f', data: 'eA==' }));
    expect(res.statusCode).toBe(400);
    expect(s3.calls()).toHaveLength(0);
  });
});
