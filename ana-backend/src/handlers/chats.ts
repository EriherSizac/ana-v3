import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({});
const BUCKET_NAME = process.env.BUCKET_NAME!;

export const getChats = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const pathParam = event.pathParameters?.['agentId-campaign-id'];

    if (!pathParam) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'agentId-campaign-id parameter is required' }),
      };
    }

    // Parse agentId-campaign-id (format: agentId-campaignId)
    const parts = pathParam.split('-');
    if (parts.length < 2) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid format. Expected: agentId-campaignId' }),
      };
    }

    const agentId = parts[0];
    const campaignId = parts.slice(1).join('-'); // In case campaignId contains dashes

    const key = `assignments/${campaignId}/${agentId}.csv`;

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
