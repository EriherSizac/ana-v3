import { describe, it, expect } from 'vitest';
import {
  normalizeKeySegment,
  normalizeCampaign,
  normalizeAgent,
  credentialsKey,
} from '../src/lib/campaign';

describe('normalizeKeySegment', () => {
  it('quita espacios laterales y convierte a minúsculas', () => {
    expect(normalizeKeySegment(' Prueba ')).toBe('prueba');
    expect(normalizeKeySegment('ERICK')).toBe('erick');
  });

  it('devuelve vacío si solo hay espacios o no es string', () => {
    expect(normalizeKeySegment('   ')).toBe('');
    expect(normalizeKeySegment(undefined)).toBe('');
    expect(normalizeKeySegment(42)).toBe('');
    expect(normalizeKeySegment(null)).toBe('');
  });

  it('conserva acentos y ñ', () => {
    expect(normalizeKeySegment('viñedo')).toBe('viñedo');
    expect(normalizeKeySegment('VIÑEDO')).toBe('viñedo');
  });

  it('los alias usan la misma regla', () => {
    expect(normalizeCampaign(' Prueba ')).toBe('prueba');
    expect(normalizeAgent(' Erick ')).toBe('erick');
  });
});

describe('credentialsKey', () => {
  it('arma la llave del CSV de credenciales', () => {
    expect(credentialsKey('prueba')).toBe('agents/prueba/credentials.csv');
  });
});
