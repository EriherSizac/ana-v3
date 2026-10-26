import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeDigits } from '../phone';
import { toE164Mx, searchCreditIdByPhone } from '../interactions';

// Vectores compartidos con v4/desktop (misma tabla, mismas reglas).
const vectors = JSON.parse(
  readFileSync(join(__dirname, '../../../../shared/phone-mx-vectors.json'), 'utf-8'),
) as { in: string; cc: string; out: string | null; note: string }[];

afterEach(() => vi.unstubAllGlobals());

describe('normalizeDigits (vectores compartidos)', () => {
  it.each(vectors)('$note: "$in" (lada $cc) → $out', (v) => {
    expect(normalizeDigits(v.in, v.cc)).toBe(v.out);
  });
});

describe('toE164Mx', () => {
  it.each(vectors.filter((v) => v.cc === '52'))('$note', (v) => {
    expect(toE164Mx(v.in)).toBe(v.out ? `+${v.out}` : '');
  });
});

describe('searchCreditIdByPhone', () => {
  it('0445512345678 busca +525512345678', async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) =>
      new Response(JSON.stringify({ result: [{ credit_info: { credit_id: 'C9' } }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', f);
    expect(await searchCreditIdByPhone('bancoppel', toE164Mx('0445512345678'))).toBe('C9');
    expect(JSON.parse(String(f.mock.calls[0][1]?.body)).search_value).toBe('+525512345678');
  });
  it('teléfono inválido no consulta el CRM', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await searchCreditIdByPhone('bancoppel', toE164Mx('12345'))).toBe('');
    expect(f).not.toHaveBeenCalled();
  });
});
