import type { AwsStub } from 'aws-sdk-client-mock';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

/**
 * S3 en memoria con ETag y escrituras condicionales (If-Match / If-None-Match),
 * para probar lectura-modificación-escritura del roster y manifiestos.
 * `beforePut` permite simular un escritor concurrente justo antes de un Put.
 */
export interface CondObject {
  body: string;
  etag: string;
  lastModified: Date;
  metadata?: Record<string, string>;
}

export interface CondS3 {
  store: Map<string, CondObject>;
  puts: Array<{ key: string; body: string; ifMatch?: string; ifNoneMatch?: string }>;
  beforePut?: (key: string) => void;
  set: (key: string, body: string, lastModified?: Date) => void;
  json: (key: string) => any;
}

const err = (name: string, status: number) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });

export function installCondS3(stub: AwsStub<any, any, any>, initial: Record<string, string> = {}, pageSize = 1000): CondS3 {
  let n = 0;
  const store = new Map<string, CondObject>();
  const nextEtag = () => `"etag-${++n}"`;
  const s3: CondS3 = {
    store,
    puts: [],
    set: (key, body, lastModified = new Date()) => store.set(key, { body, etag: nextEtag(), lastModified }),
    json: (key) => JSON.parse(store.get(key)!.body),
  };
  for (const [k, v] of Object.entries(initial)) s3.set(k, v);

  stub.on(GetObjectCommand).callsFake((input: any) => {
    const obj = store.get(input.Key);
    if (!obj) throw err('NoSuchKey', 404);
    return {
      Body: { transformToString: async () => obj.body } as any,
      ETag: obj.etag,
      LastModified: obj.lastModified,
      Metadata: obj.metadata ?? {},
    };
  });

  stub.on(HeadObjectCommand).callsFake((input: any) => {
    const obj = store.get(input.Key);
    if (!obj) throw err('NotFound', 404);
    return { ETag: obj.etag, LastModified: obj.lastModified, ContentLength: obj.body.length, Metadata: obj.metadata ?? {} };
  });

  stub.on(PutObjectCommand).callsFake((input: any) => {
    s3.beforePut?.(input.Key);
    const body = typeof input.Body === 'string' ? input.Body : Buffer.from(input.Body ?? '').toString('utf8');
    s3.puts.push({ key: input.Key, body, ifMatch: input.IfMatch, ifNoneMatch: input.IfNoneMatch });
    const cur = store.get(input.Key);
    if (input.IfNoneMatch === '*' && cur) throw err('PreconditionFailed', 412);
    if (input.IfMatch && (!cur || cur.etag !== input.IfMatch)) throw err('PreconditionFailed', 412);
    store.set(input.Key, { body, etag: nextEtag(), lastModified: new Date(), metadata: input.Metadata });
    return { ETag: store.get(input.Key)!.etag };
  });

  stub.on(ListObjectsV2Command).callsFake((input: any) => {
    const keys = [...store.keys()].filter((k) => k.startsWith(input.Prefix || '')).sort();
    const start = input.ContinuationToken ? Number(input.ContinuationToken) : 0;
    const page = keys.slice(start, start + pageSize);
    const next = start + pageSize < keys.length ? String(start + pageSize) : undefined;
    return {
      Contents: page.map((Key) => ({ Key, LastModified: store.get(Key)!.lastModified, Size: store.get(Key)!.body.length, ETag: store.get(Key)!.etag })),
      KeyCount: page.length,
      IsTruncated: !!next,
      NextContinuationToken: next,
    };
  });

  stub.on(CopyObjectCommand).callsFake((input: any) => {
    const source = decodeURIComponent(String(input.CopySource).replace(/^[^/]+\//, ''));
    const obj = store.get(source);
    if (!obj) throw err('NoSuchKey', 404);
    if (input.IfNoneMatch === '*' && store.has(input.Key)) throw err('PreconditionFailed', 412);
    store.set(input.Key, { ...obj, lastModified: new Date() });
    return {};
  });

  stub.on(DeleteObjectCommand).callsFake((input: any) => {
    store.delete(input.Key);
    return {};
  });

  return s3;
}
