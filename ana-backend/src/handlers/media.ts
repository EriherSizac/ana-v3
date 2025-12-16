import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({});
const BUCKET_NAME = process.env.BUCKET_NAME!;

export const uploadMedia = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    if (!event.body) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Request body is required' }),
      };
    }

    const body = JSON.parse(event.body);
    const { campaign, agent_id, filename, content_type, data } = body;

    if (!campaign || !agent_id || !filename || !data) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'campaign, agent_id, filename and data fields are required' }),
      };
    }

    // data viene en base64
    const buffer = Buffer.from(data, 'base64');

    const key = `media/${campaign}/${agent_id}/${filename}`;

    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: content_type || 'application/octet-stream',
    }));

    // Construir URL pública (asumiendo bucket público o presigned URL)
    const url = `https://${BUCKET_NAME}.s3.amazonaws.com/${key}`;

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        message: 'Media uploaded successfully',
        url: url,
        path: key,
      }),
    };
  } catch (error) {
    console.error('Error uploading media:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
