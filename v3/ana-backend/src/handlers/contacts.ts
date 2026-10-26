import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { normalizeCampaign, normalizeAgent } from '../lib/campaign';
import { requireAgent } from '../lib/agentAuth';

const s3Client = new S3Client({});
const BUCKET_NAME = process.env.BUCKET_NAME || '';

const ASSIGNMENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

type ReviewInput = { assignment_id: string; contacts: Record<string, unknown>[] };

/**
 * Valida el campo opcional `review` ({assignment_id, contacts}).
 * Devuelve null si no viene, 'invalid' si no cumple el contrato.
 */
const parseReview = (review: unknown): ReviewInput | null | 'invalid' => {
  if (review === undefined || review === null) return null;
  if (typeof review !== 'object' || Array.isArray(review)) return 'invalid';
  const { assignment_id, contacts } = review as Record<string, unknown>;
  if (typeof assignment_id !== 'string' || !ASSIGNMENT_ID_RE.test(assignment_id)) return 'invalid';
  if (!Array.isArray(contacts)) return 'invalid';
  return { assignment_id, contacts: contacts as Record<string, unknown>[] };
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
    const { campaign, agent_id, contacts, review: rawReview } = body;

    const campaignKey = normalizeCampaign(campaign);
    const agentKey = normalizeAgent(agent_id);
    if (!campaignKey || !agentKey) {
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

    // Campo opcional `review`: se valida antes de escribir nada en S3
    const review = parseReview(rawReview);
    if (review === 'invalid') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'review inválido' }),
      };
    }

    // Autenticación de agente antes de escribir en S3 (v3/agent-auth)
    const denied = await requireAgent(event, { route: 'POST /contacts/pending', agent: agentKey, campaign: campaignKey });
    if (denied) return denied;

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
    const key = `chats/${agentKey}-${campaignKey}.csv`;

    // Subir a S3
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: csvContent,
      ContentType: 'text/csv',
    });

    await s3Client.send(command);

    // Contactos por revisar de la asignación: review/{campaign}/{agent_id}/{assignment_id}.csv
    if (review && review.contacts.length > 0) {
      const reviewHeaders = Object.keys(review.contacts[0] || {});
      const reviewLines = [reviewHeaders.join(',')];
      review.contacts.forEach((contact) => {
        const values = reviewHeaders.map((header) => {
          const value = (contact as Record<string, unknown>)?.[header] || '';
          // Mismo formato que chats/
          return value.toString().includes(',') ? `"${value}"` : value;
        });
        reviewLines.push(values.join(','));
      });
      await s3Client.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: `review/${campaignKey}/${agentKey}/${review.assignment_id}.csv`,
          Body: reviewLines.join('\n'),
          ContentType: 'text/csv',
        })
      );
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Contactos pendientes actualizados',
        path: key,
        remainingContacts: contacts.length,
        ...(review ? { reviewContacts: review.contacts.length } : {}),
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
