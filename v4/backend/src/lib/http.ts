// File: username del claim de Cognito (sub o cognito:username). null si no autenticado.
// Created: 2026-06-09
// Updated: 2026-06-09
// Author: Erick Hernández Silva

import type { APIGatewayProxyResultV2 } from 'aws-lambda';

const headers = { 'content-type': 'application/json' };

export const ok = (body: unknown): APIGatewayProxyResultV2 => ({
  statusCode: 200,
  headers,
  body: JSON.stringify(body),
});

export const created = (body: unknown): APIGatewayProxyResultV2 => ({
  statusCode: 201,
  headers,
  body: JSON.stringify(body),
});

export const bad = (msg: string, code = 400): APIGatewayProxyResultV2 => ({
  statusCode: code,
  headers,
  body: JSON.stringify({ error: msg }),
});

/** username del claim de Cognito (sub o cognito:username). null si no autenticado. */
export const claimUser = (event: any): string | null =>
  event?.requestContext?.authorizer?.jwt?.claims?.['cognito:username'] ??
  event?.requestContext?.authorizer?.jwt?.claims?.sub ??
  null;
