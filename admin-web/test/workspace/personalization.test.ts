import { describe, expect, it } from 'vitest';
import { NO_CUSTOM_FIELD_WARNING, suggestedFields, templateHasCustomField } from '@/lib/workspace';

/** Aviso "plantilla sin campo personalizado" (lógica pura). */
const HEADER = ['phone_number', 'telefono_2', 'nombre_cliente', 'saldo_vencido_actual', 'first_name', 'segmento_credito', 'ana_upload_id', 'message'];

describe('templateHasCustomField', () => {
  it('sin variables → avisa', () => {
    expect(templateHasCustomField('Hola, tienes un saldo pendiente', HEADER)).toBe(false);
    expect(templateHasCustomField('', HEADER)).toBe(false);
  });
  it('solo variables desconocidas, constantes, teléfonos o id de carga → sigue avisando', () => {
    expect(templateHasCustomField('Hola {{apodo}} {desconocida_x}', HEADER)).toBe(false);
    expect(templateHasCustomField('Total {{2*3}}', HEADER)).toBe(false);
    expect(templateHasCustomField('Hola {{discount}}', HEADER)).toBe(false); // campo estándar sin columna
    expect(templateHasCustomField('Tu número {{phone_number}} {phone} {{telefono_2}}', HEADER)).toBe(false);
    expect(templateHasCustomField('Id {{ana_upload_id}}', HEADER)).toBe(false);
    expect(templateHasCustomField('Hola {{x}}', ['contacto', 'saldo'], ['contacto'])).toBe(false);
  });
  it('variable válida (doble, simple, campo mapeado o expresión) → no avisa', () => {
    expect(templateHasCustomField('Hola {{nombre_cliente}}', HEADER)).toBe(true);
    expect(templateHasCustomField('Hola {nombre_cliente}', HEADER)).toBe(true);
    expect(templateHasCustomField('Hola {{ first_name }}', HEADER)).toBe(true);
    expect(templateHasCustomField('Paga {{saldo_vencido_actual*0.8}}', HEADER)).toBe(true);
    expect(templateHasCustomField('Hola {{apodo}}, segmento {{segmento_credito}}', HEADER)).toBe(true);
  });
});

describe('suggestedFields', () => {
  it('prefiere nombre_cliente y saldo_vencido_actual; excluye teléfonos, ana_upload_id y message', () => {
    expect(suggestedFields(HEADER)).toEqual(['nombre_cliente', 'saldo_vencido_actual', 'first_name']);
    expect(suggestedFields(['phone', 'credito', 'contacto', 'monto'], ['contacto'])).toEqual(['credito', 'monto']);
    expect(suggestedFields(['phone_number'])).toEqual([]);
  });
  it('texto del aviso', () => {
    expect(NO_CUSTOM_FIELD_WARNING).toContain('Tu plantilla no tiene ningún campo personalizado');
  });
});
