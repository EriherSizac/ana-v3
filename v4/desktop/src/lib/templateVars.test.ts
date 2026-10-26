import { describe, it, expect } from 'vitest';
import { getUnknownTemplateVars } from './templateVars';

describe('getUnknownTemplateVars', () => {
  it('{apodo} es desconocida', () =>
    expect(getUnknownTemplateVars('Hola {nombre} {apodo}', ['nombre', 'telefono'])).toEqual(['apodo']));
  it('{saldo} es conocida con total_balance (alias)', () =>
    expect(getUnknownTemplateVars('Debes {saldo:dinero}', ['total_balance'])).toEqual([]));
  it('identificadores dentro de expresiones', () =>
    expect(getUnknownTemplateVars('{saldo*0.9 - extra}', ['saldo'])).toEqual(['extra']));
  it('sin columnas no se valida', () => expect(getUnknownTemplateVars('{x}', [])).toEqual([]));
});
