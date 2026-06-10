// File: Permisos de un rol. [] si no existe.
// Created: 2026-06-09
// Updated: 2026-06-09
// Author: Erick Hernández Silva

import { BatchGetCommand, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from './dynamo';

// Almacén local rol→permisos (patrón recomendado de la guía §5).
// Single-table: PK="ROLEPERMS", SK="ROLE#<roleId>".
const ROLEPERMS_TABLE = process.env.ROLEPERMS_TABLE!;
const PK = 'ROLEPERMS';
const sk = (roleId: string) => `ROLE#${roleId}`;

export interface RolePerms {
  roleId: string;
  roleName?: string;
  permissions: string[];
  updatedAt: string;
}

/** Permisos de un rol. [] si no existe. */
export async function getRolePermissions(roleId: string): Promise<string[]> {
  const res = await ddb.send(
    new GetCommand({ TableName: ROLEPERMS_TABLE, Key: { PK, SK: sk(roleId) } }),
  );
  return (res.Item?.permissions as string[]) ?? [];
}

/** Permisos de varios roles (batch). Map roleId→permisos. */
export async function getManyRolePermissions(
  roleIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (roleIds.length === 0) return out;
  // BatchGet máx 100; aquí los roles por usuario son pocos.
  const res = await ddb.send(
    new BatchGetCommand({
      RequestItems: {
        [ROLEPERMS_TABLE]: { Keys: roleIds.map((id) => ({ PK, SK: sk(id) })) },
      },
    }),
  );
  for (const item of res.Responses?.[ROLEPERMS_TABLE] ?? []) {
    out.set(item.roleId as string, (item.permissions as string[]) ?? []);
  }
  return out;
}

/** Reemplazo total de permisos de un rol (dedup). Admin API. */
export async function setRolePermissions(
  roleId: string,
  permissions: string[],
  roleName?: string,
): Promise<void> {
  const item: RolePerms & { PK: string; SK: string } = {
    PK,
    SK: sk(roleId),
    roleId,
    roleName,
    permissions: [...new Set(permissions)],
    updatedAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: ROLEPERMS_TABLE, Item: item }));
}
