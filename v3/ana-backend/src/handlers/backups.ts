import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({});
const BUCKET_NAME = process.env.BUCKET_NAME!;

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

export const uploadBackup = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Request body is required' }),
      };
    }

    const body = JSON.parse(event.body);
    const { campaign, data, agent_id } = body;

    if (!campaign || !data || !agent_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'campaign, agent_id and data fields are required' }),
      };
    }

    const now = new Date();
    const month = now.toISOString().slice(0, 7); // YYYY-MM
    const day = now.getDate().toString().padStart(2, '0');

    const key = `backups/${campaign}/${month}/${agent_id}_${day}.json`;

    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: JSON.stringify(data),
      ContentType: 'application/json',
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Backup uploaded successfully',
        path: key,
      }),
    };
  } catch (error) {
    console.error('Error uploading backup:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};

/**
 * Obtiene el backup más reciente de un agente/campaña
 * Busca desde hoy hasta 4 días atrás
 */
export const getLatestBackup = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const { agentId, campaign } = event.pathParameters || {};

    if (!agentId || !campaign) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'agentId y campaign son requeridos' }),
      };
    }

    const now = new Date();
    const MAX_DAYS_BACK = 4;

    // Intentar obtener backup desde hoy hasta 4 días atrás
    for (let daysBack = 0; daysBack < MAX_DAYS_BACK; daysBack++) {
      const date = new Date(now);
      date.setDate(date.getDate() - daysBack);
      
      const month = date.toISOString().slice(0, 7); // YYYY-MM
      const day = date.getDate().toString().padStart(2, '0');
      const key = `backups/${campaign}/${month}/${agentId}_${day}.json`;

      try {
        const command = new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: key,
        });

        const response = await s3Client.send(command);
        const bodyString = await response.Body?.transformToString();

        if (bodyString) {
          const data = JSON.parse(bodyString);
          
          return {
            statusCode: 200,
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              success: true,
              date: date.toISOString().split('T')[0],
              daysBack,
              data,
            }),
          };
        }
      } catch (error: any) {
        // Si no existe el archivo, continuar con el siguiente día
        if (error.name === 'NoSuchKey') {
          continue;
        }
        throw error;
      }
    }

    // No se encontró ningún backup en los últimos 4 días
    return {
      statusCode: 404,
      body: JSON.stringify({
        success: false,
        message: `No se encontró backup para ${agentId}/${campaign} en los últimos ${MAX_DAYS_BACK} días`,
      }),
    };
  } catch (error) {
    console.error('Error getting latest backup:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Error al obtener backup',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
