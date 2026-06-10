import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

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

/**
 * Guarda mensajes de chat en un archivo único por contacto
 * Compara con mensajes existentes y solo agrega los nuevos
 */
export const saveChatBackup = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Request body is required' }),
      };
    }

    const body = JSON.parse(event.body);
    const { campaign, agent_id, contact_phone, messages } = body;

    if (!campaign || !agent_id || !contact_phone || !messages) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'campaign, agent_id, contact_phone and messages fields are required' 
        }),
      };
    }

    if (!Array.isArray(messages)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'messages must be an array' }),
      };
    }

    const key = `backups/${campaign}/${agent_id}/${contact_phone}/chat_backup.json`;

    let existingMessages: any[] = [];
    try {
      const getCommand = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      });
      const response = await s3Client.send(getCommand);
      const bodyString = await response.Body?.transformToString();
      
      if (bodyString) {
        const existingData = JSON.parse(bodyString);
        existingMessages = existingData.messages || [];
      }
    } catch (error: any) {
      if (error.name !== 'NoSuchKey') {
        throw error;
      }
    }

    const existingMessageIds = new Set(
      existingMessages.map((msg: any) => 
        JSON.stringify({
          id: msg.id,
          timestamp: msg.timestamp,
          from: msg.from,
          body: msg.body
        })
      )
    );

    const newMessages = messages.filter((msg: any) => {
      const msgId = JSON.stringify({
        id: msg.id,
        timestamp: msg.timestamp,
        from: msg.from,
        body: msg.body
      });
      return !existingMessageIds.has(msgId);
    });

    const allMessages = [...existingMessages, ...newMessages];

    allMessages.sort((a: any, b: any) => {
      const timeA = a.timestamp || 0;
      const timeB = b.timestamp || 0;
      return timeA - timeB;
    });

    const backupData = {
      campaign,
      agent_id,
      contact_phone,
      last_updated: new Date().toISOString(),
      total_messages: allMessages.length,
      messages: allMessages
    };

    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: JSON.stringify(backupData, null, 2),
      ContentType: 'application/json',
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Chat backup saved successfully',
        path: key,
        stats: {
          existing_messages: existingMessages.length,
          new_messages: newMessages.length,
          total_messages: allMessages.length,
          skipped_duplicates: messages.length - newMessages.length
        }
      }),
    };
  } catch (error) {
    console.error('Error saving chat backup:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
};

/**
 * Lista todos los chats respaldados de un agente con metadata (número, fecha, total mensajes)
 * GET /backups/chats/{campaign}/{agentId}
 */
export const listChatBackups = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const { campaign, agentId } = event.pathParameters || {};

    if (!campaign || !agentId) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'campaign and agentId are required' }),
      };
    }

    const prefix = `backups/${campaign}/${agentId}/`;

    // List all objects under the agent's backup folder
    const listCommand = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: prefix,
    });

    const listResponse = await s3Client.send(listCommand);
    const contents = listResponse.Contents || [];

    // Filter only chat_backup.json files and extract phone numbers
    const chatFiles = contents.filter((obj) =>
      obj.Key?.endsWith('/chat_backup.json')
    );

    // Fetch metadata from each backup file in parallel
    const chats = await Promise.all(
      chatFiles.map(async (obj) => {
        const phone = obj.Key!.split('/')[3]; // backups/{campaign}/{agent}/{phone}/chat_backup.json
        try {
          const getCommand = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: obj.Key!,
          });
          const response = await s3Client.send(getCommand);
          const bodyString = await response.Body?.transformToString();
          if (bodyString) {
            const data = JSON.parse(bodyString);
            return {
              contact_phone: phone,
              total_messages: data.total_messages || (data.messages ? data.messages.length : 0),
              last_updated: data.last_updated || null,
              last_message_preview: data.messages && data.messages.length > 0
                ? (data.messages[data.messages.length - 1].body || '').substring(0, 80)
                : null,
            };
          }
        } catch (e) {
          // If we can't read a file, still return basic info
        }
        return {
          contact_phone: phone,
          total_messages: 0,
          last_updated: obj.LastModified?.toISOString() || null,
          last_message_preview: null,
        };
      })
    );

    // Sort by last_updated descending (most recent first)
    chats.sort((a, b) => {
      const dateA = a.last_updated ? new Date(a.last_updated).getTime() : 0;
      const dateB = b.last_updated ? new Date(b.last_updated).getTime() : 0;
      return dateB - dateA;
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        campaign,
        agent_id: agentId,
        total_chats: chats.length,
        chats,
      }),
    };
  } catch (error) {
    console.error('Error listing chat backups:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

/**
 * Obtiene el backup de chat de un contacto específico
 */
export const getChatBackup = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const { campaign, agentId, contactPhone } = event.pathParameters || {};

    if (!campaign || !agentId || !contactPhone) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'campaign, agentId and contactPhone are required' 
        }),
      };
    }

    const key = `backups/${campaign}/${agentId}/${contactPhone}/chat_backup.json`;
    console.log('Key:', key);

    try {
      const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      });

      const response = await s3Client.send(command);
      const bodyString = await response.Body?.transformToString();

      if (bodyString) {
        const data = JSON.parse(bodyString);
        console.log('Data:', data);
        
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            success: true,
            data,
          }),
        };
      }
    } catch (error: any) {
      if (error.name === 'NoSuchKey') {
        console.log('No backup found for this contact');
        return {
          statusCode: 404,
          body: JSON.stringify({
            success: false,
            message: 'No backup found for this contact',
            data: null
          }),
        };
      }
      console.log('Error getting chat backup:', error);
      throw error;
    }
    console.log('No backup found for this contact 2');
    return {
      statusCode: 404,
      body: JSON.stringify({
        success: false,
        message: 'No backup found',
      }),
    };
  } catch (error) {
    console.error('Error getting chat backup:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Error al obtener backup',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
