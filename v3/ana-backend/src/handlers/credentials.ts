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
 * Frases aleatorias para palabras del día
 */
const DAILY_PHRASES = [
  'sol-brillante-2024',
  'luna-plateada-noche',
  'estrella-fugaz-cielo',
  'viento-suave-primavera',
  'oceano-azul-profundo',
  'montana-nevada-alta',
  'rio-cristalino-fluye',
  'bosque-verde-espeso',
  'desierto-dorado-calido',
  'nube-blanca-flotante',
  'trueno-fuerte-lejano',
  'rayo-brillante-rapido',
  'arcoiris-colorido-hermoso',
  'cascada-agua-fresca',
  'valle-tranquilo-verde',
  'colina-suave-ondulante',
  'pradera-extensa-amplia',
  'laguna-serena-calma',
  'manantial-puro-cristal',
  'cumbre-alta-majestuosa',
  'sendero-largo-sinuoso',
  'puente-firme-seguro',
  'torre-alta-imponente',
  'castillo-antiguo-noble',
  'fortaleza-solida-fuerte',
  'jardin-florido-bello',
  'huerto-fructifero-verde',
  'campo-dorado-trigo',
  'viñedo-maduro-dulce',
  'olivar-antiguo-noble'
];

/**
 * Genera una frase aleatoria para palabra del día
 */
function generateRandomPhrase(): string {
  return DAILY_PHRASES[Math.floor(Math.random() * DAILY_PHRASES.length)];
}

/**
 * Obtiene el CSV de credenciales de una campaña
 */
export const getCampaignCredentials = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const { campaign } = event.pathParameters || {};
    
    if (!campaign) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          message: 'Campaña requerida'
        })
      };
    }

    const key = `agents/${campaign}/credentials.csv`;
    
    try {
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
        // Si no existe, crear uno por defecto
        const defaultCsv = 'user,dailyPassword\nadmin,acceso2024\n';
        
        await s3Client.send(new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: key,
          Body: defaultCsv,
          ContentType: 'text/csv',
        }));

        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'text/csv',
            'Access-Control-Allow-Origin': '*',
          },
          body: defaultCsv
        };
      }
      throw error;
    }

  } catch (error) {
    console.error('Error al obtener credenciales:', error);
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
 * Actualiza las palabras del día de todos los usuarios de una campaña
 */
export const regenerateDailyPasswords = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    // Parsear el body para obtener campaign
    let requestData;
    try {
      requestData = JSON.parse(event.body || '{}');
    } catch (error) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          message: 'Body debe ser JSON válido con campo: campaign'
        })
      };
    }

    const { campaign } = requestData;
    
    if (!campaign) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          message: 'Campaña requerida'
        })
      };
    }

    const key = `agents/${campaign}/credentials.csv`;
    
    // Obtener CSV actual
    let csvContent: string;
    try {
      const response = await s3Client.send(new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      }));
      csvContent = await response.Body?.transformToString() || '';
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
            message: 'CSV de credenciales no encontrado'
          })
        };
      }
      throw error;
    }

    // Parsear CSV
    const lines = csvContent.trim().split('\n');
    if (lines.length < 2) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          message: 'CSV vacío o inválido'
        })
      };
    }

    const header = lines[0];
    const updatedLines = [header];
    const updates: { user: string; oldPassword: string; newPassword: string }[] = [];

    // Actualizar cada usuario con una nueva palabra
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(',');
      if (parts.length < 2) continue;

      const user = parts[0].trim();
      const oldPassword = parts[1].trim();
      const newPassword = generateRandomPhrase();

      updatedLines.push(`${user},${newPassword}`);
      updates.push({ user, oldPassword, newPassword });
    }

    // Guardar CSV actualizado
    const newCsvContent = updatedLines.join('\n') + '\n';
    
    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: newCsvContent,
      ContentType: 'text/csv',
    }));

    console.log(`Passwords regeneradas para campaña: ${campaign}`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        message: 'Palabras del día regeneradas correctamente',
        data: {
          campaign,
          updatesCount: updates.length,
          updates,
          timestamp: new Date().toISOString()
        }
      })
    };

  } catch (error) {
    console.error('Error al regenerar passwords:', error);
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
 * Sube un CSV de credenciales para una campaña
 */
export const uploadCampaignCredentials = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    // Parsear el body para obtener campaign y csv
    let requestData;
    try {
      requestData = JSON.parse(event.body || '{}');
    } catch (error) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          message: 'Body debe ser JSON válido con campos: campaign y csv'
        })
      };
    }

    const { campaign, csv } = requestData;
    
    if (!campaign || !csv) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          message: 'Campaña y CSV son requeridos'
        })
      };
    }

    // Validar formato CSV (debe tener header user,dailyPassword)
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

    const header = lines[0].toLowerCase();
    if (!header.includes('user') || !header.includes('dailypassword')) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          message: 'CSV debe tener columnas: user,dailyPassword'
        })
      };
    }

    const key = `agents/${campaign}/credentials.csv`;
    
    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: csv,
      ContentType: 'text/csv',
    }));

    console.log(`Credenciales subidas para campaña: ${campaign}`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        message: 'Credenciales subidas correctamente',
        data: {
          campaign,
          key,
          usersCount: lines.length - 1,
          timestamp: new Date().toISOString()
        }
      })
    };

  } catch (error) {
    console.error('Error al subir credenciales:', error);
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
