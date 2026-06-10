// File: db
// Created: 2026-06-10
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import { Pool } from 'pg';

// Pool de PostgreSQL reutilizado entre invocaciones calientes de la Lambda
// (module-level → no abre conexión por request). DATABASE_URL es secreto (.env).
//
// TLS (seguro por defecto):
//  - PGSSL=false            → sin TLS (solo dev/local).
//  - PGSSL_CA=<PEM>         → verifica contra esa CA (recomendado para RDS:
//                             pega el RDS global CA bundle).
//  - PGSSL_NO_VERIFY=true   → TLS sin verificar la CA (riesgo MITM; último
//                             recurso, opt-in explícito).
//  - por defecto            → TLS con verificación estándar.
function sslConfig(): false | { ca?: string; rejectUnauthorized: boolean } {
  if (process.env.PGSSL === 'false') return false;
  if (process.env.PGSSL_CA) return { ca: process.env.PGSSL_CA, rejectUnauthorized: true };
  if (process.env.PGSSL_NO_VERIFY === 'true') return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

let pool: Pool | null = null;

export function db(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslConfig(),
      max: 2, // Lambda: pocas conexiones por contenedor
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}
