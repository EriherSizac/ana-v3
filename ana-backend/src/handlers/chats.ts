import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

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

export const getChats = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const agentId = event.pathParameters?.agentId;
    const campaignId = event.pathParameters?.campaignId;

    if (!agentId || !campaignId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'agentId and campaignId parameters are required' }),
      };
    }

    const key = `agents/${campaignId}/${agentId}-contacts.csv`;
    console.log('[getChats] BUCKET=', BUCKET_NAME, 'KEY=', key);

    const response = await s3Client.send(new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    }));

    const bodyContents = await response.Body?.transformToString();

    if (!bodyContents) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'File not found or empty' }),
      };
    }

    // Consumir el archivo: una vez leído, se elimina de S3
    try {
      const delRes = await s3Client.send(new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      }));
      console.log('[getChats] DeleteObject OK:', JSON.stringify(delRes));

      // Verificar si realmente desapareció (si no hay permisos o hay versioning raro, esto nos lo indica)
      try {
        await s3Client.send(new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
        console.warn('[getChats] WARNING: HeadObject todavía existe después de DeleteObject. Revisar IAM/Versioning/Key.');
      } catch (headErr: any) {
        console.log('[getChats] HeadObject after delete:', headErr?.name || headErr?.Code || headErr?.$metadata?.httpStatusCode);
      }
    } catch (deleteError: any) {
      console.error('Error deleting chats file from S3:', deleteError);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to delete chat assignment after reading' }),
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: bodyContents,
    };
  } catch (error: any) {
    console.error('Error getting chats:', error);

    if (error.name === 'NoSuchKey') {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Chat assignment not found' }),
      };
    }

    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
