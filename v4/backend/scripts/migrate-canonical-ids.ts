/**
 * Migración única a identificadores canónicos (v4-canonical-identity-keys D5).
 *
 * 1. Precheck (siempre): `DescribeUserPool` (CaseSensitive) + `ListUsers` →
 *    usuarios afectados (username ≠ canónico, o segmento S3 saneado ≠
 *    codificado) y colisiones (dos usuarios con el mismo canónico o el mismo
 *    segmento saneado). Informativo: se esperan 0 colisiones.
 * 2. `--apply`: por cada afectado copia (sin sobrescribir) conversaciones (gana
 *    el `lastMessageTime` mayor), mensajes (`convKey` nuevo, `mediaKey`
 *    reescrito), jobs y marcadores (`REPORT#`, `OPEN#`, `MANUAL#`), roster
 *    `agents`; borra su entrada de `accesscache` (se recalcula); copia en S3
 *    `media/<safe>/`, `wa-sessions/<safe>/` y `csv-uploads/<safe>/` al segmento
 *    codificado. Idempotente: puede correrse dos veces (pasos a y c de D6).
 * 3. `--delete-source` (corrida posterior, tras verificar): borra los orígenes
 *    que ya tienen copia. Nunca en la misma corrida que `--apply`.
 *
 * Dry-run por defecto: solo imprime el reporte. Con colisiones, `--apply` y
 * `--delete-source` se niegan (revisar el caso a mano). Nunca imprime
 * contenidos (mensajes, filas, teléfonos), solo conteos.
 *
 * Uso (WSL, perfil `pernexium`):
 *   AWS_PROFILE=pernexium npx -y tsx@4 scripts/migrate-canonical-ids.ts --stage dev
 *     [--region us-east-2] [--user-pool us-east-2_UepfOyKpd] [--apply | --delete-source]
 */
import {
  CognitoIdentityProviderClient,
  DescribeUserPoolCommand,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { canonicalOperatorId, encodeKeySegment, legacySafeSegment } from '../src/lib/identity';

// ---------------- Lógica pura (probada con vitest) ----------------

export interface AffectedUser {
  username: string; // tal como lo emite el pool
  canonical: string;
  legacySegment: string; // safeUser previo
  segment: string; // encodeKeySegment(canonical)
  ddbMoves: boolean; // username ≠ canónico → particiones nuevas
  s3Moves: boolean; // segmento saneado ≠ codificado
}

export interface Precheck {
  total: number;
  affected: AffectedUser[];
  /** Usuarios distintos con el mismo canónico o el mismo segmento saneado. */
  collisions: { kind: 'canonical' | 'legacySegment'; value: string; users: string[] }[];
}

export function planUser(username: string): AffectedUser {
  const canonical = canonicalOperatorId(username);
  const legacySegment = legacySafeSegment(username);
  const segment = encodeKeySegment(canonical);
  return { username, canonical, legacySegment, segment, ddbMoves: username !== canonical, s3Moves: legacySegment !== segment };
}

export function precheck(usernames: readonly string[]): Precheck {
  const plans = usernames.map(planUser);
  const collisions: Precheck['collisions'] = [];
  for (const kind of ['canonical', 'legacySegment'] as const) {
    const groups = new Map<string, string[]>();
    for (const p of plans) groups.set(p[kind], [...(groups.get(p[kind]) ?? []), p.username]);
    for (const [value, users] of groups) if (users.length > 1) collisions.push({ kind, value, users });
  }
  return { total: plans.length, affected: plans.filter((p) => p.ddbMoves || p.s3Moves), collisions };
}

/** Reescribe el prefijo `media/<legado>/` de un mediaKey al segmento codificado. */
export function rewriteMediaKey(mediaKey: unknown, u: AffectedUser): unknown {
  if (typeof mediaKey !== 'string') return mediaKey;
  const from = `media/${u.legacySegment}/`;
  return mediaKey.startsWith(from) ? `media/${u.segment}/${mediaKey.slice(from.length)}` : mediaKey;
}

/** Destino S3 de una llave del usuario (o null si no es suya). */
export function targetKey(key: string, u: AffectedUser): string | null {
  for (const prefix of ['media/', 'wa-sessions/', 'csv-uploads/']) {
    const from = `${prefix}${u.legacySegment}/`;
    if (key.startsWith(from)) return `${prefix}${u.segment}/${key.slice(from.length)}`;
  }
  return null;
}

export type Mode = 'dry-run' | 'apply' | 'delete-source';

export function parseArgs(argv: readonly string[]): { stage: string; region: string; userPool: string; mode: Mode } {
  const get = (k: string) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const apply = argv.includes('--apply');
  const del = argv.includes('--delete-source');
  if (apply && del) throw new Error('--apply y --delete-source van en corridas separadas');
  const stage = get('--stage');
  if (!stage) throw new Error('falta --stage');
  return {
    stage,
    region: get('--region') ?? 'us-east-2',
    userPool: get('--user-pool') ?? 'us-east-2_UepfOyKpd',
    mode: apply ? 'apply' : del ? 'delete-source' : 'dry-run',
  };
}

// ---------------- Ejecución contra AWS ----------------

const isCond = (e: unknown) => (e as { name?: string })?.name === 'ConditionalCheckFailedException';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const T = (name: string) => `ana-backend-${name}-${args.stage}`;
  const cognito = new CognitoIdentityProviderClient({ region: args.region });
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: args.region }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const s3 = new S3Client({ region: args.region });

  const pool = await cognito.send(new DescribeUserPoolCommand({ UserPoolId: args.userPool }));
  const usernames: string[] = [];
  let token: string | undefined;
  do {
    const res = await cognito.send(new ListUsersCommand({ UserPoolId: args.userPool, PaginationToken: token, Limit: 60 }));
    for (const u of res.Users ?? []) if (u.Username) usernames.push(u.Username);
    token = res.PaginationToken;
  } while (token);

  const check = precheck(usernames);
  console.log(
    JSON.stringify(
      {
        stage: args.stage,
        mode: args.mode,
        caseSensitive: pool.UserPool?.UsernameConfiguration?.CaseSensitive ?? null,
        users: check.total,
        affected: check.affected.map(({ username, canonical, legacySegment, segment }) => ({ username, canonical, legacySegment, segment })),
        collisions: check.collisions,
      },
      null,
      2,
    ),
  );
  if (args.mode === 'dry-run') return;
  if (check.collisions.length > 0) {
    console.error('Hay colisiones: revisa esos usuarios a mano; no se aplica nada.');
    process.exitCode = 2;
    return;
  }

  const queryAll = async (table: string, keyName: string, value: string) => {
    const out: Record<string, any>[] = [];
    let start: Record<string, any> | undefined;
    do {
      const r = await ddb.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: '#k = :v',
          ExpressionAttributeNames: { '#k': keyName },
          ExpressionAttributeValues: { ':v': value },
          ExclusiveStartKey: start,
        }),
      );
      out.push(...((r.Items ?? []) as Record<string, any>[]));
      start = r.LastEvaluatedKey;
    } while (start);
    return out;
  };
  const putNew = async (table: string, item: Record<string, any>, cond: string, extra: Record<string, any> = {}) => {
    try {
      await ddb.send(new PutCommand({ TableName: table, Item: item, ConditionExpression: cond, ...extra }));
      return 1;
    } catch (e) {
      if (isCond(e)) return 0; // ya existe (o más reciente): no se sobrescribe
      throw e;
    }
  };
  const listKeys = async (bucket: string, prefix: string) => {
    const keys: string[] = [];
    let ct: string | undefined;
    do {
      const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: ct }));
      for (const o of r.Contents ?? []) if (o.Key) keys.push(o.Key);
      ct = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (ct);
    return keys;
  };
  const exists = async (bucket: string, key: string) =>
    s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key })).then(
      () => true,
      () => false,
    );

  for (const u of check.affected) {
    const counts: Record<string, number> = {};
    const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
    const del = args.mode === 'delete-source';

    if (u.ddbMoves || u.s3Moves) {
      // Conversaciones y mensajes.
      const convs = await queryAll(T('conversations'), 'operatorId', u.username);
      for (const c of convs) {
        const chatId = String(c.chatId);
        const msgs = await queryAll(T('messages'), 'convKey', `${u.username}#${chatId}`);
        for (const m of msgs) {
          const target = { ...m, convKey: `${u.canonical}#${chatId}`, mediaKey: rewriteMediaKey(m.mediaKey, u) };
          if (del) {
            if (u.ddbMoves) {
              await ddb.send(new DeleteCommand({ TableName: T('messages'), Key: { convKey: m.convKey, sk: m.sk } }));
              bump('messagesDeleted');
            }
          } else if (u.ddbMoves) bump('messagesCopied', await putNew(T('messages'), target, 'attribute_not_exists(convKey)'));
          else if (target.mediaKey !== m.mediaKey) {
            // Mismo PK: solo cambia el prefijo de media.
            await ddb.send(new PutCommand({ TableName: T('messages'), Item: target }));
            bump('mediaKeysRewritten');
          }
        }
        if (!u.ddbMoves) continue;
        if (del) {
          await ddb.send(new DeleteCommand({ TableName: T('conversations'), Key: { operatorId: u.username, chatId } }));
          bump('conversationsDeleted');
        } else {
          bump(
            'conversationsCopied',
            await putNew(T('conversations'), { ...c, operatorId: u.canonical }, 'attribute_not_exists(operatorId) OR lastMessageTime < :t', {
              ExpressionAttributeValues: { ':t': Number(c.lastMessageTime ?? 0) },
            }),
          );
        }
      }
    }

    if (u.ddbMoves) {
      // Jobs y marcadores de idempotencia.
      for (const pk of [u.username, `REPORT#${u.username}`, `OPEN#${u.username}`, `MANUAL#${u.username}`]) {
        const newPk = pk.replace(u.username, u.canonical);
        for (const j of await queryAll(T('jobs'), 'operatorId', pk)) {
          if (del) {
            await ddb.send(new DeleteCommand({ TableName: T('jobs'), Key: { operatorId: pk, jobId: j.jobId } }));
            bump('jobsDeleted');
          } else bump('jobsCopied', await putNew(T('jobs'), { ...j, operatorId: newPk }, 'attribute_not_exists(jobId)'));
        }
      }
      // Roster por campaña (Scan: tabla pequeña).
      let start: Record<string, any> | undefined;
      do {
        const r = await ddb.send(
          new ScanCommand({
            TableName: T('agents'),
            FilterExpression: 'operatorId = :o',
            ExpressionAttributeValues: { ':o': u.username },
            ExclusiveStartKey: start,
          }),
        );
        for (const a of r.Items ?? []) {
          if (del) {
            await ddb.send(new DeleteCommand({ TableName: T('agents'), Key: { campaign: a.campaign, operatorId: u.username } }));
            bump('agentsDeleted');
          } else bump('agentsCopied', await putNew(T('agents'), { ...a, operatorId: u.canonical }, 'attribute_not_exists(operatorId)'));
        }
        start = r.LastEvaluatedKey;
      } while (start);
      if (!del) {
        for (const username of [u.username, u.canonical])
          await ddb.send(new DeleteCommand({ TableName: T('accesscache'), Key: { username } }));
        bump('accessCacheCleared');
      }
    }

    if (u.s3Moves) {
      for (const [bucket, prefix] of [
        [T('media'), 'media/'],
        [T('media'), 'wa-sessions/'],
        [T('csv'), 'csv-uploads/'],
      ] as const) {
        for (const key of await listKeys(bucket, `${prefix}${u.legacySegment}/`)) {
          const target = targetKey(key, u)!;
          if (del) {
            if (await exists(bucket, target)) {
              await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
              bump('objectsDeleted');
            } else bump('objectsWithoutCopy');
          } else if (await exists(bucket, target)) bump('objectsAlreadyCopied');
          else {
            await s3.send(new CopyObjectCommand({ Bucket: bucket, Key: target, CopySource: `${bucket}/${key.split('/').map(encodeURIComponent).join('/')}` }));
            bump('objectsCopied');
          }
        }
      }
    }
    console.log(JSON.stringify({ username: u.username, canonical: u.canonical, ...counts }));
  }
}

if (process.argv[1] && /migrate-canonical-ids\.[jt]s$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
