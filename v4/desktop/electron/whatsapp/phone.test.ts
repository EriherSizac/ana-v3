import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeDigits } from './phone';
import { outcomeForResolve } from '../jobs/outcome';

// Vectores compartidos con v4/backend (misma tabla, mismas reglas).
const vectors = JSON.parse(
  readFileSync(join(__dirname, '../../../shared/phone-mx-vectors.json'), 'utf-8'),
) as { in: string; cc: string; out: string | null; note: string }[];

describe('normalizeDigits (vectores compartidos)', () => {
  it.each(vectors)('$note: "$in" (lada $cc) → $out', (v) => {
    expect(normalizeDigits(v.in, v.cc)).toBe(v.out);
  });
  it('lada con + o vacía cuenta como 52', () => {
    expect(normalizeDigits('0445512345678', '+52')).toBe('525512345678');
    expect(normalizeDigits('5512345678', '')).toBe('525512345678');
  });
});

describe('outcomeForResolve', () => {
  it('inválido → error "Teléfono inválido", reporte error (nunca no_whatsapp)', () => {
    expect(outcomeForResolve({ kind: 'invalid' })).toEqual({
      success: false,
      error: 'Teléfono inválido',
      noWhatsapp: false,
      report: 'error',
    });
  });
  it('sin WhatsApp → no_whatsapp', () => {
    expect(outcomeForResolve({ kind: 'not_on_whatsapp' })).toMatchObject({ noWhatsapp: true, report: 'no_whatsapp' });
  });
  it('ok → continuar', () => expect(outcomeForResolve({ kind: 'ok', jid: 'x@c.us' })).toBeNull());
});
