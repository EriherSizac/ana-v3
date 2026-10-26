import { mockClient } from 'aws-sdk-client-mock';
import { S3Client } from '@aws-sdk/client-s3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  RosterConflictError,
  RosterError,
  NotAgentError,
  getEnabledAgents,
  isAgentEnabled,
  readEffectiveRoster,
  updateRoster,
} from '../src/lib/roster';
import { installCondS3, type CondS3 } from './helpers/condS3';
import { derivedList } from './helpers/admin';

const s3mock = mockClient(S3Client);
let s3: CondS3;

const roster = (overrides: Record<string, unknown>) =>
  JSON.stringify({ schemaVersion: 2, campaign: 'prueba', updatedAt: null, updatedBy: null, overrides });

beforeEach(() => {
  s3mock.reset();
  process.env.BUCKET_NAME = 'ana-backend-storage-test';
  s3 = installCondS3(s3mock);
});

describe('Regla de habilitación efectiva', () => {
  it('agente derivado sin excepción → habilitado', async () => {
    s3.set('campaign-agents/prueba.json', derivedList('prueba', ['ana.lopez']));
    expect(await isAgentEnabled('prueba', 'ana.lopez')).toBe(true);
  });

  it('deshabilitado por un administrador → no habilitado', async () => {
    s3.set('campaign-agents/prueba.json', derivedList('prueba', ['ana.lopez']));
    s3.set('rosters/prueba.json', roster({ 'ana.lopez': { enabled: false, updatedAt: 'x', updatedBy: 'erick.silva' } }));
    expect(await isAgentEnabled('prueba', 'ana.lopez')).toBe(false);
  });

  it('pierde el rol con excepción enabled:true → no habilitado; al recuperarlo vuelve', async () => {
    s3.set('campaign-agents/prueba.json', derivedList('prueba', ['ana.lopez']));
    s3.set('rosters/prueba.json', roster({ luis: { enabled: true, updatedAt: 'x', updatedBy: 'e' } }));
    expect(await isAgentEnabled('prueba', 'luis')).toBe(false);
    s3.set('campaign-agents/prueba.json', derivedList('prueba', ['ana.lopez', 'luis']));
    expect(await isAgentEnabled('prueba', 'luis')).toBe(true);
  });

  it('lista inexistente = sin agentes', async () => {
    expect(await getEnabledAgents('prueba')).toEqual([]);
  });

  it('lista vencida (> 24 h) → error de roster', async () => {
    s3.set('campaign-agents/prueba.json', derivedList('prueba', ['ana.lopez'], new Date(Date.now() - 25 * 3600_000).toISOString()));
    await expect(isAgentEnabled('prueba', 'ana.lopez')).rejects.toBeInstanceOf(RosterError);
  });

  it.each([
    ['JSON inválido', '{no'],
    ['versión ≠ 1', JSON.stringify({ schemaVersion: 2, campaign: 'prueba', generatedAt: new Date().toISOString(), agents: [] })],
  ])('lista ilegible (%s) → error', async (_n, body) => {
    s3.set('campaign-agents/prueba.json', body);
    await expect(getEnabledAgents('prueba')).rejects.toBeInstanceOf(RosterError);
  });

  it('enabled como texto → roster ilegible', async () => {
    s3.set('campaign-agents/prueba.json', derivedList('prueba', ['ana.lopez']));
    s3.set('rosters/prueba.json', roster({ 'ana.lopez': { enabled: 'false' } }));
    await expect(isAgentEnabled('prueba', 'ana.lopez')).rejects.toBeInstanceOf(RosterError);
  });

  it('roster de versión distinta de 2 → error', async () => {
    s3.set('campaign-agents/prueba.json', derivedList('prueba', ['ana.lopez']));
    s3.set('rosters/prueba.json', JSON.stringify({ schemaVersion: 1, agents: ['ana.lopez'] }));
    await expect(isAgentEnabled('prueba', 'ana.lopez')).rejects.toBeInstanceOf(RosterError);
  });

  it('vista efectiva con excepciones sin efecto', async () => {
    s3.set('campaign-agents/prueba.json', derivedList('prueba', ['luis', 'ana.lopez']));
    s3.set(
      'rosters/prueba.json',
      roster({
        luis: { enabled: false, updatedAt: '2026-10-01T00:00:00Z', updatedBy: 'erick.silva' },
        'viejo.agente': { enabled: false, updatedAt: '2026-09-01T00:00:00Z', updatedBy: 'erick.silva' },
      }),
    );
    const r = await readEffectiveRoster('prueba');
    expect(r.agents).toEqual([
      { username: 'ana.lopez', enabled: true, override: null },
      { username: 'luis', enabled: false, override: { enabled: false, updatedAt: '2026-10-01T00:00:00Z', updatedBy: 'erick.silva' } },
    ]);
    expect(r.inactiveOverrides).toEqual([{ username: 'viejo.agente', enabled: false, updatedAt: '2026-09-01T00:00:00Z', updatedBy: 'erick.silva' }]);
  });
});

describe('Escritura concurrente del roster', () => {
  beforeEach(() => s3.set('campaign-agents/prueba.json', derivedList('prueba', ['ana.lopez', 'luis'])));

  it('crea el roster con If-None-Match y guarda autor y fecha', async () => {
    await updateRoster('prueba', [{ username: 'ana.lopez', enabled: false }], 'erick.silva', () => new Date('2026-10-26T10:00:00Z'));
    expect(s3.puts[0]!.ifNoneMatch).toBe('*');
    expect(s3.json('rosters/prueba.json')).toEqual({
      schemaVersion: 2,
      campaign: 'prueba',
      updatedAt: '2026-10-26T10:00:00.000Z',
      updatedBy: 'erick.silva',
      overrides: { 'ana.lopez': { enabled: false, updatedAt: '2026-10-26T10:00:00.000Z', updatedBy: 'erick.silva' } },
    });
  });

  it('dos supervisores a la vez: el roster final tiene ambos cambios', async () => {
    s3.set('rosters/prueba.json', roster({}));
    let injected = false;
    s3.beforePut = (key) => {
      if (key === 'rosters/prueba.json' && !injected) {
        injected = true;
        // Otro escritor gana la carrera entre nuestra lectura y nuestra escritura.
        s3.set('rosters/prueba.json', roster({ luis: { enabled: false, updatedAt: 't', updatedBy: 'otro.lider' } }));
      }
    };
    await updateRoster('prueba', [{ username: 'ana.lopez', enabled: false }], 'erick.silva');
    const final = s3.json('rosters/prueba.json');
    expect(final.overrides.luis.updatedBy).toBe('otro.lider');
    expect(final.overrides['ana.lopez'].enabled).toBe(false);
    expect(s3.puts.filter((p) => p.key === 'rosters/prueba.json')).toHaveLength(2);
  });

  it('conflicto persistente → RosterConflictError tras 3 intentos sin perder cambios ajenos', async () => {
    s3.set('rosters/prueba.json', roster({}));
    s3.beforePut = () => s3.set('rosters/prueba.json', roster({ luis: { enabled: false, updatedAt: 't', updatedBy: 'otro' } }));
    await expect(updateRoster('prueba', [{ username: 'ana.lopez', enabled: false }], 'erick.silva')).rejects.toBeInstanceOf(RosterConflictError);
    expect(s3.puts).toHaveLength(3);
    expect(s3.json('rosters/prueba.json').overrides).toEqual({ luis: { enabled: false, updatedAt: 't', updatedBy: 'otro' } });
  });

  it('habilitar a quien no está en la lista → NotAgentError sin escribir', async () => {
    await expect(updateRoster('prueba', [{ username: 'pedro', enabled: true }], 'e')).rejects.toMatchObject({ agents: ['pedro'] });
    await expect(updateRoster('prueba', [{ username: 'pedro', enabled: true }], 'e')).rejects.toBeInstanceOf(NotAgentError);
    expect(s3.puts).toHaveLength(0);
  });

  it('deshabilitar a cualquier username válido se acepta', async () => {
    await updateRoster('prueba', [{ username: 'pedro', enabled: false }], 'e');
    expect(s3.json('rosters/prueba.json').overrides.pedro.enabled).toBe(false);
  });
});
