import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * Puente realtime v3 → v4 (add-realtime-gateway 4.2), verificación estática de
 * serverless.yml (no se puede correr `serverless package` sin credenciales):
 * StorageBucket solo agrega EventBridge y ninguna función cambia.
 */
const file = join(__dirname, '..', 'serverless.yml');
const cfg = parse(readFileSync(file, 'utf8'));

describe('serverless.yml: puente realtime', () => {
  it('StorageBucket solo agrega EventBridgeConfiguration', () => {
    expect(cfg.resources.Resources.StorageBucket).toEqual({
      Type: 'AWS::S3::Bucket',
      Properties: {
        BucketName: '${self:service}-storage-${sls:stage}',
        NotificationConfiguration: { EventBridgeConfiguration: { EventBridgeEnabled: true } },
      },
    });
  });

  it('regla del bus por defecto con filtro de bucket y prefijos, destino el bus de v4', () => {
    const rule = cfg.resources.Resources.RealtimeBridgeRule;
    expect(rule.Condition).toBe('HasRealtimeBus');
    expect(rule.Properties.EventBusName).toBe('default');
    expect(rule.Properties.EventPattern).toEqual({
      source: ['aws.s3'],
      'detail-type': ['Object Created', 'Object Deleted'],
      detail: {
        bucket: { name: ['${self:service}-storage-${sls:stage}'] },
        object: {
          key: [
            { prefix: 'agents/' },
            { prefix: 'assignments/agents/' },
            { prefix: 'agent-publications/' },
            { prefix: 'review/' },
            { prefix: 'rosters/' },
            { prefix: 'uploads/' },
            'config/cli-settings.json',
            // add-in-session-updates: manifiesto del CLI → release.available
            'versions/latest.json',
          ],
        },
      },
    });
    expect(rule.Properties.Targets[0].Arn).toBe('${param:realtimeBusArn, ""}');
    expect(rule.Properties.Targets[0].RoleArn).toEqual({ 'Fn::GetAtt': ['RealtimeBridgeRole', 'Arn'] });
    const role = cfg.resources.Resources.RealtimeBridgeRole;
    expect(role.Properties.Policies[0].PolicyDocument.Statement[0].Action).toEqual(['events:PutEvents']);
  });

  it('ninguna función ni ruta v3 cambia respecto al commit base', () => {
    let base: string;
    try {
      base = execFileSync('git', ['show', 'installer-2:v3/ana-backend/serverless.yml'], { cwd: join(__dirname, '..'), encoding: 'utf8' });
    } catch {
      return; // sin git/rama base disponible: se omite la comparación
    }
    expect(cfg.functions).toEqual(parse(base).functions);
    // Variables de entorno agregadas después (crm-interactions-agent-identity) no cuentan.
    const ADDED_ENV = ['ROLES_API_BASE', 'ROLES_API_KEY'];
    const withoutAdded = (p: any) => ({
      ...p,
      environment: Object.fromEntries(Object.entries(p.environment ?? {}).filter(([k]) => !ADDED_ENV.includes(k))),
    });
    expect(withoutAdded(cfg.provider)).toEqual(withoutAdded(parse(base).provider));
  });
});
