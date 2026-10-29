import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseAssignmentCsv } from '../src/lib/assignmentCsv';
import { convertExcelValue, excelFractionToTime, excelSerialToDate, isDateColumnName } from '../src/lib/excelDates';
import { normalizeRows } from '../src/handlers/adminContacts';
import { buildPublication } from '../src/lib/publication';

// support-crm-base-upload: "Fechas de Excel".

describe('números de serie de Excel', () => {
  it('sistema 1900 con el 29/02/1900 ficticio', () => {
    expect(excelSerialToDate(1)).toBe('01/01/1900');
    expect(excelSerialToDate(59)).toBe('28/02/1900');
    expect(excelSerialToDate(60)).toBe('29/02/1900');
    expect(excelSerialToDate(61)).toBe('01/03/1900');
    expect(excelSerialToDate(45959)).toBe('29/10/2025');
    expect(excelSerialToDate(45961)).toBe('31/10/2025');
  });

  it('columnas de fecha: entero o decimal (la hora se ignora) dentro de 20000–80000', () => {
    expect(convertExcelValue('fecha_corte', '45961')).toBe('31/10/2025');
    expect(convertExcelValue('fecha_ultima_interaccion_wa', '45961.75')).toBe('31/10/2025');
    expect(convertExcelValue('payment_date', '45961')).toBe('31/10/2025');
    expect(convertExcelValue('fecha_corte', '19999')).toBe('19999');
    expect(convertExcelValue('fecha_corte', '31/10/2025')).toBe('31/10/2025');
    expect(convertExcelValue('fecha_corte', '2025-10-31')).toBe('2025-10-31');
    expect(convertExcelValue('fecha_corte', 'N/A')).toBe('N/A');
  });

  it('columnas hora_*: fracción de día → HH:MM:SS', () => {
    expect(excelFractionToTime(0.5)).toBe('12:00:00');
    expect(convertExcelValue('hora_contacto', '0.75')).toBe('18:00:00');
    expect(convertExcelValue('hora_contacto', '1.5')).toBe('1.5');
  });

  it('nunca toca columnas que no son de fecha', () => {
    expect(convertExcelValue('saldo_total', '45961')).toBe('45961');
    expect(convertExcelValue('pago_minimo.1', '45961.5')).toBe('45961.5');
    expect(isDateColumnName('update_status')).toBe(false);
    expect(isDateColumnName('fecha_mejor_interaccion_tel')).toBe(true);
  });
});

describe('aplicación en v3', () => {
  it('normalizeRows (carga en línea y por S3) convierte solo columnas de fecha', () => {
    const { csv } = normalizeRows('phone,fecha_corte,saldo\n5215500000001,45961,45961\n5215500000002,"31/10/2025",10\n');
    expect(csv).toBe('phone,fecha_corte,saldo\n5215500000001,31/10/2025,45961\n5215500000002,"31/10/2025",10\n');
  });

  it('archivos ya cargados: parseAssignmentCsv muestra la fecha y conserva raw; la publicación renderiza la fecha', () => {
    const p = parseAssignmentCsv('phone_number,fecha_corte,saldo\n5215500000001,45961,45961\n');
    expect(p.rows[0]!.values).toEqual(['5215500000001', '31/10/2025', '45961']);
    expect(p.rows[0]!.raw).toBe('5215500000001,45961,45961');
    const pub = buildPublication([p], [[0]], 'Corte {{fecha_corte}} saldo {{saldo}}', ['phone_number']);
    expect(pub.rows[0]).toContain('Corte 31/10/2025 saldo 45961');
    expect(pub.rows[0]).toContain('31/10/2025');
  });
});

describe('serverless.yml: carga grande', () => {
  const cfg = parse(readFileSync(join(__dirname, '..', 'serverless.yml'), 'utf8'));
  it('presign con cognitoAdminJwt, más memoria para la carga, CORS PUT y expiración de uploads-incoming/', () => {
    const fn = cfg.functions.adminPresignContacts;
    expect(fn.handler).toBe('src/handlers/adminContacts.presignContacts');
    expect(fn.events[0].httpApi).toMatchObject({ path: '/admin/campaigns/{campaign}/contacts/presign', method: 'post', authorizer: { name: 'cognitoAdminJwt' } });
    expect(cfg.functions.adminUploadContacts.memorySize).toBe(1024);
    const bucket = cfg.resources.Resources.StorageBucket.Properties;
    expect(bucket.CorsConfiguration.CorsRules).toEqual([
      { AllowedOrigins: ['https://ana-admin.pernexium.com.mx'], AllowedMethods: ['PUT'], AllowedHeaders: ['content-type'], MaxAge: 3600 },
    ]);
    expect(bucket.LifecycleConfiguration.Rules.find((r: { Prefix: string }) => r.Prefix === 'uploads-incoming/')).toMatchObject({ Prefix: 'uploads-incoming/', ExpirationInDays: 1, Status: 'Enabled' });
  });
});
