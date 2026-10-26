// Lógica pura de scripts/migrate-canonical-ids.ts (sin AWS).
import { describe, expect, it } from 'vitest';
import { parseArgs, planUser, precheck, rewriteMediaKey, targetKey } from '../scripts/migrate-canonical-ids';

describe('migrate-canonical-ids', () => {
  it('pool en minúsculas sin especiales → 0 afectados, 0 colisiones', () => {
    expect(precheck(['erick.silva', 'ana.lopez', 'luis_m'])).toEqual({ total: 3, affected: [], collisions: [] });
  });

  it('afectados: mayúsculas (DynamoDB) y caracteres especiales (S3)', () => {
    const r = precheck(['Prueba.Mayus', 'prueba@especial']);
    expect(r.affected).toEqual([
      { username: 'Prueba.Mayus', canonical: 'prueba.mayus', legacySegment: 'Prueba.Mayus', segment: 'prueba.mayus', ddbMoves: true, s3Moves: true },
      { username: 'prueba@especial', canonical: 'prueba@especial', legacySegment: 'prueba_especial', segment: 'prueba~40especial', ddbMoves: false, s3Moves: true },
    ]);
    expect(r.collisions).toEqual([]);
  });

  it('colisiones por canónico y por segmento saneado', () => {
    const r = precheck(['a@b', 'a_b', 'Ana', 'ana']);
    expect(r.collisions).toEqual(
      expect.arrayContaining([
        { kind: 'canonical', value: 'ana', users: ['Ana', 'ana'] },
        { kind: 'legacySegment', value: 'a_b', users: ['a@b', 'a_b'] },
      ]),
    );
  });

  it('reescritura de mediaKey y llaves S3', () => {
    const u = planUser('prueba@especial');
    expect(rewriteMediaKey('media/prueba_especial/1_a.jpg', u)).toBe('media/prueba~40especial/1_a.jpg');
    expect(rewriteMediaKey('media/otro/1_a.jpg', u)).toBe('media/otro/1_a.jpg');
    expect(rewriteMediaKey(undefined, u)).toBeUndefined();
    expect(targetKey('wa-sessions/prueba_especial/session.zip', u)).toBe('wa-sessions/prueba~40especial/session.zip');
    expect(targetKey('csv-uploads/prueba_especial/1_a.csv', u)).toBe('csv-uploads/prueba~40especial/1_a.csv');
    expect(targetKey('media/otro/x', u)).toBeNull();
  });

  it('args: dry-run por defecto; --apply y --delete-source separados', () => {
    expect(parseArgs(['--stage', 'dev']).mode).toBe('dry-run');
    expect(parseArgs(['--stage', 'prod', '--apply'])).toMatchObject({ stage: 'prod', mode: 'apply', region: 'us-east-2' });
    expect(() => parseArgs(['--stage', 'dev', '--apply', '--delete-source'])).toThrow();
    expect(() => parseArgs([])).toThrow('falta --stage');
  });
});
