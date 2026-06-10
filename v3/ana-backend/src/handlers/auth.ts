import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

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
 * Obtiene las credenciales de una campaña desde S3
 */
async function getCampaignCredentials(campaign: string): Promise<Map<string, string>> {
  const key = `agents/${campaign}/credentials.csv`;
  const credentials = new Map<string, string>();
  
  try {
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    }));

    const csvContent = await response.Body?.transformToString();
    if (!csvContent) return credentials;

    // Parsear CSV
    const lines = csvContent.trim().split('\n');
    for (let i = 1; i < lines.length; i++) { // Skip header
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(',');
      if (parts.length >= 2) {
        const user = parts[0].trim().toLowerCase();
        const password = parts[1].trim();
        credentials.set(user, password);
      }
    }

    return credentials;
  } catch (error: any) {
    if (error.name === 'NoSuchKey') {
      console.log(`No credentials file found for campaign: ${campaign}`);
      return credentials;
    }
    throw error;
  }
}

/**
 * Verifica las credenciales del usuario consultando el CSV de la campaña
 */
export const verifyCredentials = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    // Parsear el body
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

    const { user, campaign, dailyPassword } = JSON.parse(event.body);

    // Validar que todos los campos estén presentes
    if (!user || !campaign || !dailyPassword) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          message: 'Usuario, campaña y palabra del día son requeridos'
        })
      };
    }

    // Obtener credenciales de la campaña desde S3
    const campaignCredentials = await getCampaignCredentials(campaign.toLowerCase());

    if (campaignCredentials.size === 0) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          message: 'Campaña no encontrada o sin credenciales configuradas'
        })
      };
    }

    // Verificar usuario y palabra del día
    const userLower = user.toLowerCase();
    const expectedPassword = campaignCredentials.get(userLower);

    if (!expectedPassword) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          message: 'Usuario no autorizado en esta campaña'
        })
      };
    }

    if (dailyPassword !== expectedPassword) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          message: 'Palabra del día incorrecta'
        })
      };
    }

    // Todo correcto
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        message: 'Credenciales verificadas correctamente',
        data: {
          user: userLower,
          campaign: campaign.toLowerCase(),
          timestamp: new Date().toISOString()
        }
      })
    };

  } catch (error) {
    console.error('Error al verificar credenciales:', error);
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

