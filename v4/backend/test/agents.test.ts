import { beforeEach, describe, expect, it } from 'vitest';
import { ddbMock, installAgentsTable, installV3Bucket, list, s3Mock } from './helpers';
import { listEnabledAgents, registerAgent, setAgentOverrides } from '../src/lib/agents';
import { clearCampaignAgentsCache, readCampaignAgents, RosterListError } from '../src/lib/campaignAgentsList';

const H = 60 * 60 * 1000;

describe('lib/agents (roster v4)', () => {
  beforeEach(() => {
    ddbMock.reset();
    s3Mock.reset();
    clearCampaignAgentsCache();
  });

  it('el heartbeat usa UpdateCommand SET lastSeen y no borra enabled', async () => {
    const table = installAgentsTable({ didi_vip: { luis: { enabled: false, enabledUpdatedBy: 'lider', enabledUpdatedAt: 'x' } } });
    await registerAgent('didi_vip', 'luis');
    const item = table.get('didi_vip')!.get('luis');
    expect(item.enabled).toBe(false);
    expect(item.enabledUpdatedBy).toBe('lider');
    expect(typeof item.lastSeen).toBe('number');
    expect(ddbMock.commandCalls(UpdateCommandRef())[0]!.args[0].input.UpdateExpression).toBe('SET lastSeen = :t');
  });

  it('setAgentOverrides fija enabled y autor sin tocar lastSeen; puede crear la entrada sin heartbeat', async () => {
    const table = installAgentsTable({ didi_vip: { luis: { lastSeen: 123 } } });
    await setAgentOverrides('didi_vip', [{ operatorId: 'luis', enabled: false }, { operatorId: 'ana.lopez', enabled: false }], 'lider.didi');
    expect(table.get('didi_vip')!.get('luis')).toMatchObject({ lastSeen: 123, enabled: false, enabledUpdatedBy: 'lider.didi' });
    const ana = table.get('didi_vip')!.get('ana.lopez');
    expect(ana).toMatchObject({ enabled: false });
    expect(ana.lastSeen).toBeUndefined();
  });

  it('listEnabledAgents: derivados menos enabled:false; Ana.Lopez coincide con ana.lopez', async () => {
    installAgentsTable({ didi_vip: { luis: { enabled: false }, 'ANA.LOPEZ': { enabled: true } } });
    installV3Bucket({ 'campaign-agents/didi_vip.json': list('didi_vip', [['ana.lopez', 'Ana.Lopez'], ['luis', 'luis']]) });
    expect(await listEnabledAgents('didi_vip')).toEqual(['Ana.Lopez']);
  });

  it('lista inexistente = sin agentes', async () => {
    installAgentsTable();
    installV3Bucket({});
    expect(await listEnabledAgents('ventas')).toEqual([]);
  });

  it('lista de 25 h = error de roster', async () => {
    installAgentsTable();
    installV3Bucket({ 'campaign-agents/prueba.json': list('prueba', [['a', 'a']], new Date(Date.now() - 25 * H).toISOString()) });
    await expect(listEnabledAgents('prueba')).rejects.toBeInstanceOf(RosterListError);
  });

  it.each([
    ['JSON inválido', '{'],
    ['versión ≠ 1', JSON.stringify({ schemaVersion: 2, campaign: 'p', generatedAt: new Date().toISOString(), agents: [] })],
  ])('%s = error', async (_n, body) => {
    installV3Bucket({ 'campaign-agents/prueba.json': body });
    await expect(readCampaignAgents('prueba')).rejects.toBeInstanceOf(RosterListError);
  });

  it('caché de 60 s: una sola lectura de S3', async () => {
    installV3Bucket({ 'campaign-agents/prueba.json': list('prueba', [['a', 'a']]) });
    await readCampaignAgents('prueba');
    await readCampaignAgents('PRUEBA');
    expect(s3Mock.calls()).toHaveLength(1);
  });
});

// Import diferido para no acoplar el helper a lib-dynamodb en la cabecera.
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
function UpdateCommandRef() {
  return UpdateCommand;
}
