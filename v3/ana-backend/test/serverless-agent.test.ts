import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/** Verificación estática de serverless.yml para la autenticación de agente (tarea 2.5/3.4/4.1). */
const cfg = parse(readFileSync(join(__dirname, '..', 'serverless.yml'), 'utf8'));
const env = readFileSync(join(__dirname, '..', '.env.example'), 'utf8');

const httpEvents = () =>
  Object.entries<any>(cfg.functions).flatMap(([name, fn]) =>
    (fn.events ?? []).filter((e: any) => e.httpApi).map((e: any) => ({ name, ...e.httpApi })),
  );

const AGENT_FUNCTIONS = [
  'uploadBackup', 'getLatestBackup', 'saveChatBackup', 'getChatBackup', 'listChatBackups',
  'getChats', 'uploadMedia', 'updatePendingContacts', 'getTemplates', 'agentCampaigns', 'agentSettings',
];

describe('serverless.yml: autenticación de agente', () => {
  it('variables en provider.environment y .env.example', () => {
    const e = cfg.provider.environment;
    expect(e.AGENT_AUTH_ENFORCED).toBe("${env:AGENT_AUTH_ENFORCED, 'false'}");
    expect(e.COGNITO_USER_POOL_ID).toBe("${env:COGNITO_USER_POOL_ID, 'us-east-2_UepfOyKpd'}");
    expect(e.COGNITO_AGENT_CLIENT_IDS).toBe("${env:COGNITO_AGENT_CLIENT_IDS, '1r6niimhkl2fmias6kk85n4ou4'}");
    for (const k of ['AGENT_AUTH_ENFORCED', 'COGNITO_USER_POOL_ID', 'COGNITO_AGENT_CLIENT_IDS']) expect(env).toMatch(new RegExp(`^${k}=`, 'm'));
  });

  it('API de Roles (crm-interactions-agent-identity): base con default y key sin valor commiteado', () => {
    const e = cfg.provider.environment;
    expect(e.ROLES_API_BASE).toBe("${env:ROLES_API_BASE, 'https://8emg4wx2t8.execute-api.us-east-2.amazonaws.com'}");
    expect(e.ROLES_API_KEY).toBe("${env:ROLES_API_KEY, ''}");
    expect(env).toMatch(/^ROLES_API_BASE=/m);
    expect(env).toMatch(/^ROLES_API_KEY=$/m);
  });

  it('authorizer cognitoAgentJwt con emisor del pool y audiencia del CLI', () => {
    const a = cfg.provider.httpApi.authorizers.cognitoAgentJwt;
    expect(a.type).toBe('jwt');
    expect(a.identitySource).toBe('$request.header.Authorization');
    expect(a.issuerUrl).toBe("https://cognito-idp.us-east-2.amazonaws.com/${env:COGNITO_USER_POOL_ID, 'us-east-2_UepfOyKpd'}");
    expect(a.audience).toEqual(["${env:COGNITO_AGENT_CLIENT_IDS, '1r6niimhkl2fmias6kk85n4ou4'}"]);
    // CLI y ANA Admin comparten el App Client existente del pool (decisión 2026-10-26).
  });

  it('/agent/campaigns y /agent/settings con cognitoAgentJwt; el resto sin authorizer en modo reporte', () => {
    const ev = httpEvents();
    for (const p of ['/agent/campaigns', '/agent/settings']) {
      const e = ev.find((x) => x.path === p);
      expect(e?.method).toBe('get');
      expect(e?.authorizer?.name).toBe('cognitoAgentJwt');
    }
    for (const p of ['/get/chats/{agentId}/{campaignId}', '/backups/chat', '/media', '/templates']) {
      for (const e of ev.filter((x) => x.path === p)) expect(e.authorizer).toBeUndefined();
    }
  });

  it('metric filter AnaAgentAuth/Requests por función de agente y consulta guardada', () => {
    const r = cfg.resources.Resources;
    for (const f of AGENT_FUNCTIONS) {
      expect(cfg.functions[f], f).toBeDefined();
      const cap = f[0].toUpperCase() + f.slice(1);
      const m = r[`AgentAuthMetric${cap}`];
      expect(m?.Type).toBe('AWS::Logs::MetricFilter');
      expect(m.DependsOn).toBe(`${cap}LogGroup`);
      expect(m.Properties.LogGroupName).toBe(`/aws/lambda/\${self:service}-\${sls:stage}-${f}`);
      expect(m.Properties.FilterPattern).toBe('{ $.evt = "agent_auth" }');
      const t = m.Properties.MetricTransformations[0];
      expect([t.MetricNamespace, t.MetricName]).toEqual(['AnaAgentAuth', 'Requests']);
      expect(t.Dimensions.map((d: any) => d.Key)).toEqual(['reason', 'cliVersion']);
    }
    expect(r.AgentAuthQuery.Properties.QueryString).toContain('stats count() by reason, cliVersion, agent');
  });
});
