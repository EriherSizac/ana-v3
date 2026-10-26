/**
 * Migración única: copia a llaves en minúsculas los objetos de `agents/` y
 * `assignments/agents/` cuyo segmento de campaña o parte de agente del nombre
 * (`{agent}-contacts*.csv`) tenga mayúsculas o espacios laterales.
 *
 * - Dry-run por defecto (solo imprime el plan). `--apply` ejecuta CopyObject.
 * - Nunca borra ni sobrescribe: destino existente o colisión de orígenes = conflicto.
 * - `ready` (agents/{campaign}/{agent}-contacts*.csv, cola consume-once del CLI)
 *   solo se copia con `--include-ready` (opcional `--ready-since <ISO>`).
 * - Nunca imprime el contenido de los objetos.
 *
 * Uso:
 *   npx tsx scripts/migrate-campaign-case.ts --bucket <bucket> [--profile <perfil>]
 *     [--region us-east-1] [--apply] [--include-ready] [--ready-since 2026-10-01T00:00:00Z]
 */
import {
  S3Client,
  ListObjectsV2Command,
  CopyObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { normalizeKeySegment } from '../src/lib/campaign';

export const PREFIXES = ['agents/', 'assignments/agents/'] as const;

export type Category = 'credentials' | 'ready' | 'pending';
export type Action =
  | 'copy' // se copiará / se copió
  | 'conflict' // destino existente o colisión entre orígenes
  | 'ready-skipped' // ready sin --include-ready o anterior a --ready-since
  | 'ignored'; // objeto con mayúsculas que no es credenciales ni contactos

export interface SourceObject {
  key: string;
  lastModified?: Date;
}

export interface PlanItem {
  source: string;
  target: string;
  category: Category | 'other';
  action: Action;
  reason?: string;
  lastModified?: string;
}

export interface Options {
  bucket: string;
  apply: boolean;
  includeReady: boolean;
  readySince?: Date;
}

const CONTACTS_RE = /^(.*)-contacts(.*)\.csv$/;

/**
 * Calcula la llave normalizada y la categoría. Devuelve null si la llave no
 * pertenece a los prefijos migrados.
 */
export const normalizeKey = (
  key: string
): { target: string; category: Category | 'other' } | null => {
  const root = PREFIXES.find((p) => key.startsWith(p));
  if (!root) return null;
  const rest = key.slice(root.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const rawCampaign = rest.slice(0, slash);
  const filename = rest.slice(slash + 1);
  const campaign = normalizeKeySegment(rawCampaign);
  if (!campaign) return null;

  if (root === 'agents/' && filename === 'credentials.csv') {
    return { target: `${root}${campaign}/${filename}`, category: 'credentials' };
  }

  const m = filename.includes('/') ? null : CONTACTS_RE.exec(filename);
  if (m) {
    const agent = normalizeKeySegment(m[1]);
    if (agent) {
      return {
        target: `${root}${campaign}/${agent}-contacts${m[2]}.csv`,
        category: root === 'agents/' ? 'ready' : 'pending',
      };
    }
  }
  return { target: `${root}${campaign}/${filename}`, category: 'other' };
};

/** Arma el plan a partir del inventario completo de los prefijos. */
export const buildPlan = (objects: SourceObject[], opts: Omit<Options, 'bucket' | 'apply'>): PlanItem[] => {
  const existing = new Set(objects.map((o) => o.key));
  const candidates: PlanItem[] = [];

  for (const o of objects) {
    const n = normalizeKey(o.key);
    if (!n || n.target === o.key) continue;
    candidates.push({
      source: o.key,
      target: n.target,
      category: n.category,
      action: 'copy',
      lastModified: o.lastModified ? o.lastModified.toISOString() : undefined,
    });
  }

  const byTarget = new Map<string, number>();
  for (const c of candidates) byTarget.set(c.target, (byTarget.get(c.target) || 0) + 1);

  for (const c of candidates) {
    if (c.category === 'other') {
      c.action = 'ignored';
      c.reason = 'no es credentials.csv ni {agent}-contacts*.csv';
    } else if (existing.has(c.target)) {
      c.action = 'conflict';
      c.reason = 'el destino ya existe';
    } else if ((byTarget.get(c.target) || 0) > 1) {
      c.action = 'conflict';
      c.reason = 'varios orígenes colapsan en el mismo destino';
    } else if (c.category === 'ready') {
      if (!opts.includeReady) {
        c.action = 'ready-skipped';
        c.reason = 'contactos listos (consume-once); requiere --include-ready';
      } else if (opts.readySince && (!c.lastModified || new Date(c.lastModified) < opts.readySince)) {
        c.action = 'ready-skipped';
        c.reason = `anterior a --ready-since ${opts.readySince.toISOString()}`;
      }
    }
  }
  return candidates;
};

export const listAll = async (client: S3Client, bucket: string): Promise<SourceObject[]> => {
  const out: SourceObject[] = [];
  for (const prefix of PREFIXES) {
    let token: string | undefined;
    do {
      const res = await client.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })
      );
      for (const o of res.Contents || []) {
        if (o.Key) out.push({ key: o.Key, lastModified: o.LastModified });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
  }
  return out;
};

const copySource = (bucket: string, key: string) =>
  `${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;

const exists = async (client: S3Client, bucket: string, key: string): Promise<boolean> => {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error: any) {
    if (error?.name === 'NotFound' || error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw error;
  }
};

/** Ejecuta inventario + plan y, con apply, las copias. Nunca borra. */
export const runMigration = async (
  client: S3Client,
  opts: Options
): Promise<{ scanned: number; plan: PlanItem[] }> => {
  const objects = await listAll(client, opts.bucket);
  const plan = buildPlan(objects, opts);
  if (!opts.apply) return { scanned: objects.length, plan };

  for (const item of plan) {
    if (item.action !== 'copy') continue;
    // Revalidar justo antes de copiar: nunca sobrescribir.
    if (await exists(client, opts.bucket, item.target)) {
      item.action = 'conflict';
      item.reason = 'el destino apareció durante la migración';
      continue;
    }
    await client.send(
      new CopyObjectCommand({
        Bucket: opts.bucket,
        Key: item.target,
        CopySource: copySource(opts.bucket, item.source),
      })
    );
  }
  return { scanned: objects.length, plan };
};

export const formatReport = (plan: PlanItem[], opts: Options, scanned?: number): string => {
  const lines: string[] = [];
  lines.push(`Bucket: ${opts.bucket}  Modo: ${opts.apply ? 'APPLY' : 'DRY-RUN'}  include-ready: ${opts.includeReady}` +
    (opts.readySince ? `  ready-since: ${opts.readySince.toISOString()}` : ''));
  if (scanned !== undefined) lines.push(`Objetos revisados: ${scanned}`);
  if (plan.length === 0) lines.push('Sin objetos con mayúsculas o espacios en campaña/agente.');
  for (const p of plan) {
    const verb = p.action === 'copy' ? (opts.apply ? 'COPIADO' : 'COPIAR') : p.action.toUpperCase();
    lines.push(
      `${verb.padEnd(13)} [${p.category}] ${p.source} -> ${p.target}` +
        (p.lastModified ? `  (LastModified ${p.lastModified})` : '') +
        (p.reason ? `  # ${p.reason}` : '')
    );
  }
  const count = (a: Action) => plan.filter((p) => p.action === a).length;
  lines.push(
    `Resumen: copy=${count('copy')} conflict=${count('conflict')} ready-skipped=${count('ready-skipped')} ignored=${count('ignored')}`
  );
  return lines.join('\n');
};

export const parseArgs = (argv: string[]) => {
  const get = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const bucket = get('--bucket');
  if (!bucket) throw new Error('Falta --bucket <nombre>');
  const readySinceRaw = get('--ready-since');
  const readySince = readySinceRaw ? new Date(readySinceRaw) : undefined;
  if (readySince && Number.isNaN(readySince.getTime())) throw new Error('--ready-since debe ser una fecha ISO');
  return {
    bucket,
    profile: get('--profile'),
    region: get('--region') || 'us-east-1',
    apply: argv.includes('--apply'),
    includeReady: argv.includes('--include-ready'),
    readySince,
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  // El proveedor de credenciales por defecto respeta AWS_PROFILE.
  if (args.profile) process.env.AWS_PROFILE = args.profile;
  const client = new S3Client({ region: args.region });
  const { scanned, plan } = await runMigration(client, args);
  console.log(formatReport(plan, args, scanned));
};

if (/migrate-campaign-case\.[cm]?[tj]s$/.test(process.argv[1] || '')) {
  main().catch((error) => {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
