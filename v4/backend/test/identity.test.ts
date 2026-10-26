// Identificador canónico, codificación de llaves y campañas (v4-canonical-identity-keys).
import { describe, expect, it, vi } from 'vitest';

const roles = vi.hoisted(() => ({ value: [] as any[] }));
vi.mock('../src/lib/roles', () => ({ getUserRoles: async () => roles.value }));
vi.mock('../src/lib/rolePerms', () => ({ getManyRolePermissions: async () => new Map() }));
vi.mock('../src/lib/accessCache', () => ({ getCached: async () => null, putCached: async () => {} }));
vi.mock('../src/lib/campaignsDb', () => ({
  listCampaignsDb: async () => ['didi_vip', 'Zendere'],
  campaignExists: async () => true,
}));

import {
  canonicalOperatorId,
  decodeKeySegment,
  encodeKeySegment,
  matchCatalogCampaign,
  normalizeUserCampaigns,
  resolveCatalogCampaign,
  sameCampaign,
} from '../src/lib/identity';
import { claimUser } from '../src/lib/http';
import { resolveUserAccess } from '../src/lib/access';
import { expandWeights } from '../src/handlers/csvTrigger';

describe('identity: operador canónico y segmentos', () => {
  it('canonicalOperatorId', () => {
    expect(canonicalOperatorId('Ana.Lopez')).toBe('ana.lopez');
    expect(canonicalOperatorId('  Juan.Perez ')).toBe('juan.perez');
    expect(canonicalOperatorId(undefined)).toBe('');
  });

  it('encodeKeySegment', () => {
    expect(encodeKeySegment('erick.silva')).toBe('erick.silva');
    expect(encodeKeySegment('a@b')).toBe('a~40b');
    expect(encodeKeySegment('a_b')).toBe('a_b');
    expect(encodeKeySegment('~')).toBe('~7e');
    expect(encodeKeySegment('.')).toBe('~2e');
    expect(encodeKeySegment('..')).toBe('~2e~2e');
    expect(encodeKeySegment('ñ')).toBe('~c3~b1');
    expect(encodeKeySegment('A')).toBe('~41');
  });

  it('decodeKeySegment: escapes inválidos o no canónicos → null', () => {
    expect(decodeKeySegment('a~40b')).toBe('a@b');
    expect(decodeKeySegment('~2e~2e')).toBe('..');
    for (const bad of ['a~4', 'a~zz', 'a~4G', 'a b', 'A', '~61', '.', '..', '', 'a/b', '~ff']) {
      expect(decodeKeySegment(bad)).toBeNull();
    }
  });

  it('ida y vuelta para 1000 strings aleatorios; inyectiva', () => {
    const alphabet = 'abcXYZ019._-~@ ñé/+%😀';
    const seen = new Map<string, string>();
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let n = 0; n < 1000; n++) {
      const chars = [...alphabet];
      const len = 1 + Math.floor(rnd() * 12);
      let s = '';
      for (let i = 0; i < len; i++) s += chars[Math.floor(rnd() * chars.length)];
      const enc = encodeKeySegment(s);
      expect(enc).toMatch(/^[a-z0-9._~-]+$/);
      expect(decodeKeySegment(enc)).toBe(s);
      if (seen.has(enc)) expect(seen.get(enc)).toBe(s);
      seen.set(enc, s);
    }
  });

  it('claimUser canónico; sin claims → null', () => {
    const ev = (claims: Record<string, string>) => ({ requestContext: { authorizer: { jwt: { claims } } } });
    expect(claimUser(ev({ 'cognito:username': 'Ana.Lopez' }))).toBe('ana.lopez');
    expect(claimUser(ev({ sub: 'ABC-123' }))).toBe('abc-123');
    expect(claimUser(ev({}))).toBeNull();
    expect(claimUser(ev({ 'cognito:username': '  ' }))).toBeNull();
  });
});

describe('identity: campañas', () => {
  it('sameCampaign sin mayúsculas ni espacios', () => {
    expect(sameCampaign('DIDI_VIP ', 'didi_vip')).toBe(true);
    expect(sameCampaign('didi', 'didi_vip')).toBe(false);
    expect(sameCampaign('', '')).toBe(false);
  });

  it('grafía del catálogo', async () => {
    expect(matchCatalogCampaign(' Didi_Vip', ['didi_vip'])).toBe('didi_vip');
    expect(matchCatalogCampaign('Nueva ', ['didi_vip'])).toBe('Nueva');
    expect(await resolveCatalogCampaign('ZENDERE')).toBe('Zendere');
    expect(normalizeUserCampaigns(['DIDI_VIP', 'didi_vip ', '*', ''], ['didi_vip'])).toEqual(['didi_vip', '*']);
  });

  it('resolveUserAccess: Erick.Silva es el superadmin; campañas de roles normalizadas', async () => {
    expect((await resolveUserAccess('Erick.Silva')).isAdmin).toBe(true);
    roles.value = [
      { role_id: 'r1', role_name: 'Líder DIDI', campaign_name: 'DIDI_VIP', permissions: [] },
      { role_id: 'r2', role_name: 'Agente DIDI', campaign_name: 'didi_vip ', permissions: [] },
    ];
    const a = await resolveUserAccess('Luis');
    expect(a.username).toBe('luis');
    expect(a.campaigns).toEqual(['didi_vip']);
  });

  it('expandWeights: {"Ana.Lopez":1,"ana.lopez":1,"luis":1} → ana.lopez 2/3, luis 1/3', () => {
    const t = expandWeights(JSON.stringify({ 'Ana.Lopez': 1, 'ana.lopez': 1, luis: 1 }));
    expect(t.sort()).toEqual(['ana.lopez', 'ana.lopez', 'luis']);
  });
});
