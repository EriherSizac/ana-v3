import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({ region: 'us-east-1' });
const BUCKET_NAME = process.env.BUCKET_NAME || '';

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
 * Sube un CSV de contactos para un agente y campaña específicos
 * Recibe el CSV y un mensaje que se agregará a cada contacto
 */
export const uploadAgentContacts = async (
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

    if (!event.body) {
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

    // Parsear el body como JSON
    let requestData;
    try {
      requestData = JSON.parse(event.body);
    } catch (error) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          message: 'Body debe ser JSON válido con campos: csv y message'
        })
      };
    }

    const { csv, message } = requestData;

    if (!csv || !message) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          message: 'CSV y mensaje son requeridos'
        })
      };
    }

    // Procesar CSV y agregar columna de mensaje
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

    // Guardar en S3: /agents/{campaign}/{agent}-contacts.csv
    const key = `agents/${campaign}/${agent}-contacts.csv`;
    
    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: processedCsv,
      ContentType: 'text/csv',
    }));

    console.log(`CSV subido: ${key} con ${contactCount} contactos`);

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
          timestamp: new Date().toISOString()
        }
      })
    };

  } catch (error) {
    console.error('Error al subir CSV:', error);
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

    const key = `agents/${campaign}/${agent}-contacts.csv`;
    
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
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
