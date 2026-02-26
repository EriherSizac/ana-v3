import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3Client = new S3Client({ region: 'us-east-1' });
const BUCKET_NAME = process.env.BUCKET_NAME || '';

const makeTimestampForKey = (): string => {
  // ISO pero safe para S3 key/filename (sin ':' ni '.')
  return new Date().toISOString().replace(/[:.]/g, '-');
};

type MultipartFile = {
  fieldname: string;
  filename: string | null;
  contentType: string | null;
  data: Buffer;
};

const parseMultipartFormData = (
  event: APIGatewayProxyEvent
): { fields: Record<string, string>; files: MultipartFile[] } => {
  const contentTypeHeader =
    event.headers?.['content-type'] ||
    event.headers?.['Content-Type'] ||
    '';

  const match = contentTypeHeader.match(/boundary=([^;]+)/i);
  if (!match) {
    throw new Error('multipart_missing_boundary');
  }
  const boundary = match[1].trim().replace(/^"|"$/g, '');

  if (!event.body) {
    throw new Error('multipart_missing_body');
  }

  const bodyBuffer = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64')
    : Buffer.from(event.body, 'utf8');

  const boundaryBuf = Buffer.from(`--${boundary}`);
  const delimiter = Buffer.from(`\r\n--${boundary}`);

  // Start after the initial boundary
  const start = bodyBuffer.indexOf(boundaryBuf);
  if (start === -1) {
    throw new Error('multipart_boundary_not_found');
  }

  const parts: Buffer[] = [];
  let cursor = start + boundaryBuf.length;
  while (cursor < bodyBuffer.length) {
    // Skip optional leading CRLF
    if (bodyBuffer[cursor] === 0x0d && bodyBuffer[cursor + 1] === 0x0a) {
      cursor += 2;
    }

    const next = bodyBuffer.indexOf(delimiter, cursor);
    if (next === -1) break;

    const part = bodyBuffer.subarray(cursor, next);
    parts.push(part);
    cursor = next + delimiter.length;

    // If this is the final boundary, it will be followed by "--"
    if (bodyBuffer[cursor] === 0x2d && bodyBuffer[cursor + 1] === 0x2d) {
      break;
    }
  }

  const fields: Record<string, string> = {};
  const files: MultipartFile[] = [];

  for (const part of parts) {
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) continue;

    const headersText = part.subarray(0, headerEnd).toString('utf8');
    let data = part.subarray(headerEnd + 4);

    // Trim trailing CRLF
    if (data.length >= 2 && data[data.length - 2] === 0x0d && data[data.length - 1] === 0x0a) {
      data = data.subarray(0, data.length - 2);
    }

    const cdLine = headersText
      .split('\r\n')
      .find((l) => l.toLowerCase().startsWith('content-disposition:'));
    if (!cdLine) continue;

    const nameMatch = cdLine.match(/name="([^"]+)"/i);
    const fileMatch = cdLine.match(/filename="([^"]*)"/i);
    const fieldname = nameMatch ? nameMatch[1] : '';

    const ctLine = headersText
      .split('\r\n')
      .find((l) => l.toLowerCase().startsWith('content-type:'));
    const contentType = ctLine ? ctLine.split(':').slice(1).join(':').trim() : null;

    if (fileMatch) {
      files.push({
        fieldname,
        filename: fileMatch[1] || null,
        contentType,
        data,
      });
    } else if (fieldname) {
      fields[fieldname] = data.toString('utf8');
    }
  }

  return { fields, files };
};

/**
 * Handler para OPTIONS - solo retorna 200 para CORS preflight
 */
export const optionsHandler = async (): Promise<APIGatewayProxyResult> => {
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body: ''
  };

};

/**
 * Lista archivos de asignaciones (assignments) para un agente/campaña
 * Prefijo: assignments/agents/{campaign}/ y filtra por {agent}-contacts*.csv
 */
export const listAgentAssignments = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const { agent, campaign } = event.pathParameters || {};

    if (!agent || !campaign) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ success: false, message: 'Agente y campaña son requeridos' }),
      };
    }

    const prefix = `assignments/agents/${campaign}/`;
    const listRes = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: prefix,
      })
    );

    const items = (listRes.Contents || [])
      .filter((o) => !!o.Key)
      .map((o) => ({
        key: String(o.Key),
        lastModified: o.LastModified ? new Date(o.LastModified).toISOString() : null,
        size: typeof o.Size === 'number' ? o.Size : null,
      }))
      .filter((o) => {
        const filename = o.key.split('/').pop() || '';
        return filename.startsWith(`${agent}-contacts`) && filename.endsWith('.csv');
      });

    items.sort((a, b) => {
      const ta = a.lastModified ? Date.parse(a.lastModified) : 0;
      const tb = b.lastModified ? Date.parse(b.lastModified) : 0;
      return tb - ta;
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ success: true, data: { agent, campaign, prefix, items } }),
    };
  } catch (error) {
    console.error('Error listando assignments:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ success: false, message: 'Error interno del servidor' }),
    };
  }
};

export const downloadFilesByKey = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    if (!event.body) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ success: false, message: 'Body requerido' }),
      };
    }

    let requestData: any;
    try {
      requestData = JSON.parse(event.body);
    } catch {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ success: false, message: 'Body debe ser JSON válido con campo: key o keys' }),
      };
    }

    const keys: string[] = Array.isArray(requestData?.keys)
      ? requestData.keys.map((k: any) => String(k))
      : requestData?.key
        ? [String(requestData.key)]
        : [];

    const cleanedKeys = keys.map((k) => k.trim()).filter(Boolean);
    if (cleanedKeys.length < 1) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ success: false, message: 'Se requiere key o keys' }),
      };
    }

    const results = await Promise.all(
      cleanedKeys.map(async (key) => {
        try {
          const url = await getSignedUrl(
            s3Client,
            new GetObjectCommand({
              Bucket: BUCKET_NAME,
              Key: key,
            }),
            { expiresIn: 60 * 15 }
          );

          return {
            key,
            ok: true,
            url,
            expiresInSeconds: 60 * 15,
          };
        } catch (error: any) {
          return {
            key,
            ok: false,
            error: error?.name || 'Error',
          };
        }
      })
    );

    const okCount = results.filter((r) => r.ok).length;
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ success: true, data: { okCount, total: results.length, results } }),
    };
  } catch (error) {
    console.error('Error descargando por key(s):', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ success: false, message: 'Error interno del servidor' }),
    };
  }
};

/**
 * Obtiene el CSV assignment actual (assignments) para un agente/campaña
 */
export const getAgentAssignments = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const { agent, campaign } = event.pathParameters || {};

    if (!agent || !campaign) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ success: false, message: 'Agente y campaña son requeridos' }),
      };
    }

    const prefix = `assignments/agents/${campaign}/`;
    const listRes = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: prefix,
      })
    );

    const candidates = (listRes.Contents || [])
      .filter((o) => !!o.Key)
      .map((o) => ({
        key: String(o.Key),
        lastModified: o.LastModified ? new Date(o.LastModified).getTime() : 0,
      }))
      .filter((o) => {
        const filename = o.key.split('/').pop() || '';
        return filename.startsWith(`${agent}-contacts`) && filename.endsWith('.csv');
      })
      .sort((a, b) => b.lastModified - a.lastModified);

    const latest = candidates[0];
    if (!latest?.key) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ success: false, message: 'CSV assignment no encontrado' }),
      };
    }

    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: latest.key,
      })
    );

    const csvContent = await response.Body?.transformToString();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Access-Control-Allow-Origin': '*',
      },
      body: csvContent || '',
    };
  } catch (error: any) {
    if (error?.name === 'NoSuchKey') {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ success: false, message: 'CSV assignment no encontrado' }),
      };
    }

    console.error('Error al obtener CSV assignment:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ success: false, message: 'Error interno del servidor' }),
    };
  }
};

/**
 * Ruta separada para que el agente publique su selección final
 * Escribe en la ruta legacy/deprecated: agents/{campaign}/{agent}-contacts.csv
 */
export const publishAgentContactsDeprecated = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const { agent, campaign } = event.pathParameters || {};

    console.log('[publishAgentContactsDeprecated] start', {
      agent,
      campaign,
      method: event.httpMethod,
      path: event.path,
      hasBody: Boolean(event.body),
      bodyLength: event.body ? event.body.length : 0,
      isBase64Encoded: Boolean((event as any).isBase64Encoded),
      contentType: event.headers?.['content-type'] || event.headers?.['Content-Type'] || '',
    });

    if (!agent || !campaign) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ success: false, message: 'Agente y campaña son requeridos' }),
      };
    }

    if (!event.body) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ success: false, message: 'Body requerido' }),
      };
    }

    const contentTypeHeader =
      event.headers?.['content-type'] ||
      event.headers?.['Content-Type'] ||
      '';

    console.log('[publishAgentContactsDeprecated] content-type check', {
      contentTypeHeader,
    });

    if (!contentTypeHeader.toLowerCase().includes('multipart/form-data')) {
      return {
        statusCode: 415,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ success: false, message: 'Content-Type debe ser multipart/form-data' }),
      };
    }

    let csv: string = '';
    try {
      const { fields, files } = parseMultipartFormData(event);

      console.log('[publishAgentContactsDeprecated] multipart parsed', {
        fieldKeys: Object.keys(fields || {}),
        filesCount: Array.isArray(files) ? files.length : 0,
        files: Array.isArray(files)
          ? files.map((f: any) => ({
              fieldname: f?.fieldname,
              filename: f?.filename,
              mimetype: f?.mimetype,
              size: f?.data?.length,
            }))
          : [],
      });

      const file =
        files.find((f) => f.fieldname === 'file') ||
        files.find((f) => f.fieldname === 'csv') ||
        files[0];

      console.log('[publishAgentContactsDeprecated] selected file', {
        fieldname: (file as any)?.fieldname,
        filename: (file as any)?.filename,
        mimetype: (file as any)?.mimetype,
        size: (file as any)?.data?.length,
        hasFieldsCsv: Boolean((fields as any)?.csv),
      });

      if (file?.data) {
        // Log raw bytes for encoding diagnosis
        const rawBytes = Array.from(file.data.slice(0, 20) as Uint8Array);
        console.log('[publishAgentContactsDeprecated] raw file bytes (first 20):', rawBytes.map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '));
        const hasBOM = rawBytes[0] === 0xEF && rawBytes[1] === 0xBB && rawBytes[2] === 0xBF;
        console.log('[publishAgentContactsDeprecated] BOM detected:', hasBOM);
        csv = file.data.toString('utf8');
        // Strip BOM if present
        if (csv.charCodeAt(0) === 0xFEFF) {
          console.log('[publishAgentContactsDeprecated] Stripping BOM from CSV');
          csv = csv.slice(1);
        }
      } else if (fields.csv) {
        csv = String(fields.csv);
        if (csv.charCodeAt(0) === 0xFEFF) {
          console.log('[publishAgentContactsDeprecated] Stripping BOM from fields.csv');
          csv = csv.slice(1);
        }
      }

      const csvPreview = (csv || '').slice(0, 200);
      const csvLineCount = csv ? csv.split(/\r?\n/).filter((l) => l.trim().length > 0).length : 0;
      console.log('[publishAgentContactsDeprecated] csv extracted', {
        csvLength: csv ? csv.length : 0,
        csvLineCount,
        csvPreview,
        firstCharCode: csv ? csv.charCodeAt(0) : null,
        hasCarriageReturn: csv ? csv.includes('\r') : false,
      });
    } catch (error) {
      console.error('Error parseando multipart:', error);
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ success: false, message: 'Multipart inválido' }),
      };
    }

    if (!csv.trim()) {
      console.log('[publishAgentContactsDeprecated] empty csv after parse', {
        agent,
        campaign,
      });
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ success: false, message: 'Archivo CSV requerido' }),
      };
    }

    const ts = makeTimestampForKey();
    const key_deprecated = `agents/${campaign}/${agent}-contacts-${ts}.csv`;

    const csvRows = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
    console.log('[publishAgentContactsDeprecated] CSV preview (first 5 rows):');
    csvRows.slice(0, 5).forEach((line, idx) => {
      console.log(`  [${idx}] ${line}`);
      // Log char codes of first 30 chars for encoding issues
      const codes = Array.from(line.slice(0, 30)).map(c => `${c}(${c.charCodeAt(0).toString(16)})`);
      console.log(`  [${idx}] charCodes: ${codes.join(' ')}`);
    });
    console.log('[publishAgentContactsDeprecated] total data rows:', csvRows.length - 1);

    console.log('[publishAgentContactsDeprecated] uploading to s3', {
      bucket: BUCKET_NAME,
      key: key_deprecated,
      csvLength: csv.length,
    });
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key_deprecated,
        Body: csv,
        ContentType: 'text/csv',
      })
    );

    console.log('[publishAgentContactsDeprecated] upload done', {
      bucket: BUCKET_NAME,
      key: key_deprecated,
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ success: true, message: 'CSV publicado', data: { agent, campaign, key: key_deprecated } }),
    };
  } catch (error) {
    console.error('Error publicando CSV (deprecated):', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ success: false, message: 'Error interno del servidor' }),
    };
  }
};

export const uploadAgentContactsLogging = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const { agent, campaign } = event.pathParameters || {};

    console.log('[uploadAgentContactsLogging] start', {
      agent,
      campaign,
      hasBody: Boolean(event.body),
      bodyLength: event.body ? event.body.length : 0,
    });

    if (!agent || !campaign) {
      console.log('[uploadAgentContactsLogging] ERROR: missing agent or campaign', { agent, campaign });
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          message: 'Agente y campaña son requeridos'
        })
      };
    }

    if (!event.body) {
      console.log('[uploadAgentContactsLogging] ERROR: no body');
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          message: 'Body requerido'
        })
      };
    }

    let requestData;
    try {
      requestData = JSON.parse(event.body);
    } catch (error) {
      console.error('[uploadAgentContactsLogging] ERROR: JSON parse failed', { error: (error as Error).message, bodyPreview: event.body?.slice(0, 200) });
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          message: 'Body debe ser JSON válido con campos: csv, message y metadata'
        })
      };
    }

    const { csv, message, metadata } = requestData;
    console.log('[uploadAgentContactsLogging] parsed body', {
      hasCsv: Boolean(csv),
      csvLength: csv ? csv.length : 0,
      message: message ? message.slice(0, 80) : null,
      metadata: metadata || null,
    });

    if (!csv || !message || !metadata) {
      console.log('[uploadAgentContactsLogging] ERROR: missing fields', { hasCsv: Boolean(csv), hasMessage: Boolean(message), hasMetadata: Boolean(metadata) });
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          message: 'CSV, mensaje y metadata son requeridos'
        })
      };
    }

    const lines = csv.trim().split('\n');
    if (lines.length < 1) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          message: 'CSV vacío'
        })
      };
    }

    const header = lines[0].trim();
    const newHeader = header.includes('message') ? header : `${header},message`;

    const processedLines = [newHeader];
    let contactCount = 0;

    const escapeCSVField = (field: string): string => {
      if (!field) return '';

      if (field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r')) {
        const escaped = field.replace(/"/g, '""');
        return `"${escaped}"`;
      }

      return field;
    };

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const escapedMessage = escapeCSVField(message);
      const newLine = line.includes(message) ? line : `${line},${escapedMessage}`;
      processedLines.push(newLine);
      contactCount++;
    }

    const processedCsv = processedLines.join('\n') + '\n';

    const key = `logging/${campaign}/${agent}-contacts.csv`;

    console.log('[uploadAgentContactsLogging] CSV preview (first 5 rows):');
    processedLines.slice(0, 5).forEach((line, idx) => console.log(`  [${idx}] ${line}`));

    console.log('[uploadAgentContactsLogging] uploading to S3', {
      bucket: BUCKET_NAME,
      key,
      csvLength: processedCsv.length,
      contactCount,
      headerLine: processedLines[0] || '',
      metadata,
    });

    const s3MetadataLogging: Record<string, string> | undefined = metadata
      ? { metadata_b64: Buffer.from(String(metadata), 'utf8').toString('base64') }
      : undefined;

    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: processedCsv,
      ContentType: 'text/csv',
      Metadata: s3MetadataLogging,
    }));

    console.log(`[uploadAgentContactsLogging] OK: ${key} con ${contactCount} contactos`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        message: 'CSV subido correctamente con mensaje agregado',
        data: {
          agent,
          campaign,
          key,
          contactCount,
          messageAdded: message,
          metadata,
          timestamp: new Date().toISOString()
        }
      })
    };

  } catch (error) {
    console.error('[uploadAgentContactsLogging] UNCAUGHT ERROR:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: false,
        message: 'Error interno del servidor',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};

/**
 * Sube un CSV de contactos para un agente y campaña específicos
 * Recibe el CSV y un mensaje que se agregará a cada contacto
 */
export const uploadAgentContacts = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const { agent, campaign } = event.pathParameters || {};

    console.log('[uploadAgentContacts] start', {
      agent,
      campaign,
      hasBody: Boolean(event.body),
      bodyLength: event.body ? event.body.length : 0,
    });
    
    if (!agent || !campaign) {
      console.log('[uploadAgentContacts] ERROR: missing agent or campaign', { agent, campaign });
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          message: 'Agente y campaña son requeridos'
        })
      };
    }

    if (!event.body) {
      console.log('[uploadAgentContacts] ERROR: no body');
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          message: 'Body requerido'
        })
      };
    }

    // Detectar formato del body: multipart/form-data o JSON
    const contentTypeHeader =
      event.headers?.['content-type'] ||
      event.headers?.['Content-Type'] ||
      '';
    const isMultipart = contentTypeHeader.toLowerCase().includes('multipart/form-data');

    console.log('[uploadAgentContacts] content-type detection', {
      contentTypeHeader,
      isMultipart,
      isBase64Encoded: Boolean((event as any).isBase64Encoded),
    });

    let csv: string = '';
    let message: string = '';
    let metadata: string | undefined;

    if (isMultipart) {
      // Parsear multipart/form-data
      try {
        const { fields, files } = parseMultipartFormData(event);

        console.log('[uploadAgentContacts] multipart parsed', {
          fieldKeys: Object.keys(fields || {}),
          filesCount: Array.isArray(files) ? files.length : 0,
          files: Array.isArray(files)
            ? files.map((f: any) => ({
                fieldname: f?.fieldname,
                filename: f?.filename,
                mimetype: f?.mimetype,
                size: f?.data?.length,
              }))
            : [],
        });

        // Extraer CSV del archivo o del campo
        const file =
          files.find((f) => f.fieldname === 'file') ||
          files.find((f) => f.fieldname === 'csv') ||
          files[0];

        if (file?.data) {
          const rawBytes = Array.from(file.data.slice(0, 20) as Uint8Array);
          console.log('[uploadAgentContacts] raw file bytes (first 20):', rawBytes.map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '));
          csv = file.data.toString('utf8');
          // Strip BOM if present
          if (csv.charCodeAt(0) === 0xFEFF) {
            console.log('[uploadAgentContacts] Stripping BOM from CSV');
            csv = csv.slice(1);
          }
        } else if (fields.csv) {
          csv = String(fields.csv);
          if (csv.charCodeAt(0) === 0xFEFF) {
            csv = csv.slice(1);
          }
        }

        message = fields.message || '';
        metadata = fields.metadata || undefined;

        console.log('[uploadAgentContacts] multipart extracted', {
          csvLength: csv.length,
          csvLineCount: csv ? csv.trim().split('\n').length : 0,
          message: message ? message.slice(0, 80) : null,
          metadata: metadata || null,
          firstCharCode: csv ? csv.charCodeAt(0) : null,
          hasCarriageReturn: csv ? csv.includes('\r') : false,
        });
      } catch (error) {
        console.error('[uploadAgentContacts] ERROR: multipart parse failed', error);
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({
            success: false,
            message: 'Error parseando multipart/form-data'
          })
        };
      }
    } else {
      // Parsear como JSON
      let requestData;
      try {
        requestData = JSON.parse(event.body);
      } catch (error) {
        console.error('[uploadAgentContacts] ERROR: JSON parse failed', { error: (error as Error).message, bodyPreview: event.body?.slice(0, 200) });
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({
            success: false,
            message: 'Body debe ser JSON válido con campos: csv y message (metadata opcional)'
          })
        };
      }

      csv = requestData.csv || '';
      message = requestData.message || '';
      metadata = requestData.metadata || undefined;

      console.log('[uploadAgentContacts] JSON parsed', {
        hasCsv: Boolean(csv),
        csvLength: csv ? csv.length : 0,
        csvLineCount: csv ? csv.trim().split('\n').length : 0,
        message: message ? message.slice(0, 80) : null,
        metadata: metadata || null,
      });
    }

    if (!csv || !message) {
      console.log('[uploadAgentContacts] ERROR: missing fields', { hasCsv: Boolean(csv), hasMessage: Boolean(message) });
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          message: 'CSV y mensaje son requeridos. Enviar como JSON {csv, message} o como multipart/form-data con campos file/csv y message.'
        })
      };
    }

    // Procesar CSV y agregar columna de mensaje
    const lines = csv.trim().split('\n');
    console.log('[uploadAgentContacts] CSV lines:', { totalLines: lines.length, headerLine: lines[0]?.trim() || '' });
    if (lines.length < 1) {
      console.log('[uploadAgentContacts] ERROR: CSV vacío');
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          message: 'CSV vacío'
        })
      };
    }

    // Agregar columna "message" al header
    const header = lines[0].trim();
    const newHeader = header.includes('message') ? header : `${header},message`;
    
    const processedLines = [newHeader];
    let contactCount = 0;

    // Función para escapar campos CSV (envolver en comillas si contiene comas, comillas o saltos de línea)
    const escapeCSVField = (field: string): string => {
      if (!field) return '';
      
      // Si el campo contiene comas, comillas dobles o saltos de línea, debe ir entre comillas
      if (field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r')) {
        // Escapar comillas dobles duplicándolas
        const escaped = field.replace(/"/g, '""');
        return `"${escaped}"`;
      }
      
      return field;
    };

    // Agregar mensaje a cada fila
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Escapar el mensaje para que las comas no rompan el CSV
      const escapedMessage = escapeCSVField(message);
      
      // Si la línea ya tiene el mensaje, no agregarlo de nuevo
      const newLine = line.includes(message) ? line : `${line},${escapedMessage}`;
      processedLines.push(newLine);
      contactCount++;
    }

    const processedCsv = processedLines.join('\n') + '\n';

    // Guardar en S3: agents/{campaign}/{agent}-contacts-{ts}.csv (donde getChats lo consume)
    const ts = makeTimestampForKey();
    const key = `agents/${campaign}/${agent}-contacts-${ts}.csv`;
    const historic_key = `historic/agents/${campaign}/${agent}-contacts-${ts}.csv`;

    console.log('[uploadAgentContacts] CSV preview (first 5 rows):');
    processedLines.slice(0, 5).forEach((line, idx) => console.log(`  [${idx}] ${line}`));

    // Encodear metadata en Base64 para evitar problemas con chars no-ASCII y newlines en headers HTTP de S3
    const s3Metadata: Record<string, string> | undefined = metadata
      ? { metadata_b64: Buffer.from(String(metadata), 'utf8').toString('base64') }
      : undefined;
    if (metadata) {
      console.log('[uploadAgentContacts] metadata encoded as base64, original length:', String(metadata).length, 'b64 length:', s3Metadata!.metadata_b64.length);
    }

    console.log('[uploadAgentContacts] uploading to S3', {
      bucket: BUCKET_NAME,
      key,
      historic_key,
      csvLength: processedCsv.length,
      contactCount,
      headerLine: processedLines[0] || '',
      hasMetadata: Boolean(s3Metadata),
    });
    
    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: processedCsv,
      ContentType: 'text/csv',
      Metadata: s3Metadata,
    }));
    console.log('[uploadAgentContacts] S3 upload OK:', key);

    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: historic_key,
      Body: processedCsv,
      ContentType: 'text/csv',
      Metadata: s3Metadata,
    }));
    console.log('[uploadAgentContacts] S3 upload OK (historic):', historic_key);

    console.log(`[uploadAgentContacts] OK: ${key} con ${contactCount} contactos`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        message: 'CSV subido correctamente con mensaje agregado',
        data: {
          agent,
          campaign,
          key,
          historic_key,
          contactCount,
          messageAdded: message,
          metadata: metadata || null,
          timestamp: new Date().toISOString()
        }
      })
    };

  } catch (error) {
    console.error('[uploadAgentContacts] UNCAUGHT ERROR:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: false,
        message: 'Error interno del servidor',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};

/**
 * Obtiene el CSV de contactos de un agente
 */
export const getAgentContacts = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const { agent, campaign } = event.pathParameters || {};
    
    if (!agent || !campaign) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          message: 'Agente y campaña son requeridos'
        })
      };
    }

    const prefix = `agents/${campaign}/`;
    const listRes = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: prefix,
      })
    );

    const candidates = (listRes.Contents || [])
      .filter((o) => !!o.Key)
      .map((o) => ({
        key: String(o.Key),
        lastModified: o.LastModified ? new Date(o.LastModified).getTime() : 0,
      }))
      .filter((o) => {
        const filename = o.key.split('/').pop() || '';
        return filename.startsWith(`${agent}-contacts`) && filename.endsWith('.csv');
      })
      .sort((a, b) => b.lastModified - a.lastModified);

    const latest = candidates[0];
    if (!latest?.key) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          message: 'CSV no encontrado'
        })
      };
    }

    const response = await s3Client.send(new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: latest.key,
    }));

    const csvContent = await response.Body?.transformToString();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Access-Control-Allow-Origin': '*',
      },
      body: csvContent || ''
    };

  } catch (error: any) {
    if (error.name === 'NoSuchKey') {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          message: 'CSV no encontrado'
        })
      };
    }

    console.error('Error al obtener CSV:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: false,
        message: 'Error interno del servidor',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};
