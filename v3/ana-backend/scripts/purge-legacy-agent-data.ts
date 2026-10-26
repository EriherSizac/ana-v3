/**
 * Purga de datos de `agent_id` legados (migrate-cli-to-cognito-login, design D12).
 *
 * Los usernames de Cognito no coinciden con los `agent_id` de la palabra del día:
 * tras el modo estricto, este script único limpia lo escrito bajo `agent_id` legados.
 *
 *  - Legado = el agente de la llave NO es un username del pool (`ListUsers`,
 *    normalizado) y el objeto es anterior a `--cutover <ISO>`. Si coincide con un
 *    username del pool es AMBIGUO y no se toca, salvo que figure en el archivo
 *    `--treat-as-legacy` (un username por línea, revisado por una persona).
 *    Los objetos posteriores al cutover son NUEVOS y no se tocan.
 *  - Lista de agentes legados: antes de tocar `agents/{c}/credentials.csv` se
 *    extrae SOLO la columna de usuario (normalizada, sin duplicados, ordenada; nunca
 *    la frase) más los `agent_id` legados de `backups/` y `media/`, y se escribe
 *    `legacy/agents/{c}.json` = {schemaVersion:1, campaign, agents, extractedAt}
 *    (no se reescribe si ya tiene los mismos agentes).
 *  - Se MUEVEN a `legacy/` (copia sin sobrescribir + verificación de tamaño):
 *    `backups/{c}/{agent}/...`, `backups/{c}/{YYYY-MM}/{agent}_{DD}.json`, `media/{c}/{agent}/...`.
 *  - Se ARCHIVAN y PURGAN: `agents/{c}/{agent}-contacts-*`, `assignments/agents/{c}/{agent}-contacts-*`,
 *    `historic/agents/{c}/{agent}-contacts-*`, `chats/{agent}-{c}.csv`, `review/{c}/{agent}/...`,
 *    `review-state/{c}/{agent}/...` y `agents/{c}/credentials.csv`: se copian al bucket
 *    de archivo (misma llave) y se verifica el conteo; si no coincide, aborta sin borrar.
 *  - Borrado de originales (movidos y archivados) solo con `--delete-source` y sin diferencias.
 *  - Dry-run por defecto (inventario por prefijo con conteo y tamaño, nombres por campaña);
 *    `--apply` para escribir. Nunca lista ni toca `versions/`, `campaign-agents/`,
 *    `rosters/`, `uploads/`, `config/` ni `legacy/` (salvo los destinos).
 *  - Log local (`--log`, solo con `--apply`) con las llaves movidas/archivadas/borradas,
 *    nunca contenidos.
 *
 * Uso (perfil `pernexium`, desde WSL):
 *   npx tsx scripts/purge-legacy-agent-data.ts --bucket ana-backend-storage-prod \
 *     --archive-bucket ana-legacy-archive-prod --profile pernexium --cutover 2026-11-10T00:00:00Z \
 *     [--treat-as-legacy revisados.txt] [--apply] [--delete-source] [--log purge.log]
 */
import { appendFileSync, readFileSync } from 'node:fs';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import { normalizeKeySegment } from '../src/lib/campaign';

export const LIST_ROOTS = ['agents/', 'assignments/agents/', 'historic/agents/', 'chats/', 'review/', 'review-state/', 'backups/', 'media/'] as const;
/** Prefijos que nunca se tocan (ni se listan). */
export const PROTECTED_PREFIXES = ['versions/', 'campaign-agents/', 'rosters/', 'uploads/', 'config/', 'legacy/'] as const;

export interface S3Obj {
  key: string;
  size?: number;
  etag?: string;
  lastModified?: Date;
}

export type Kind = 'credentials' | 'purge' | 'move';
export type Klass = 'legacy' | 'ambiguous' | 'new';

export interface Classified {
  key: string;
  prefix: string;
  campaign: string;
  /** Agente normalizado (null en credentials.csv). */
  agent: string | null;
  kind: Kind;
  klass: Klass;
  size: number;
}

const CONTACTS_RE = /^(.+?)-contacts[^/]*$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const DAILY_RE = /^(.+)_\d{2}\.json$/;

/** Ubica campaña/agente/tipo de una llave; null si no es dato de agente. */
export function locate(key: string, campaigns: Set<string>): Omit<Classified, 'klass' | 'size'> | null {
  if (PROTECTED_PREFIXES.some((p) => key.startsWith(p))) return null;
  const parts = key.split('/');
  const contacts = (prefix: string, rest: string[]) => {
    if (rest.length !== 2) return null;
    const [campaign, file] = rest as [string, string];
    if (prefix === 'agents/' && file === 'credentials.csv') return { key, prefix, campaign, agent: null, kind: 'credentials' as const };
    const m = CONTACTS_RE.exec(file);
    return m ? { key, prefix, campaign, agent: normalizeKeySegment(m[1]), kind: 'purge' as const } : null;
  };
  if (key.startsWith('assignments/agents/')) return contacts('assignments/agents/', parts.slice(2));
  if (key.startsWith('historic/agents/')) return contacts('historic/agents/', parts.slice(2));
  if (key.startsWith('agents/')) return contacts('agents/', parts.slice(1));
  if (key.startsWith('review/') || key.startsWith('review-state/')) {
    if (parts.length < 4) return null;
    return { key, prefix: `${parts[0]}/`, campaign: parts[1]!, agent: normalizeKeySegment(parts[2]), kind: 'purge' };
  }
  if (key.startsWith('backups/')) {
    if (parts.length < 4) return null;
    if (MONTH_RE.test(parts[2]!)) {
      if (parts.length !== 4) return null;
      const m = DAILY_RE.exec(parts[3]!);
      return m ? { key, prefix: 'backups/', campaign: parts[1]!, agent: normalizeKeySegment(m[1]), kind: 'move' } : null;
    }
    return { key, prefix: 'backups/', campaign: parts[1]!, agent: normalizeKeySegment(parts[2]), kind: 'move' };
  }
  if (key.startsWith('media/')) {
    if (parts.length < 4) return null;
    return { key, prefix: 'media/', campaign: parts[1]!, agent: normalizeKeySegment(parts[2]), kind: 'move' };
  }
  if (key.startsWith('chats/') && parts.length === 2 && key.endsWith('.csv')) {
    const name = parts[1]!.slice(0, -'.csv'.length);
    // Campaña conocida más larga como sufijo `-{campaign}`
    const match = [...campaigns].filter((c) => name.endsWith(`-${c}`) && name.length > c.length + 1).sort((a, b) => b.length - a.length)[0];
    if (!match) return null;
    return { key, prefix: 'chats/', campaign: match, agent: normalizeKeySegment(name.slice(0, -(match.length + 1))), kind: 'purge' };
  }
  return null;
}

export interface Inputs {
  objects: S3Obj[];
  poolUsers: Set<string>;
  cutover: Date;
  treatAsLegacy: Set<string>;
}

/** Clasifica cada llave en legado / ambiguo / nuevo. */
export function classify({ objects, poolUsers, cutover, treatAsLegacy }: Inputs): Classified[] {
  const campaigns = new Set<string>();
  for (const o of objects) {
    const p = o.key.split('/');
    if (o.key.startsWith('assignments/agents/') || o.key.startsWith('historic/agents/')) p[2] && campaigns.add(p[2]);
    else if (!o.key.startsWith('chats/') && p.length > 2) campaigns.add(p[1]!);
  }
  const out: Classified[] = [];
  for (const o of objects) {
    const loc = locate(o.key, campaigns);
    if (!loc) continue;
    let klass: Klass;
    if (loc.kind === 'credentials') klass = 'legacy';
    else if (o.lastModified && o.lastModified.getTime() >= cutover.getTime()) klass = 'new';
    else if (loc.agent && poolUsers.has(loc.agent)) klass = treatAsLegacy.has(loc.agent) ? 'legacy' : 'ambiguous';
    else klass = 'legacy';
    out.push({ ...loc, klass, size: o.size ?? 0 });
  }
  return out;
}

/** Solo la columna de usuario (primera) de un credentials.csv, normalizada y sin encabezado. */
export function usernamesFromCredentialsCsv(text: string): string[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];
  const header = lines[0]!.split(',').map((h) => normalizeKeySegment(h));
  const col = Math.max(0, header.findIndex((h) => ['user', 'usuario', 'agent_id', 'agent', 'username'].includes(h)));
  const hasHeader = header.some((h) => ['user', 'usuario', 'agent_id', 'agent', 'username', 'password', 'daily_password'].includes(h));
  const rows = hasHeader ? lines.slice(1) : lines;
  return [...new Set(rows.map((l) => normalizeKeySegment(l.split(',')[col])).filter(Boolean))].sort();
}

export interface Options {
  bucket: string;
  archiveBucket: string;
  apply: boolean;
  deleteSource: boolean;
  /** Registro local de llaves (sin contenido). */
  log?: (line: string) => void;
  now?: () => Date;
}

export interface Deps {
  s3: S3Client;
  listPoolUsers: () => Promise<string[]>;
}

export interface RunResult {
  classified: Classified[];
  legacyAgents: Record<string, string[]>;
  written: string[];
  moved: Array<{ from: string; to: string; status: 'copied' | 'identical' | 'conflict' }>;
  archived: string[];
  deleted: string[];
  differences: string[];
  aborted?: string;
}

const isNotFound = (e: any) => e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
const copySource = (bucket: string, key: string) => `${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;

async function head(s3: S3Client, bucket: string, key: string): Promise<{ size?: number; etag?: string } | null> {
  try {
    const h = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { size: h.ContentLength, etag: h.ETag };
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

async function getTextOrNull(s3: S3Client, bucket: string, key: string): Promise<string | null> {
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return (await out.Body?.transformToString()) ?? '';
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

export async function listAll(s3: S3Client, bucket: string): Promise<S3Obj[]> {
  const out = new Map<string, S3Obj>();
  for (const prefix of LIST_ROOTS) {
    let token: string | undefined;
    do {
      const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of res.Contents || []) {
        if (o.Key) out.set(o.Key, { key: o.Key, size: o.Size, etag: o.ETag, lastModified: o.LastModified });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
  }
  return [...out.values()];
}

/** Ejecuta (o simula) la purga. */
export async function runPurge(deps: Deps, opts: Options & { cutover: Date; treatAsLegacy: Set<string> }): Promise<RunResult> {
  if (opts.deleteSource && !opts.apply) throw new Error('--delete-source requiere --apply');
  if (!opts.bucket || !opts.archiveBucket) throw new Error('Faltan --bucket y --archive-bucket');
  if (opts.bucket === opts.archiveBucket) throw new Error('El bucket de archivo debe ser distinto al de datos');
  const log = opts.log ?? (() => {});
  const now = opts.now ?? (() => new Date());
  const { s3 } = deps;

  const poolUsers = new Set((await deps.listPoolUsers()).map(normalizeKeySegment).filter(Boolean));
  const objects = await listAll(s3, opts.bucket);
  const byKey = new Map(objects.map((o) => [o.key, o]));
  const classified = classify({ objects, poolUsers, cutover: opts.cutover, treatAsLegacy: opts.treatAsLegacy });
  const legacy = classified.filter((c) => c.klass === 'legacy');

  // 1. Lista de agentes legados por campaña (solo usernames, nunca frases).
  const legacyAgents: Record<string, Set<string>> = {};
  const addAgent = (campaign: string, agent: string) => (legacyAgents[campaign] ??= new Set()).add(agent);
  for (const c of legacy) {
    if (c.kind === 'credentials') {
      const text = await getTextOrNull(s3, opts.bucket, c.key);
      legacyAgents[c.campaign] ??= new Set();
      for (const u of usernamesFromCredentialsCsv(text ?? '')) addAgent(c.campaign, u);
    } else if (c.kind === 'move' && c.agent) {
      addAgent(c.campaign, c.agent);
    }
  }
  const legacyAgentsOut = Object.fromEntries(Object.entries(legacyAgents).map(([k, v]) => [k, [...v].sort()]));
  const result: RunResult = { classified, legacyAgents: legacyAgentsOut, written: [], moved: [], archived: [], deleted: [], differences: [] };
  if (!opts.apply) return result;

  for (const [campaign, agents] of Object.entries(legacyAgentsOut)) {
    const key = `legacy/agents/${campaign}.json`;
    const existing = await getTextOrNull(s3, opts.bucket, key);
    if (existing !== null) {
      try {
        const prev = JSON.parse(existing);
        if (JSON.stringify(prev?.agents) === JSON.stringify(agents)) continue;
      } catch {
        // contenido distinto: se reescribe con la lista vigente
      }
    }
    const body = { schemaVersion: 1, campaign, agents, extractedAt: now().toISOString() };
    await s3.send(new PutObjectCommand({ Bucket: opts.bucket, Key: key, Body: JSON.stringify(body, null, 2), ContentType: 'application/json' }));
    result.written.push(key);
    log(`WRITE ${key} (${agents.length} usernames)`);
  }

  // 2. Mover respaldos y media legados a legacy/ sin sobrescribir.
  for (const c of legacy.filter((x) => x.kind === 'move')) {
    const to = `legacy/${c.key}`;
    const src = byKey.get(c.key)!;
    const dest = await head(s3, opts.bucket, to);
    if (dest) {
      const same = dest.size === src.size && (!src.etag || dest.etag === src.etag);
      result.moved.push({ from: c.key, to, status: same ? 'identical' : 'conflict' });
      if (!same) result.differences.push(`CONFLICTO ${to} existe con contenido distinto`);
      continue;
    }
    await s3.send(new CopyObjectCommand({ Bucket: opts.bucket, Key: to, CopySource: copySource(opts.bucket, c.key) }));
    result.moved.push({ from: c.key, to, status: 'copied' });
    log(`COPY ${c.key} -> ${to}`);
  }
  for (const m of result.moved.filter((x) => x.status !== 'conflict')) {
    const dest = await head(s3, opts.bucket, m.to);
    if (!dest || dest.size !== byKey.get(m.from)?.size) result.differences.push(`FALTA/DISTINTO ${m.to}`);
  }

  // 3. Archivar lo que se purga (misma llave en el bucket de archivo) y verificar el conteo.
  const toPurge = legacy.filter((x) => x.kind === 'purge' || x.kind === 'credentials');
  for (const c of toPurge) {
    await s3.send(new CopyObjectCommand({ Bucket: opts.archiveBucket, Key: c.key, CopySource: copySource(opts.bucket, c.key) }));
    log(`ARCHIVE ${c.key} -> s3://${opts.archiveBucket}/${c.key}`);
  }
  let archivedOk = 0;
  for (const c of toPurge) {
    const a = await head(s3, opts.archiveBucket, c.key);
    if (a && a.size === byKey.get(c.key)?.size) {
      archivedOk++;
      result.archived.push(c.key);
    }
  }
  if (archivedOk !== toPurge.length) {
    result.aborted = `el archivo tiene ${archivedOk} de ${toPurge.length} objetos; no se borra nada`;
    log(`ABORT ${result.aborted}`);
    return result;
  }

  // 4. Borrar originales solo con --delete-source y sin diferencias.
  if (opts.deleteSource) {
    if (result.differences.length > 0) {
      result.aborted = 'hay diferencias en legacy/; no se borra nada';
      log(`ABORT ${result.aborted}`);
      return result;
    }
    const deletable = [...result.moved.map((m) => m.from), ...toPurge.map((c) => c.key)];
    for (const key of deletable) {
      await s3.send(new DeleteObjectCommand({ Bucket: opts.bucket, Key: key }));
      result.deleted.push(key);
      log(`DELETE ${key}`);
    }
  }
  return result;
}

/** Inventario sin contenido: conteo y tamaño por prefijo y clase, y nombres por campaña. */
export function formatReport(r: RunResult, opts: Options): string {
  const lines = [`Bucket: ${opts.bucket}  Archivo: ${opts.archiveBucket}  Modo: ${opts.apply ? 'APPLY' : 'DRY-RUN'}  delete-source: ${opts.deleteSource}`];
  const groups = new Map<string, { n: number; bytes: number }>();
  for (const c of r.classified) {
    const k = `${c.klass.padEnd(9)} ${c.kind.padEnd(11)} ${c.prefix}`;
    const g = groups.get(k) ?? { n: 0, bytes: 0 };
    g.n++;
    g.bytes += c.size;
    groups.set(k, g);
  }
  lines.push('Inventario (clase, acción, prefijo: objetos / bytes):');
  for (const [k, g] of [...groups.entries()].sort()) lines.push(`  ${k.padEnd(48)} ${g.n} / ${g.bytes}`);
  lines.push('Usernames legados por campaña (solo conteo):');
  for (const [c, a] of Object.entries(r.legacyAgents).sort()) lines.push(`  ${c}: ${a.length}`);
  for (const c of r.classified.filter((x) => x.klass === 'ambiguous')) lines.push(`AMBIGUO ${c.key}  # agente del pool; revisar y usar --treat-as-legacy`);
  if (opts.apply) {
    lines.push(`Escritos: ${r.written.length}  Movidos: ${r.moved.filter((m) => m.status === 'copied').length}  Idénticos: ${r.moved.filter((m) => m.status === 'identical').length}  Archivados: ${r.archived.length}  Borrados: ${r.deleted.length}`);
  }
  for (const d of r.differences) lines.push(`DIFERENCIA ${d}`);
  if (r.aborted) lines.push(`ABORTADO: ${r.aborted}`);
  return lines.join('\n');
}

export function parseArgs(argv: string[]) {
  const get = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const bucket = get('--bucket');
  const archiveBucket = get('--archive-bucket');
  const cutoverRaw = get('--cutover');
  if (!bucket) throw new Error('Falta --bucket <nombre>');
  if (!archiveBucket) throw new Error('Falta --archive-bucket <nombre>');
  if (!cutoverRaw || !Number.isFinite(Date.parse(cutoverRaw))) throw new Error('Falta --cutover <fecha ISO del release del CLI>');
  return {
    bucket,
    archiveBucket,
    cutover: new Date(cutoverRaw),
    profile: get('--profile'),
    region: get('--region') || 'us-east-1',
    userPoolId: get('--user-pool-id') || 'us-east-2_UepfOyKpd',
    cognitoRegion: get('--cognito-region') || 'us-east-2',
    treatAsLegacyPath: get('--treat-as-legacy'),
    logPath: get('--log') || `purge-legacy-agent-data-${new Date().toISOString().replace(/[:.]/g, '-')}.log`,
    apply: argv.includes('--apply'),
    deleteSource: argv.includes('--delete-source'),
  };
}

export async function listPoolUsernames(client: CognitoIdentityProviderClient, userPoolId: string): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  do {
    const res = await client.send(new ListUsersCommand({ UserPoolId: userPoolId, PaginationToken: token, AttributesToGet: [] }));
    for (const u of res.Users || []) if (u.Username) out.push(u.Username);
    token = res.PaginationToken;
  } while (token);
  return out;
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.profile) process.env.AWS_PROFILE = args.profile;
  const treatAsLegacy = new Set(
    args.treatAsLegacyPath
      ? readFileSync(args.treatAsLegacyPath, 'utf8')
          .split(/\r?\n/)
          .map(normalizeKeySegment)
          .filter(Boolean)
      : [],
  );
  const s3 = new S3Client({ region: args.region });
  const cognito = new CognitoIdentityProviderClient({ region: args.cognitoRegion });
  const log = args.apply ? (line: string) => appendFileSync(args.logPath, `${new Date().toISOString()} ${line}\n`) : undefined;
  const r = await runPurge({ s3, listPoolUsers: () => listPoolUsernames(cognito, args.userPoolId) }, { ...args, treatAsLegacy, log });
  console.log(formatReport(r, args));
  if (args.apply) console.log(`Log de llaves: ${args.logPath}`);
  if (r.aborted || r.differences.length > 0) process.exit(2);
};

if (/purge-legacy-agent-data\.[cm]?[tj]s$/.test(process.argv[1] || '')) {
  main().catch((error) => {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
