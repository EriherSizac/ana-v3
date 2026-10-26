// Tabla de jobs en memoria para pruebas: evalúa las condiciones que usa
// lib/idempotency.ts (no es un intérprete general de DynamoDB).
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';

type Item = Record<string, any>;
const keyOf = (k: { operatorId: string; jobId: string }) => `${k.operatorId}|${k.jobId}`;
const ccf = () => new ConditionalCheckFailedException({ message: 'condición', $metadata: {} });

export function installFakeJobsTable(extraGet?: (key: Item) => Item | undefined) {
  const ddbMock = mockClient(DynamoDBDocumentClient);
  const items = new Map<string, Item>();

  ddbMock.on(PutCommand).callsFake((input) => {
    const item = input.Item as Item;
    const cur = items.get(keyOf(item as any));
    const cond: string | undefined = input.ConditionExpression;
    const v = input.ExpressionAttributeValues ?? {};
    if (cond?.includes('claimedAt < :stale')) {
      const okCond =
        !cur || (cur.status === 'pending' && cur.claimedAt < v[':stale']) || cur.status === 'failed';
      if (!okCond) throw ccf();
    } else if (cond === 'attribute_not_exists(jobId)' && cur) throw ccf();
    items.set(keyOf(item as any), { ...item });
    return {};
  });
  ddbMock.on(GetCommand).callsFake((input) => {
    const fromExtra = extraGet?.(input.Key as Item);
    if (fromExtra !== undefined) return { Item: fromExtra };
    const it = items.get(keyOf(input.Key as any));
    return { Item: it ? { ...it } : undefined };
  });
  ddbMock.on(UpdateCommand).callsFake((input) => {
    const k = keyOf(input.Key as any);
    const cur = items.get(k);
    const v = input.ExpressionAttributeValues ?? {};
    if (!cur || cur.claimedAt !== v[':mine']) throw ccf();
    items.set(k, { ...cur, status: v[':done'] });
    return {};
  });
  ddbMock.on(DeleteCommand).callsFake((input) => {
    const k = keyOf(input.Key as any);
    const cur = items.get(k);
    const v = input.ExpressionAttributeValues ?? {};
    if (!cur || cur.status !== 'pending' || cur.claimedAt !== v[':mine']) throw ccf();
    items.delete(k);
    return {};
  });
  return { ddbMock, items };
}
