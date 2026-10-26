/**
 * Construye el índice de búsqueda del historial legado (add-legacy-chat-history D1):
 *   legacy/backups/{campaign}/{agent}/{phone}/chat_backup.json → legacy/index/{campaign}.json
 *
 * - Excluye los respaldos diarios del estado del agente (`legacy/backups/{campaign}/{YYYY-MM}/...`).
 * - Fechas tomadas de los mensajes (no de la fecha del objeto); respaldo ilegible
 *   → `totalMessages: 0` y fechas null.
 * - Dry-run por defecto (solo imprime conteos); `--apply` escribe los índices.
 * - Nunca imprime contenidos de los respaldos.
 *
 * Uso:
 *   npx tsx scripts/build-legacy-chat-index.ts --bucket ana-backend-storage-prod --profile pernexium \
 *     [--campaign prueba] [--region us-east-1] [--apply]
 */
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { indexEntry, indexKey, type IndexEntry, type LegacyIndex } from '../src/lib/legacyChats';

const BACKUP_RE = /^legacy\/backups\/([^/]+)\/([^/]+)\/([^/]+)\/chat_backup\.json$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

export interface BuildOptions {
  bucket: string;
  apply: boolean;
  campaign?: string;
  now?: () => Date;
}

export interface BuildResult {
  indexes: Record<string, LegacyIndex>;
  written: string[];
  unreadable: number;
}

export async function listBackupKeys(client: S3Client, bucket: string, campaign?: string): Promise<string[]> {
  const prefix = campaign ? `legacy/backups/${campaign}/` : 'legacy/backups/';
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    for (const o of res.Contents ?? []) {
      const m = o.Key ? BACKUP_RE.exec(o.Key) : null;
      if (m && !MONTH_RE.test(m[2]!)) keys.push(o.Key!);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys.sort();
}

export async function buildIndexes(client: S3Client, opts: BuildOptions): Promise<BuildResult> {
  const keys = await listBackupKeys(client, opts.bucket, opts.campaign);
  const byCampaign = new Map<string, IndexEntry[]>();
  let unreadable = 0;
  for (const key of keys) {
    const [, campaign, agent, phone] = BACKUP_RE.exec(key)!;
    let text: string | undefined;
    try {
      const out = await client.send(new GetObjectCommand({ Bucket: opts.bucket, Key: key }));
      text = await out.Body?.transformToString();
    } catch {
      text = undefined;
    }
    const entry = indexEntry(agent!, phone!, text);
    if (entry.totalMessages === 0 && entry.firstMessageAt === null) {
      try {
        JSON.parse(text ?? '');
      } catch {
        unreadable++;
      }
    }
    if (!byCampaign.has(campaign!)) byCampaign.set(campaign!, []);
    byCampaign.get(campaign!)!.push(entry);
  }
  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
  const indexes: Record<string, LegacyIndex> = {};
  for (const [campaign, conversations] of byCampaign) indexes[campaign] = { schemaVersion: 1, generatedAt, conversations };

  const written: string[] = [];
  if (opts.apply) {
    for (const [campaign, index] of Object.entries(indexes)) {
      await client.send(
        new PutObjectCommand({ Bucket: opts.bucket, Key: indexKey(campaign), Body: JSON.stringify(index), ContentType: 'application/json' }),
      );
      written.push(indexKey(campaign));
    }
  }
  return { indexes, written, unreadable };
}

export function formatReport(r: BuildResult, opts: BuildOptions): string {
  const lines = [`Bucket: ${opts.bucket}  Modo: ${opts.apply ? 'APPLY' : 'DRY-RUN'}${opts.campaign ? `  Campaña: ${opts.campaign}` : ''}`];
  for (const [campaign, idx] of Object.entries(r.indexes)) {
    const msgs = idx.conversations.reduce((n, c) => n + c.totalMessages, 0);
    lines.push(`${opts.apply ? 'ESCRITO' : 'ESCRIBIRÍA'} ${indexKey(campaign)}  conversaciones=${idx.conversations.length} mensajes=${msgs}`);
  }
  if (Object.keys(r.indexes).length === 0) lines.push('Sin respaldos legados.');
  lines.push(`Respaldos ilegibles (indexados con 0 mensajes): ${r.unreadable}`);
  return lines.join('\n');
}

export function parseArgs(argv: string[]) {
  const get = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const bucket = get('--bucket');
  if (!bucket) throw new Error('Falta --bucket <nombre>');
  return { bucket, profile: get('--profile'), region: get('--region') || 'us-east-1', campaign: get('--campaign'), apply: argv.includes('--apply') };
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.profile) process.env.AWS_PROFILE = args.profile;
  const client = new S3Client({ region: args.region });
  const r = await buildIndexes(client, args);
  console.log(formatReport(r, args));
};

if (/build-legacy-chat-index\.[cm]?[tj]s$/.test(process.argv[1] || '')) {
  main().catch((error) => {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
