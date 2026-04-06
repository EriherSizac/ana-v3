import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';

const s3Client = new S3Client({ region: 'us-east-2' });
const TEMPLATES_BUCKET = process.env.TEMPLATES_BUCKET || '';

export const optionsHandler = async (): Promise<APIGatewayProxyResult> => {
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body: '',
  };
};

/**
 * GET /templates?campaign=X&channel=Y        → lista archivos
 * GET /templates?campaign=X&channel=Y&key=Z  → descarga contenido de un archivo
 */
export const getTemplates = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const { campaign, channel, key } = event.queryStringParameters || {};

  if (!campaign || !channel) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'campaign y channel son requeridos' }),
    };
  }

  // GET con key → devuelve contenido del archivo
  if (key) {
    try {
      const command = new GetObjectCommand({
        Bucket: TEMPLATES_BUCKET,
        Key: key,
      });

      const response = await s3Client.send(command);
      const isAudio = channel === 'blaster';

      if (isAudio) {
        const buffer = await streamToBuffer(response.Body as Readable);
        return {
          statusCode: 200,
          body: JSON.stringify({
            content: buffer.toString('base64'),
            encoding: 'base64',
            contentType: 'audio/mpeg',
          }),
        };
      }

      const content = await streamToString(response.Body as Readable);
      return {
        statusCode: 200,
        body: JSON.stringify({ content }),
      };
    } catch (error: unknown) {
      if ((error as { name?: string }).name === 'NoSuchKey') {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: 'Archivo no encontrado' }),
        };
      }
      console.error('Error al obtener template:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Error al obtener el template' }),
      };
    }
  }

  // GET sin key → lista archivos bajo el prefix
  try {
    const prefix = `templates/${campaign}/${channel}/`;
    const command = new ListObjectsV2Command({
      Bucket: TEMPLATES_BUCKET,
      Prefix: prefix,
    });

    const response = await s3Client.send(command);
    const files = (response.Contents || [])
      .filter((obj) => obj.Key && obj.Key !== prefix)
      .map((obj) => ({
        key: obj.Key!,
        filename: obj.Key!.replace(prefix, ''),
      }));

    return {
      statusCode: 200,
      body: JSON.stringify({ files }),
    };
  } catch (error) {
    console.error('Error al listar templates:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error al listar los templates' }),
    };
  }
};

/**
 * POST /templates
 * Body: { campaign, channel, filename, content }
 */
export const putTemplate = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { campaign, channel, filename, content } = body;

    if (!campaign || !channel || !filename || content === undefined) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'campaign, channel, filename y content son requeridos',
        }),
      };
    }

    if (channel === 'blaster') {
      if (!filename.endsWith('.mp3')) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'El canal blaster solo acepta archivos .mp3' }),
        };
      }
      if (typeof content !== 'string') {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'content debe ser el archivo MP3 en base64' }),
        };
      }
    }

    let extension: string;
    let contentType: string;
    let s3Body: string | Buffer;

    if (channel === 'email') {
      extension = '.json';
      contentType = 'application/json';
      s3Body = content;
    } else if (channel === 'blaster') {
      extension = '.mp3';
      contentType = 'audio/mpeg';
      s3Body = Buffer.from(content, 'base64');
    } else {
      extension = '.txt';
      contentType = 'text/plain';
      s3Body = content;
    }

    const filenameWithoutExt = filename.endsWith('.mp3') ? filename.slice(0, -4) : filename;
    const key = `templates/${campaign}/${channel}/${filenameWithoutExt}${extension}`;

    const command = new PutObjectCommand({
      Bucket: TEMPLATES_BUCKET,
      Key: key,
      Body: s3Body,
      ContentType: contentType,
    });

    await s3Client.send(command);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Template guardado correctamente',
        key,
      }),
    };
  } catch (error) {
    console.error('Error al guardar template:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error al guardar el template' }),
    };
  }
};

function streamToString(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    stream.on('error', reject);
  });
}

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
