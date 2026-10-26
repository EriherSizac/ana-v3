import { describe, it, expect, beforeEach } from 'vitest';
import { PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { installFakeJobsTable } from './fakeJobsTable';
import { claim, confirm, release, STALE_MS } from '../idempotency';

let table: ReturnType<typeof installFakeJobsTable>;
beforeEach(() => {
  table?.ddbMock.restore();
  table = installFakeJobsTable();
});

const T0 = 1_800_000_000_000;

describe('claim / confirm / release', () => {
  it('claim nuevo reserva como pending', async () => {
    expect(await claim('REPORT#a', 'j1', 1, T0)).toEqual({ claimed: true, claimedAt: T0 });
    expect(table.items.get('REPORT#a|j1')).toMatchObject({ status: 'pending', claimedAt: T0 });
    const put = table.ddbMock.commandCalls(PutCommand)[0].args[0].input;
    expect(put.ExpressionAttributeValues?.[':stale']).toBe(T0 - STALE_MS);
  });

  it('claim sobre done → done', async () => {
    await claim('REPORT#a', 'j1', 1, T0);
    await confirm('REPORT#a', 'j1', T0);
    expect(await claim('REPORT#a', 'j1', 1, T0 + 10 * STALE_MS)).toEqual({ claimed: false, state: 'done' });
  });

  it('marcador viejo sin status cuenta como done', async () => {
    table.items.set('REPORT#a|j1', { operatorId: 'REPORT#a', jobId: 'j1', ttl: 1 });
    expect(await claim('REPORT#a', 'j1', 1, T0)).toEqual({ claimed: false, state: 'done' });
  });

  it('claim sobre pending vigente → pending (en curso)', async () => {
    await claim('REPORT#a', 'j1', 1, T0);
    expect(await claim('REPORT#a', 'j1', 1, T0 + 30_000)).toEqual({ claimed: false, state: 'pending' });
  });

  it('claim sobre pending vencido (> 2 min) → se vuelve a reservar', async () => {
    await claim('REPORT#a', 'j1', 1, T0);
    const t1 = T0 + STALE_MS + 1;
    expect(await claim('REPORT#a', 'j1', 1, t1)).toEqual({ claimed: true, claimedAt: t1 });
  });

  it('release solo borra la reserva propia', async () => {
    await claim('REPORT#a', 'j1', 1, T0);
    await release('REPORT#a', 'j1', T0 + 1); // no es la propia
    expect(table.items.has('REPORT#a|j1')).toBe(true);
    await release('REPORT#a', 'j1', T0);
    expect(table.items.has('REPORT#a|j1')).toBe(false);
    const del = table.ddbMock.commandCalls(DeleteCommand)[1].args[0].input;
    expect(del.ConditionExpression).toBe('#s = :pending AND claimedAt = :mine');
  });

  it('release no borra un marcador ya done', async () => {
    await claim('REPORT#a', 'j1', 1, T0);
    await confirm('REPORT#a', 'j1', T0);
    await release('REPORT#a', 'j1', T0);
    expect(table.items.get('REPORT#a|j1')?.status).toBe('done');
  });
});
