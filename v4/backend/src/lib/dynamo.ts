// File: Sort key de un mensaje: ordena cronológico estable aún con mismo timestamp.
// Created: 2026-06-09
// Updated: 2026-06-09
// Author: Erick Hernández Silva

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const base = new DynamoDBClient({});

export const ddb = DynamoDBDocumentClient.from(base, {
  marshallOptions: { removeUndefinedValues: true },
});

export const CONVERSATIONS_TABLE = process.env.CONVERSATIONS_TABLE!;
export const MESSAGES_TABLE = process.env.MESSAGES_TABLE!;

/** Sort key de un mensaje: ordena cronológico estable aún con mismo timestamp. */
export const messageSk = (timestamp: number, msgId: string) => `${timestamp}#${msgId}`;

/** Partition key de mensajes: aísla por operador. */
export const convKey = (operatorId: string, chatId: string) => `${operatorId}#${chatId}`;
