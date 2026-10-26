import { describe, it, expect } from 'vitest';
import { interpolate, formatMoney, parseLocaleNumber } from './template';

// toLocaleString es-MX puede usar espacio duro; normalizamos para comparar.
const money = (s: string) => s.replace(/ /g, ' ');

describe('parseLocaleNumber', () => {
  it.each([
    ['1234,56', 1234.56],
    ['1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['12,345', 12345],
    ['1234.5', 1234.5],
    ['$1,234.00', 1234],
    ['-50', -50],
  ])('"%s" → %s', (raw, n) => expect(parseLocaleNumber(raw)).toBe(n));
  it('sin dígitos → null', () => {
    expect(parseLocaleNumber('abc')).toBeNull();
    expect(parseLocaleNumber('')).toBeNull();
  });
});

describe('formatMoney', () => {
  it.each([
    ['1234,56', '$1,234.56'],
    ['1.234,56', '$1,234.56'],
    ['1,234.56', '$1,234.56'],
    ['12,345', '$12,345.00'],
    ['1234.5', '$1,234.50'],
  ])('"%s" → %s', (raw, out) => expect(money(formatMoney(raw))).toBe(out));
  it('"abc" se devuelve tal cual', () => expect(formatMoney('abc')).toBe('abc'));
});

describe('interpolate (sin regresión)', () => {
  const row = { nombre: 'Ana', saldo: '1234,56', descuento: '100', total_balance: '1000' };
  it('saldo automático con coma decimal', () =>
    expect(money(interpolate('{saldo}', row))).toBe('$1,234.56'));
  it(':num desactiva el formato', () => expect(interpolate('{saldo:num}', { saldo: '1234.5' })).toBe('1234.5'));
  it('expresión con :dinero', () =>
    expect(money(interpolate('{total_balance*0.9:dinero}', row))).toBe('$900.00'));
  it('expresión con coma decimal (saldo → moneda automática)', () =>
    expect(money(interpolate('{saldo - descuento}', row))).toBe('$1,134.56'));
  it('expresión con coma decimal y :num', () =>
    expect(interpolate('{saldo - descuento:num}', row)).toBe('1134.56'));
  it('{{var}} estilo v3 y campo ausente', () =>
    expect(interpolate('Hola {{nombre}}{apodo}', row)).toBe('Hola Ana'));
  it('expresión sobre columna no numérica deja el placeholder', () =>
    expect(interpolate('{nombre*2}', row)).toBe('{nombre*2}'));
});
