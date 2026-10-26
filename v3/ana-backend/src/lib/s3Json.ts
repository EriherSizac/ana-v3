import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * Lectura/escritura de objetos JSON en el bucket de v3 con escritura
 * condicional por ETag (design D2): `If-Match` al reemplazar e
 * `If-None-Match: *` al crear.
 */
export const s3 = new S3Client({ region: 'us-east-1' });
export const bucketName = (): string => process.env.BUCKET_NAME || '';

export interface JsonObject<T = unknown> {
  /** `undefined` si el objeto no existe. */
  text: string | undefined;
  etag: string | null;
  lastModified?: Date;
  value?: T;
}

const isNotFound = (e: any): boolean =>
  e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;

/** Texto + ETag del objeto. `text` undefined si no existe. */
export async function getText(key: string): Promise<JsonObject> {
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: bucketName(), Key: key }));
    const text = (await out.Body?.transformToString()) ?? '';
    return { text, etag: out.ETag ?? null, lastModified: out.LastModified };
  } catch (e) {
    if (isNotFound(e)) return { text: undefined, etag: null };
    throw e;
  }
}

/** ¿La escritura condicional falló porque el objeto cambió? */
export const isConditionalConflict = (e: any): boolean =>
  e?.name === 'PreconditionFailed' ||
  e?.name === 'ConditionalRequestConflict' ||
  e?.$metadata?.httpStatusCode === 412 ||
  e?.$metadata?.httpStatusCode === 409;

/** PutObject condicional: `etag` null = crear solo si no existe. */
export async function putJsonConditional(key: string, value: unknown, etag: string | null): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: key,
      Body: JSON.stringify(value, null, 2),
      ContentType: 'application/json',
      ...(etag ? { IfMatch: etag } : { IfNoneMatch: '*' }),
    }),
  );
}

/** PutObject simple (único escritor, p. ej. manifiestos inmutables). */
export async function putJson(key: string, value: unknown): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: key,
      Body: JSON.stringify(value, null, 2),
      ContentType: 'application/json',
    }),
  );
}
