/**
 * Renombrado de campañas v3 al nombre del catálogo de v4
 * (add-agent-roster-management, design D13).
 *
 * Copia TODOS los prefijos de cada campaña origen al nombre destino:
 *   agents/{c}/ (incl. credentials.csv), assignments/agents/{c}/, rosters/{c}.json,
 *   backups/{c}/, media/{c}/, historic/agents/{c}/, uploads/{c}/, review/{c}/,
 *   review-state/{c}/ y chats/{agent}-{c}.csv (por sufijo).
 * `campaign-agents/` NO se renombra (lo genera la sincronización de v4).
 *
 * - Dry-run por defecto: imprime plan, conteos e inventario de campañas v3
 *   fuera del catálogo (`--catalog catalog.json`, lista de nombres).
 * - `--apply` copia sin sobrescribir: destino idéntico (tamaño + ETag) = ya
 *   copiado; distinto = conflicto. Contactos listos `agents/{c}/{agent}-contacts*`
 *   solo con `--include-ready` (cola consume-once del CLI).
 * - `--delete-source` (requiere `--apply`) borra los orígenes SOLO si la
 *   verificación posterior no encontró diferencias, y solo los que tienen copia
 *   idéntica.
 * - Aborta si encuentra variantes con mayúsculas de una campaña origen sin su
 *   copia normalizada (falta la migración de fix-campaign-case-normalization).
 * - Nunca imprime contenidos de objetos.
 *
 * Uso:
 *   npx tsx scripts/rename-campaigns.ts --bucket ana-backend-storage-prod --profile pernexium \
 *     --mapping campaign-renames.json [--catalog catalog.json] [--apply] [--include-ready] [--delete-source]
 */
import { readFileSync } from 'node:fs';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { normalizeKeySegment } from '../src/lib/campaign';
import { CAMPAIGN_RE } from '../src/lib/identifiers';

/** Prefijos con la campaña como primer segmento de "carpeta". */
export const DIR_PREFIXES = [
  'agents/',
  'assignments/agents/',
  'backups/',
  'media/',
  'historic/agents/',
  'uploads/',
  'review/',
  'review-state/',
] as const;
export const ROSTER_PREFIX = 'rosters/';
export const CHATS_PREFIX = 'chats/';
/** Raíces que se listan (los DIR_PREFIXES anidados quedan cubiertos por su propio listado). */
const LIST_ROOTS = [...DIR_PREFIXES, ROSTER_PREFIX, CHATS_PREFIX];

export type Mapping = Record<string, string>;

export interface S3Obj {
  key: string;
  size?: number;
  etag?: string;
  lastModified?: Date;
}

export type Action = 'copy' | 'identical' | 'conflict' | 'ready-skipped' | 'ambiguous';

export interface PlanItem {
  source: string;
  target: string;
  from: string;
  to: string;
  prefix: string;
  action: Action;
  reason?: string;
}

export interface Plan {
  items: PlanItem[];
  /** Llaves con mayúsculas de una campaña origen SIN copia normalizada → abortar. */
  uppercaseMissing: string[];
  /** Llaves con mayúsculas de una campaña origen que sí tienen copia normalizada (inertes). */
  uppercaseInert: string[];
  /** Campañas v3 con datos que no están en el catálogo (si se pasó). */
  outsideCatalog: string[];
  /** Conteos por campaña origen y prefijo. */
  counts: Array<{ from: string; to: string; prefix: string; source: number; target: number }>;
}

export interface Options {
  bucket: string;
  apply: boolean;
  includeReady: boolean;
  deleteSource: boolean;
}

/** Valida el mapeo: nombres normalizados, sin encadenar, sin destinos repetidos. Lanza Error. */
export function validateMapping(raw: unknown): Mapping {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('El mapeo debe ser un objeto {"vieja":"nueva"}');
  const m: Mapping = {};
  for (const [from, to] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof to !== 'string') throw new Error(`Destino inválido para "${from}"`);
    if (normalizeKeySegment(from) !== from || !CAMPAIGN_RE.test(from)) throw new Error(`Origen no normalizado o inválido: "${from}"`);
    if (normalizeKeySegment(to) !== to || !CAMPAIGN_RE.test(to)) throw new Error(`Destino no normalizado o inválido: "${to}"`);
    if (from === to) throw new Error(`Origen y destino iguales: "${from}"`);
    m[from] = to;
  }
  const sources = new Set(Object.keys(m));
  for (const [from, to] of Object.entries(m)) {
    if (sources.has(to)) throw new Error(`Mapeo encadenado rechazado: "${from}" -> "${to}" -> "${m[to]}"`);
  }
  const targets = Object.values(m);
  const dup = targets.find((t, i) => targets.indexOf(t) !== i);
  if (dup) throw new Error(`Dos orígenes van al mismo destino "${dup}" (revisión manual)`);
  if (Object.keys(m).length === 0) throw new Error('El mapeo está vacío');
  return m;
}

interface Located {
  prefix: string;
  campaignRaw: string;
  /** Reconstruye la llave con otra campaña. */
  withCampaign: (c: string) => string;
}

/** Ubica el segmento de campaña de una llave en los prefijos de carpeta y rosters/. */
export function locateDir(key: string): Located | null {
  // `assignments/agents/` y `historic/agents/` antes que `agents/` no aplica: no comparten inicio.
  for (const p of DIR_PREFIXES) {
    if (!key.startsWith(p)) continue;
    const rest = key.slice(p.length);
    const slash = rest.indexOf('/');
    if (slash <= 0) return null;
    const campaignRaw = rest.slice(0, slash);
    const tail = rest.slice(slash);
    return { prefix: p, campaignRaw, withCampaign: (c) => `${p}${c}${tail}` };
  }
  if (key.startsWith(ROSTER_PREFIX) && key.endsWith('.json')) {
    const campaignRaw = key.slice(ROSTER_PREFIX.length, -'.json'.length);
    if (!campaignRaw || campaignRaw.includes('/')) return null;
    return { prefix: ROSTER_PREFIX, campaignRaw, withCampaign: (c) => `${ROSTER_PREFIX}${c}.json` };
  }
  return null;
}

const READY_RE = /^agents\/[^/]+\/[^/]+-contacts[^/]*\.csv$/;

export function buildPlan(objects: S3Obj[], mapping: Mapping, opts: { includeReady: boolean; catalog?: string[] }): Plan {
  const byKey = new Map(objects.map((o) => [o.key, o]));
  const items: PlanItem[] = [];
  const uppercaseMissing: string[] = [];
  const uppercaseInert: string[] = [];
  const v3Campaigns = new Set<string>();

  const plan = (src: S3Obj, target: string, from: string, to: string, prefix: string) => {
    const dest = byKey.get(target);
    let action: Action = 'copy';
    let reason: string | undefined;
    if (dest) {
      if (dest.size === src.size && dest.etag && dest.etag === src.etag) {
        action = 'identical';
        reason = 'destino idéntico (ya copiado)';
      } else {
        action = 'conflict';
        reason = 'el destino existe con contenido distinto';
      }
    } else if (!opts.includeReady && READY_RE.test(src.key)) {
      action = 'ready-skipped';
      reason = 'contactos listos (consume-once); requiere --include-ready';
    }
    items.push({ source: src.key, target, from, to, prefix, action, reason });
  };

  const sources = Object.keys(mapping);
  for (const o of objects) {
    const loc = locateDir(o.key);
    if (loc) {
      const norm = normalizeKeySegment(loc.campaignRaw);
      if (norm) v3Campaigns.add(norm);
      if (loc.campaignRaw !== norm) {
        if (mapping[norm] !== undefined) {
          (byKey.has(loc.withCampaign(norm)) ? uppercaseInert : uppercaseMissing).push(o.key);
        }
        continue; // los originales con mayúsculas nunca se copian
      }
      const to = mapping[norm];
      if (to !== undefined) plan(o, loc.withCampaign(to), norm, to, loc.prefix);
      continue;
    }
    if (o.key.startsWith(CHATS_PREFIX) && o.key.endsWith('.csv')) {
      const name = o.key.slice(CHATS_PREFIX.length, -'.csv'.length);
      if (name.includes('/')) continue;
      const matches = sources.filter((c) => name.endsWith(`-${c}`) && name.length > c.length + 1);
      if (matches.length === 0) continue;
      if (matches.length > 1) {
        items.push({
          source: o.key,
          target: '',
          from: matches.join('|'),
          to: '',
          prefix: CHATS_PREFIX,
          action: 'ambiguous',
          reason: `coincide con varias campañas origen: ${matches.join(', ')}`,
        });
        continue;
      }
      const from = matches[0]!;
      const agent = name.slice(0, -(from.length + 1));
      plan(o, `${CHATS_PREFIX}${agent}-${mapping[from]}.csv`, from, mapping[from]!, CHATS_PREFIX);
    }
  }

  const counts: Plan['counts'] = [];
  for (const [from, to] of Object.entries(mapping)) {
    for (const prefix of [...DIR_PREFIXES, ROSTER_PREFIX, CHATS_PREFIX]) {
      const src = items.filter((i) => i.from === from && i.prefix === prefix).length;
      const tgt = objects.filter((o) => {
        if (prefix === CHATS_PREFIX) return o.key.startsWith(CHATS_PREFIX) && o.key.endsWith(`-${to}.csv`);
        const loc = locateDir(o.key);
        return loc?.prefix === prefix && loc.campaignRaw === to;
      }).length;
      if (src > 0 || tgt > 0) counts.push({ from, to, prefix, source: src, target: tgt });
    }
  }

  const outsideCatalog = opts.catalog
    ? [...v3Campaigns].filter((c) => !opts.catalog!.map(normalizeKeySegment).includes(c)).sort()
    : [...v3Campaigns].sort();

  return { items, uppercaseMissing, uppercaseInert, outsideCatalog, counts };
}

export async function listAll(client: S3Client, bucket: string): Promise<S3Obj[]> {
  const out = new Map<string, S3Obj>();
  for (const prefix of LIST_ROOTS) {
    let token: string | undefined;
    do {
      const res = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of res.Contents || []) {
        if (o.Key) out.set(o.Key, { key: o.Key, size: o.Size, etag: o.ETag, lastModified: o.LastModified });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
  }
  return [...out.values()];
}

const copySource = (bucket: string, key: string) => `${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;

async function head(client: S3Client, bucket: string, key: string): Promise<{ size?: number; etag?: string } | null> {
  try {
    const h = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { size: h.ContentLength, etag: h.ETag };
  } catch (e: any) {
    if (e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null;
    throw e;
  }
}

export interface RunResult {
  plan: Plan;
  aborted?: string;
  copied: number;
  deleted: number;
  /** Diferencias tras verificar (conflictos, ambiguos, destinos faltantes o distintos). */
  differences: string[];
}

export async function runRename(client: S3Client, mapping: Mapping, opts: Options & { catalog?: string[] }): Promise<RunResult> {
  if (opts.deleteSource && !opts.apply) throw new Error('--delete-source requiere --apply');
  const objects = await listAll(client, opts.bucket);

  // Orígenes inexistentes: ningún objeto de la campaña en ningún prefijo.
  const initial = buildPlan(objects, mapping, opts);
  const withData = new Set(initial.items.map((i) => i.from));
  for (const from of Object.keys(mapping)) {
    if (!withData.has(from) && !initial.uppercaseMissing.some((k) => normalizeKeySegment(locateDir(k)?.campaignRaw) === from)) {
      throw new Error(`La campaña origen "${from}" no tiene datos en v3`);
    }
  }
  if (initial.uppercaseMissing.length > 0) {
    return {
      plan: initial,
      aborted: 'hay llaves con mayúsculas de campañas origen sin copia normalizada; aplica primero scripts/migrate-campaign-case.ts',
      copied: 0,
      deleted: 0,
      differences: [],
    };
  }
  if (!opts.apply) return { plan: initial, copied: 0, deleted: 0, differences: [] };

  let copied = 0;
  for (const item of initial.items) {
    if (item.action !== 'copy') continue;
    // Revalidar justo antes de copiar: nunca sobrescribir.
    if (await head(client, opts.bucket, item.target)) {
      item.action = 'conflict';
      item.reason = 'el destino apareció durante el renombrado';
      continue;
    }
    await client.send(new CopyObjectCommand({ Bucket: opts.bucket, Key: item.target, CopySource: copySource(opts.bucket, item.source) }));
    copied++;
  }

  // Verificación: cada origen copiado debe tener destino idéntico.
  const differences: string[] = [];
  const srcInfo = new Map(objects.map((o) => [o.key, o]));
  const verified: PlanItem[] = [];
  for (const item of initial.items) {
    if (item.action === 'conflict' || item.action === 'ambiguous') {
      differences.push(`${item.action.toUpperCase()} ${item.source} -> ${item.target || '?'}`);
      continue;
    }
    if (item.action === 'ready-skipped') continue;
    const dest = await head(client, opts.bucket, item.target);
    const src = srcInfo.get(item.source);
    if (!dest || dest.size !== src?.size || (src?.etag && dest.etag !== src.etag)) {
      differences.push(`FALTA/DISTINTO ${item.target}`);
      continue;
    }
    verified.push(item);
  }

  let deleted = 0;
  if (opts.deleteSource && differences.length === 0) {
    for (const item of verified) {
      await client.send(new DeleteObjectCommand({ Bucket: opts.bucket, Key: item.source }));
      deleted++;
    }
  }
  const after = buildPlan(await listAll(client, opts.bucket), mapping, opts);
  return { plan: { ...initial, counts: after.counts }, copied, deleted, differences };
}

export function formatReport(r: RunResult, opts: Options): string {
  const lines: string[] = [];
  lines.push(
    `Bucket: ${opts.bucket}  Modo: ${opts.apply ? 'APPLY' : 'DRY-RUN'}  include-ready: ${opts.includeReady}  delete-source: ${opts.deleteSource}`,
  );
  if (r.aborted) lines.push(`ABORTADO: ${r.aborted}`);
  for (const k of r.plan.uppercaseMissing) lines.push(`MAYÚSCULAS-SIN-COPIA ${k}`);
  for (const k of r.plan.uppercaseInert) lines.push(`MAYÚSCULAS-INERTE    ${k}  (original de la migración de mayúsculas; no se copia)`);
  for (const p of r.plan.items) {
    const verb = p.action === 'copy' ? (opts.apply ? 'COPIADO' : 'COPIAR') : p.action.toUpperCase();
    lines.push(`${verb.padEnd(14)} ${p.source} -> ${p.target || '?'}${p.reason ? `  # ${p.reason}` : ''}`);
  }
  lines.push('Conteos (origen planificado / destino actual):');
  for (const c of r.plan.counts) lines.push(`  ${c.from} -> ${c.to}  ${c.prefix.padEnd(20)} ${c.source} / ${c.target}`);
  lines.push(`Campañas v3 fuera del catálogo: ${r.plan.outsideCatalog.join(', ') || '(ninguna)'}`);
  const count = (a: Action) => r.plan.items.filter((p) => p.action === a).length;
  lines.push(
    `Resumen: copy=${count('copy')} identical=${count('identical')} conflict=${count('conflict')} ready-skipped=${count('ready-skipped')} ambiguous=${count('ambiguous')}` +
      (opts.apply ? ` copiados=${r.copied} borrados=${r.deleted} diferencias=${r.differences.length}` : ''),
  );
  for (const d of r.differences) lines.push(`DIFERENCIA ${d}`);
  if (opts.deleteSource && r.differences.length > 0) lines.push('No se borró ningún origen: hay diferencias.');
  return lines.join('\n');
}

export function parseArgs(argv: string[]) {
  const get = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const bucket = get('--bucket');
  if (!bucket) throw new Error('Falta --bucket <nombre>');
  const mappingPath = get('--mapping');
  if (!mappingPath) throw new Error('Falta --mapping <campaign-renames.json>');
  const catalogPath = get('--catalog');
  return {
    bucket,
    profile: get('--profile'),
    region: get('--region') || 'us-east-1',
    mappingPath,
    catalogPath,
    apply: argv.includes('--apply'),
    includeReady: argv.includes('--include-ready'),
    deleteSource: argv.includes('--delete-source'),
  };
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.profile) process.env.AWS_PROFILE = args.profile;
  const mapping = validateMapping(JSON.parse(readFileSync(args.mappingPath, 'utf8')));
  const catalog = args.catalogPath ? (JSON.parse(readFileSync(args.catalogPath, 'utf8')) as string[]) : undefined;
  const client = new S3Client({ region: args.region });
  const r = await runRename(client, mapping, { ...args, catalog });
  console.log(formatReport(r, args));
  if (r.aborted || r.differences.length > 0) process.exit(2);
};

if (/rename-campaigns\.[cm]?[tj]s$/.test(process.argv[1] || '')) {
  main().catch((error) => {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
