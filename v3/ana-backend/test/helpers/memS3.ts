import type { AwsStub } from 'aws-sdk-client-mock';
import {
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

export interface MemObject {
  body: string;
  lastModified: Date;
}

const noSuchKey = (name = 'NoSuchKey') => Object.assign(new Error(name), { name });

/**
 * S3 en memoria sobre un stub de aws-sdk-client-mock.
 * Soporta List (paginado opcional con pageSize), Get, Put, Head y Copy.
 */
export const installMemS3 = (
  stub: AwsStub<any, any, any>,
  initial: Record<string, string | MemObject> = {},
  pageSize = 1000
) => {
  const store = new Map<string, MemObject>();
  for (const [k, v] of Object.entries(initial)) {
    store.set(k, typeof v === 'string' ? { body: v, lastModified: new Date('2026-01-01T00:00:00Z') } : v);
  }

  stub.on(ListObjectsV2Command).callsFake((input: any) => {
    const keys = [...store.keys()].filter((k) => k.startsWith(input.Prefix || '')).sort();
    const start = input.ContinuationToken ? Number(input.ContinuationToken) : 0;
    const page = keys.slice(start, start + pageSize);
    const next = start + pageSize < keys.length ? String(start + pageSize) : undefined;
    return {
      Contents: page.map((Key) => ({
        Key,
        LastModified: store.get(Key)!.lastModified,
        Size: store.get(Key)!.body.length,
      })),
      KeyCount: page.length,
      IsTruncated: !!next,
      NextContinuationToken: next,
    };
  });

  stub.on(GetObjectCommand).callsFake((input: any) => {
    const obj = store.get(input.Key);
    if (!obj) throw noSuchKey();
    return { Body: { transformToString: async () => obj.body } as any, LastModified: obj.lastModified };
  });

  stub.on(HeadObjectCommand).callsFake((input: any) => {
    const obj = store.get(input.Key);
    if (!obj) throw noSuchKey('NotFound');
    return { LastModified: obj.lastModified, ContentLength: obj.body.length };
  });

  stub.on(PutObjectCommand).callsFake((input: any) => {
    const body = typeof input.Body === 'string' ? input.Body : Buffer.from(input.Body ?? '').toString('utf8');
    store.set(input.Key, { body, lastModified: new Date() });
    return {};
  });

  stub.on(CopyObjectCommand).callsFake((input: any) => {
    const source = decodeURIComponent(String(input.CopySource).replace(/^[^/]+\//, ''));
    const obj = store.get(source);
    if (!obj) throw noSuchKey();
    store.set(input.Key, { ...obj });
    return {};
  });

  stub.on(DeleteObjectCommand).callsFake((input: any) => {
    store.delete(input.Key);
    return {};
  });

  return store;
};
