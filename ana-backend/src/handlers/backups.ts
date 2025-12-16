import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({});
const BUCKET_NAME = process.env.BUCKET_NAME!;

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
