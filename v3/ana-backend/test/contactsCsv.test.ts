import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { uploadAgentContacts } from '../src/handlers/supervisors';
import { addMessageColumn, messageToSingleLine, stripBom, headerColumns } from '../src/lib/contactsCsv';
import { installMemS3 } from './helpers/memS3';

/**
 * Referencia literal del procesamiento ANTERIOR de `uploadAgentContacts`
 * (copiado antes de extraerlo a src/lib/contactsCsv.ts) para fijar que la
 * ruta de supervisor produce la misma salida que antes.
 */
function legacyProcess(csv: string, message: string): string {
  const lines = csv.trim().split('\n');
  const header = lines[0].trim();
  const newHeader = header.includes('message') ? header : `${header},message`;
  const processedLines = [newHeader];
  const escapeCSVField = (field: string): string => {
    if (!field) return '';
    if (field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r')) {
      const escaped = field.replace(/"/g, '""');
      return `"${escaped}"`;
    }
    return field;
  };
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const escapedMessage = escapeCSVField(message);
    const newLine = line.includes(message) ? line : `${line},${escapedMessage}`;
    processedLines.push(newLine);
  }
  return processedLines.join('\n') + '\n';
}

const CASES: Array<[string, string, string]> = [
  ['simple', 'contact_phone,contact_name\n5215500000001,Ana\n5215500000002,Beto', 'Hola {contact_name}'],
  ['mensaje con coma y comillas', 'phone,name\n5215500000001,Ana', 'Hola, "amigo" {name}'],
  ['mensaje multilínea', 'phone,name\n5215500000001,Ana', 'Hola\nSaldo: {total_balance}'],
  ['ya trae message', 'phone,message\n5215500000001,Hola ya', 'Otro'],
  ['líneas vacías y CRLF', 'phone,name\r\n5215500000001,Ana\r\n\r\n5215500000002,Beto\r\n', 'Hola'],
  ['fila que contiene el mensaje', 'phone,nota\n5215500000001,Hola', 'Hola'],
];

const s3 = mockClient(S3Client);
const ev = (body: string) =>
  ({
    headers: { 'X-Admin-Key': 'k', 'content-type': 'application/json' },
    pathParameters: { agent: 'erick', campaign: 'prueba' },
    body,
    isBase64Encoded: false,
  }) as unknown as APIGatewayProxyEvent;

describe('contactsCsv.addMessageColumn', () => {
  beforeEach(() => {
    s3.reset();
    installMemS3(s3);
    process.env.ADMIN_API_KEY = 'k';
    process.env.BUCKET_NAME = 'b';
  });

  it.each(CASES)('igual a la referencia anterior: %s', (_n, csv, msg) => {
    expect(addMessageColumn(csv, msg).csv).toBe(legacyProcess(csv, msg));
  });

  it.each(CASES)('la ruta de supervisor produce la misma salida que antes: %s', async (_n, csv, msg) => {
    const res = await uploadAgentContacts(ev(JSON.stringify({ csv, message: msg, direct: true })));
    expect(res.statusCode).toBe(200);
    const put = s3.commandCalls(PutObjectCommand).find((c) => String(c.args[0].input.Key).startsWith('agents/'))!;
    expect(put.args[0].input.Body).toBe(legacyProcess(csv, msg));
  });

  it('messageToSingleLine convierte CR/LF a \\n literal', () => {
    expect(messageToSingleLine('Hola {first_name}\r\nSaldo: {total_balance}\nAdiós\rFin')).toBe(
      'Hola {first_name}\\nSaldo: {total_balance}\\nAdiós\\nFin',
    );
  });

  it('stripBom y headerColumns', () => {
    expect(stripBom('﻿phone,name')).toBe('phone,name');
    expect(headerColumns('﻿"phone" , name\r\n1,2')).toEqual(['phone', 'name']);
  });
});
