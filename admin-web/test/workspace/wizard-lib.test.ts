import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFile, mergeFiles, planPhones } from '@/lib/workspace';
import {
  clearDraft,
  draftKey,
  isRecentSource,
  loadDraft,
  MAX_SOURCE_AGE_MS,
  samplePairs,
  saveDraft,
  sourceDate,
  summarizePlan,
  type WizardDraft,
} from '@/lib/workspace/wizard';

/** add-agent-workspace: lógica pura del asistente "Mi asignación". */
const NOW = Date.parse('2026-10-29T12:00:00Z');
const KEY = 'assignments/agents/prueba/ana-contacts-2026-08-01T10-00-00-000Z.csv';

describe('antigüedad de pendientes (≤ 90 días)', () => {
  it('prioridad: uploadedAt de v3 → fecha de la llave → lastModified', () => {
    expect(sourceDate({ key: KEY, lastModified: '2026-10-01T00:00:00Z', uploadedAt: '2026-09-01T00:00:00Z' })).toBe(Date.parse('2026-09-01T00:00:00Z'));
    expect(sourceDate({ key: KEY, lastModified: '2026-10-01T00:00:00Z' })).toBe(Date.parse('2026-08-01T10:00:00Z'));
    expect(sourceDate({ key: 'a-contacts-x.csv', lastModified: '2026-10-01T00:00:00Z' })).toBe(Date.parse('2026-10-01T00:00:00Z'));
    expect(sourceDate({ key: 'a-contacts-x.csv', lastModified: null })).toBeNull();
  });
  it('límite de 90 días; sin fecha se ofrece', () => {
    const t = Date.parse('2026-08-01T10:00:00Z');
    expect(isRecentSource({ key: KEY, lastModified: null }, t + MAX_SOURCE_AGE_MS)).toBe(true);
    expect(isRecentSource({ key: KEY, lastModified: null }, t + MAX_SOURCE_AGE_MS + 1)).toBe(false);
    expect(isRecentSource({ key: 'a-contacts-x.csv', lastModified: null }, NOW)).toBe(true);
  });
});

describe('borrador (sessionStorage)', () => {
  const draft: WizardDraft = { v: 1, step: 3, keys: ['k'], etags: ['"e"'], selected: ['0:0'], phoneColumns: ['phone'], phoneMode: 'all', overrides: [['0:0', '1']], template: 'Hola' };
  beforeEach(() => sessionStorage.clear());

  it('guarda, lee y borra por campaña', () => {
    saveDraft('prueba', draft);
    expect(loadDraft('prueba')).toEqual(draft);
    expect(loadDraft('otra')).toBeNull();
    clearDraft('prueba');
    expect(loadDraft('prueba')).toBeNull();
  });
  it('forma inválida o JSON roto → null', () => {
    sessionStorage.setItem(draftKey('prueba'), JSON.stringify({ ...draft, step: 9 }));
    expect(loadDraft('prueba')).toBeNull();
    sessionStorage.setItem(draftKey('prueba'), '{');
    expect(loadDraft('prueba')).toBeNull();
  });
  it('storage que lanza no rompe', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveDraft('prueba', draft)).not.toThrow();
    spy.mockRestore();
  });
});

describe('summarizePlan / samplePairs', () => {
  const CSV = 'id_credito,nombre,telefono_1\nC1,Ana,5215500000001\nC1,Ana bis,5215500000002\nC2,Beto,123\nC3,Carla,5215500000004\nincompleta\n';
  const m = mergeFiles([loadFile('k', 'e', CSV)]);
  const valid = m.rows.filter((r) => r.valid);
  const selected = valid.slice(0, 3);
  const phones = planPhones(selected, ['telefono_1'], 'first');

  it('mensajes y motivos de exclusión', () => {
    expect(summarizePlan(m.rows, selected, phones, ['telefono_1'])).toEqual({
      selected: 3,
      messages: 1,
      excluded: [
        { reason: 'Sin teléfono válido en las columnas elegidas', count: 1 },
        { reason: 'Crédito o teléfono repetido (ya incluido)', count: 1 },
        { reason: 'No seleccionadas (o fuera de los filtros)', count: 1 },
        { reason: 'Fila incompleta', count: 1 },
      ],
    });
  });
  it('muestras en orden de publicación', () => {
    const all = planPhones(valid, ['telefono_1'], 'all');
    expect(samplePairs(valid, all, 2).map((s) => s.phone)).toEqual(['5215500000001', '5215500000002']);
  });
});
