import { describe, it, expect } from 'vitest';
import { defaultTemplateFor, getUnknownTemplateVars } from './templateVars';

describe('defaultTemplateFor (add-supervisor-contact-access)', () => {
  it('{mensaje} sin columna mensaje → vacío (obligatorio)', () =>
    expect(defaultTemplateFor('{mensaje}', ['telefono', 'nombre', 'saldo'])).toBe(''));
  it('{mensaje} con columna mensaje se conserva', () =>
    expect(defaultTemplateFor('{mensaje}', ['telefono', 'mensaje'])).toBe('{mensaje}'));
  it('{mensaje} con columna message se conserva', () =>
    expect(defaultTemplateFor('{mensaje}', ['phone', 'Message'])).toBe('{mensaje}'));
  it('plantilla del líder se conserva', () =>
    expect(defaultTemplateFor('Hola {nombre}', ['telefono', 'nombre'])).toBe('Hola {nombre}'));
  it('sin plantilla → vacío', () => expect(defaultTemplateFor(undefined, ['telefono'])).toBe(''));
});

describe('getUnknownTemplateVars', () => {
  it('{apodo} es desconocida', () =>
    expect(getUnknownTemplateVars('Hola {nombre} {apodo}', ['nombre', 'telefono'])).toEqual(['apodo']));
  it('{saldo} es conocida con total_balance (alias)', () =>
    expect(getUnknownTemplateVars('Debes {saldo:dinero}', ['total_balance'])).toEqual([]));
  it('identificadores dentro de expresiones', () =>
    expect(getUnknownTemplateVars('{saldo*0.9 - extra}', ['saldo'])).toEqual(['extra']));
  it('sin columnas no se valida', () => expect(getUnknownTemplateVars('{x}', [])).toEqual([]));
});
