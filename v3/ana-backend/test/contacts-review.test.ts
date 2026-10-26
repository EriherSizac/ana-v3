import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { updatePendingContacts } from '../src/handlers/contacts';
import { installMemS3 } from './helpers/memS3';

const s3 = mockClient(S3Client);
let store: ReturnType<typeof installMemS3>;

const post = (body: unknown): APIGatewayProxyEvent =>
  ({ headers: {}, body: JSON.stringify(body) }) as unknown as APIGatewayProxyEvent;

const row = (phone: string, name: string) => ({ contact_phone: phone, contact_name: name, message: 'Hola' });

beforeEach(() => {
  s3.reset();
  store = installMemS3(s3);
});

describe('POST /contacts/pending con review', () => {
  it('escribe chats/ y review/ y responde reviewContacts', async () => {
    const res = await updatePendingContacts(
      post({
        campaign: 'Prueba',
        agent_id: 'Erick',
        contacts: [row('5500000001', 'A'), row('5500000002', 'B'), row('5500000003', 'C')],
        review: { assignment_id: '20261026T1530-ab12cd34', contacts: [row('5500000009', 'Z, Y')] },
      })
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.remainingContacts).toBe(3);
    expect(body.reviewContacts).toBe(1);
    expect(store.get('chats/erick-prueba.csv')!.body.split('\n')).toHaveLength(4);
    expect(store.get('review/prueba/erick/20261026T1530-ab12cd34.csv')!.body).toBe(
      'contact_phone,contact_name,message\n5500000009,"Z, Y",Hola'
    );
  });

  it('sin review se comporta como antes y no escribe bajo review/', async () => {
    const res = await updatePendingContacts(
      post({ campaign: 'prueba', agent_id: 'erick', contacts: [row('5500000001', 'A')] })
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      message: 'Contactos pendientes actualizados',
      path: 'chats/erick-prueba.csv',
      remainingContacts: 1,
    });
    expect([...store.keys()].filter((k) => k.startsWith('review/'))).toEqual([]);
  });

  it('review con contacts vacío no escribe archivo de revisión', async () => {
    const res = await updatePendingContacts(
      post({ campaign: 'prueba', agent_id: 'erick', contacts: [], review: { assignment_id: 'abc', contacts: [] } })
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).reviewContacts).toBe(0);
    expect([...store.keys()]).toEqual(['chats/erick-prueba.csv']);
  });

  it.each([
    ['assignment_id con ..', { assignment_id: '../x', contacts: [] }],
    ['assignment_id vacío', { assignment_id: '', contacts: [] }],
    ['assignment_id de 65 caracteres', { assignment_id: 'a'.repeat(65), contacts: [] }],
    ['assignment_id no string', { assignment_id: 12, contacts: [] }],
    ['contacts no arreglo', { assignment_id: 'abc', contacts: 'x' }],
    ['review no objeto', 'x'],
    ['review arreglo', []],
  ])('400 sin escribir en S3: %s', async (_desc, review) => {
    const res = await updatePendingContacts(
      post({ campaign: 'prueba', agent_id: 'erick', contacts: [row('5500000001', 'A')], review })
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'review inválido' });
    expect(s3.commandCalls(PutObjectCommand)).toHaveLength(0);
  });
});
