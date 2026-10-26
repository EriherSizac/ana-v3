import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export const ddbMock = mockClient(DynamoDBDocumentClient);
export const s3Mock = mockClient(S3Client);

/** Tabla `agents` en memoria: Map campaign → Map operatorId → item. */
export function installAgentsTable(initial: Record<string, Record<string, any>> = {}) {
  const table = new Map<string, Map<string, any>>();
  for (const [c, ops] of Object.entries(initial)) {
    table.set(c, new Map(Object.entries(ops).map(([op, item]) => [op, { campaign: c, operatorId: op, ...item }])));
  }
  ddbMock.on(QueryCommand).callsFake((input: any) => ({
    Items: [...(table.get(input.ExpressionAttributeValues[':c'])?.values() ?? [])],
  }));
  ddbMock.on(GetCommand).callsFake((input: any) => ({ Item: table.get(input.Key.campaign)?.get(input.Key.operatorId) }));
  ddbMock.on(UpdateCommand).callsFake((input: any) => {
    const { campaign, operatorId } = input.Key;
    const m = table.get(campaign) ?? new Map();
    table.set(campaign, m);
    const item = m.get(operatorId) ?? { campaign, operatorId };
    const v = input.ExpressionAttributeValues;
    // Soporta las dos expresiones SET de lib/agents.ts.
    if (input.UpdateExpression.includes('lastSeen')) item.lastSeen = v[':t'];
    if (input.UpdateExpression.includes('enabled =')) {
      item.enabled = v[':e'];
      item.enabledUpdatedAt = v[':a'];
      item.enabledUpdatedBy = v[':b'];
    }
    m.set(operatorId, item);
    return {};
  });
  return table;
}

/** Objetos de campaign-agents/ en memoria. */
export function installV3Bucket(objects: Record<string, string>) {
  s3Mock.on(GetObjectCommand).callsFake((input: any) => {
    const body = objects[input.Key];
    if (body === undefined) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    return { Body: { transformToString: async () => body } };
  });
  s3Mock.on(PutObjectCommand).callsFake((input: any) => {
    objects[input.Key] = String(input.Body);
    return {};
  });
  return objects;
}

export const list = (campaign: string, agents: [string, string][], generatedAt = new Date().toISOString()) =>
  JSON.stringify({
    schemaVersion: 1,
    campaign,
    generatedAt,
    agents: agents.map(([username, cognitoUsername]) => ({ username, cognitoUsername, roleIds: ['r1'] })),
  });
