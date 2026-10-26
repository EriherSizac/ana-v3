import { describe, it, expect } from 'vitest';
import { truncationNotice } from './assignmentNotice';

describe('truncationNotice', () => {
  it('3000 pendientes, 2000 entregados', () =>
    expect(truncationNotice({ truncated: true, pendingTotal: 3000 }, 2000)).toBe(
      'Mostrando 2000 de 3000 pendientes; envía los actuales para ver el resto.',
    ));
  it('sin truncado → oculto', () => expect(truncationNotice({ truncated: false, pendingTotal: 5 }, 5)).toBeNull());
  it('sin info → oculto', () => expect(truncationNotice(null, 0)).toBeNull());
});
