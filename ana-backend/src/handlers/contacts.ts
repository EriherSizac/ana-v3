import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({});
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
 * Actualiza el archivo CSV de contactos pendientes
 * Reemplaza el archivo existente con los contactos restantes
 */
export const updatePendingContacts = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { campaign, agent_id, contacts } = body;

    if (!campaign || !agent_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'campaign y agent_id son requeridos' }),
      };
    }

    if (!Array.isArray(contacts)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'contacts debe ser un array' }),
      };
    }

    // Generar CSV desde los contactos
    const csvLines: string[] = [];
    
    // Header
    if (contacts.length > 0) {
      const headers = Object.keys(contacts[0]);
      csvLines.push(headers.join(','));
      
      // Rows
      contacts.forEach(contact => {
        const values = headers.map(header => {
          const value = contact[header] || '';
          // Escapar valores que contengan comas
          return value.toString().includes(',') ? `"${value}"` : value;
        });
        csvLines.push(values.join(','));
      });
    } else {
      // Si no hay contactos, crear CSV vacío con headers básicos
      csvLines.push('contact_phone,contact_name');
    }

    const csvContent = csvLines.join('\n');
    const key = `chats/${agent_id}-${campaign}.csv`;

    // Subir a S3
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: csvContent,
      ContentType: 'text/csv',
    });

    await s3Client.send(command);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Contactos pendientes actualizados',
        path: key,
        remainingContacts: contacts.length,
      }),
    };
  } catch (error) {
    console.error('Error updating pending contacts:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Error al actualizar contactos pendientes',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
