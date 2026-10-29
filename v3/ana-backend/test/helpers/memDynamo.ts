import { BatchGetCommand, UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { AwsStub } from 'aws-sdk-client-mock';

/**
 * DynamoDB en memoria para las pruebas del registro de WhatsApp. Interpreta
 * solo las expresiones que usa `src/lib/waStatus.ts`:
 *   condición  `attribute_not_exists(#a) OR #b < :t`
 *   update     `SET #a = :x, ... [REMOVE #n, ...] [ADD #c :one]`
 * y `BatchGetCommand` con `unprocessed` configurable por llamada.
 */
export interface MemDynamo {
  table: Map<string, Record<string, unknown>>;
  updates: Array<Record<string, unknown>>;
  batchGets: Array<string[]>;
  /** Por llamada a BatchGet: cuántas llaves devolver como `UnprocessedKeys` (desde el final). */
  unprocessed: number[];
  failUpdates: boolean;
}

type Names = Record<string, string>;
type Values = Record<string, unknown>;

const resolve = (tok: string, names: Names) => (tok.startsWith('#') ? names[tok]! : tok);

function evalCondition(expr: string, item: Record<string, unknown> | undefined, names: Names, values: Values): boolean {
  return expr.split(' OR ').some((part) => {
    const p = part.trim();
    const ne = /^attribute_not_exists\((#?\w+)\)$/.exec(p);
    if (ne) return item === undefined || item[resolve(ne[1]!, names)] === undefined;
    const lt = /^(#?\w+) < (:\w+)$/.exec(p);
    if (lt) {
      const v = item?.[resolve(lt[1]!, names)];
      return v !== undefined && String(v) < String(values[lt[2]!]);
    }
    throw new Error(`condición no soportada: ${p}`);
  });
}

function applyUpdate(expr: string, item: Record<string, unknown>, names: Names, values: Values): void {
  const m = /^SET (.+?)(?: REMOVE (.+?))?(?: ADD (#?\w+) (:\w+))?$/.exec(expr);
  if (!m) throw new Error(`update no soportado: ${expr}`);
  for (const a of m[1]!.split(', ')) {
    const [k, v] = a.split(' = ');
    item[resolve(k!.trim(), names)] = values[v!.trim()];
  }
  for (const r of m[2]?.split(', ') ?? []) delete item[resolve(r.trim(), names)];
  if (m[3]) {
    const k = resolve(m[3], names);
    item[k] = Number(item[k] ?? 0) + Number(values[m[4]!]);
  }
}

export function installMemDynamo(mock: AwsStub<any, any, DynamoDBDocumentClient['config']>): MemDynamo {
  const db: MemDynamo = { table: new Map(), updates: [], batchGets: [], unprocessed: [], failUpdates: false };
  mock.on(UpdateCommand).callsFake(async (input: any) => {
    db.updates.push(input);
    if (db.failUpdates) throw Object.assign(new Error('boom'), { name: 'InternalServerError' });
    const key = input.Key.phone as string;
    const current = db.table.get(key);
    const names = input.ExpressionAttributeNames ?? {};
    const values = input.ExpressionAttributeValues ?? {};
    if (input.ConditionExpression && !evalCondition(input.ConditionExpression, current, names, values)) {
      throw Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });
    }
    const next = { ...(current ?? { phone: key }) };
    applyUpdate(input.UpdateExpression, next, names, values);
    db.table.set(key, next);
    return {};
  });
  mock.on(BatchGetCommand).callsFake(async (input: any) => {
    const [table, req] = Object.entries<any>(input.RequestItems)[0]!;
    const keys = req.Keys.map((k: any) => k.phone as string);
    db.batchGets.push(keys);
    if (keys.length > 100) throw Object.assign(new Error('Too many items requested'), { name: 'ValidationException' });
    const skip = db.unprocessed.shift() ?? 0;
    const served = keys.slice(0, keys.length - skip);
    const left = keys.slice(keys.length - skip);
    return {
      Responses: { [table]: served.map((k: string) => db.table.get(k)).filter(Boolean) },
      UnprocessedKeys: left.length ? { [table]: { Keys: left.map((phone: string) => ({ phone })) } } : {},
    };
  });
  return db;
}
