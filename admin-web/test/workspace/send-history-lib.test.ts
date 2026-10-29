import { describe, expect, it } from 'vitest';
import {
  addDays,
  buildQuery,
  csvFileName,
  defaultFilters,
  formatMx,
  mxToday,
  nextSort,
  progressPct,
  rangeError,
  toCsv,
  type ResultRow,
} from '@/lib/send-history';

/** add-agent-send-history: helpers de la vista. */
const row = (over: Partial<ResultRow> = {}): ResultRow => ({
  id: 'A1#0#1',
  agent: 'ana',
  assignmentId: 'A1',
  publicationId: 'P1',
  uploadId: null,
  rowIndex: 0,
  credit: 'CR-1',
  phone: '**0001',
  status: 'sent',
  errorCode: null,
  error: null,
  sentAt: '2026-10-29T17:00:00.000Z',
  messagePreview: 'Hola, "Ana"',
  ...over,
});

describe('fechas MX', () => {
  it('hoy en Ciudad de México (UTC-6) y rango por defecto de 7 días', () => {
    const now = new Date('2026-10-30T03:00:00Z'); // 29/10 21:00 MX
    expect(mxToday(now)).toBe('2026-10-29');
    expect(defaultFilters(now)).toMatchObject({ from: '2026-10-23', to: '2026-10-29', sort: 'sentAt', order: 'desc' });
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(formatMx('2026-10-29T17:00:00.000Z')).toMatch(/29\/10\/(20)?26/);
    expect(formatMx(null)).toBe('—');
  });

  it('errores de rango', () => {
    expect(rangeError('2026-10-01', '2026-10-31')).toBeNull();
    expect(rangeError('2026-09-01', '2026-10-29')).toBe('El rango admite como máximo 31 días');
    expect(rangeError('2026-10-29', '2026-10-01')).toBe('La fecha inicial debe ser anterior a la final');
    expect(rangeError('', '2026-10-01')).toBe('Elige un rango de fechas válido');
  });
});

describe('query y orden', () => {
  it('omite vacíos y agrega cursor/limit', () => {
    const f = { ...defaultFilters(new Date('2026-10-29T18:00:00Z')), statuses: ['sent' as const, 'error' as const], q: ' CR ', agent: 'luis' };
    const p = new URLSearchParams(buildQuery(f, { cursor: '200', limit: 500 }));
    expect(Object.fromEntries(p)).toEqual({ from: '2026-10-23', to: '2026-10-29', status: 'sent,error', q: 'CR', agent: 'luis', sort: 'sentAt', order: 'desc', cursor: '200', limit: '500' });
    expect(new URLSearchParams(buildQuery(defaultFilters())).has('status')).toBe(false);
  });
  it('nextSort alterna en la misma columna', () => {
    expect(nextSort({ sort: 'sentAt', order: 'desc' }, 'sentAt')).toEqual({ sort: 'sentAt', order: 'asc' });
    expect(nextSort({ sort: 'sentAt', order: 'desc' }, 'credit')).toEqual({ sort: 'credit', order: 'asc' });
  });
  it('progreso', () => {
    expect(progressPct({ published: 10, reported: 7 })).toBe(70);
    expect(progressPct({ published: 0, reported: 0 })).toBeNull();
    expect(progressPct({ published: 2, reported: 5 })).toBe(100);
  });
});

describe('CSV', () => {
  it('BOM, escape de comillas, protección de fórmulas y teléfono enmascarado', () => {
    const csv = toCsv([row(), row({ id: 'A1#1#1', rowIndex: 1, status: 'error', credit: '=1+1', error: 'Fallo, reintentar' })]);
    expect(csv.startsWith('﻿fecha_envio_mx,agente,estado,credito,telefono')).toBe(true);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(',Enviado,CR-1,**0001,P1,,1,,"Hola, ""Ana"""');
    expect(lines[2]).toContain(",Error,'=1+1,**0001,P1,,2,\"Fallo, reintentar\"");
    expect(csv).not.toMatch(/52\d{10}/);
  });
  it('nombre del archivo', () => {
    expect(csvFileName('didi vip', { from: '2026-10-23', to: '2026-10-29', agent: 'luis' })).toBe('historial-envios-didi_vip-luis-2026-10-23_2026-10-29.csv');
  });
});

describe('navegación', () => {
  it('"Historial de envíos" de campaña solo con permisos de Contactos; la del agente cuelga de Mi asignación', async () => {
    const { allowedSections, sectionForPath } = await import('@/lib/sections');
    const base = { username: 'x', campaigns: ['prueba'], roleNames: [], isAdmin: false, isLeader: false, isDeveloper: false };
    const leader = { ...base, permissions: ['ana:contacts:list:upload', 'ana:contacts:list:distribute'] };
    const agent = { ...base, permissions: ['ana:campaign:message:send'] };
    expect(allowedSections(leader).map((s) => s.href)).toContain('/historial-envios');
    expect(allowedSections(agent).map((s) => s.href)).not.toContain('/historial-envios');
    expect(sectionForPath('/mi-asignacion/historial')?.href).toBe('/mi-asignacion');
  });
});
