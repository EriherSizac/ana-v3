// File: db
// Created: 2026-06-10
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import { Pool } from 'pg';

// Pool de PostgreSQL reutilizado entre invocaciones calientes de la Lambda
// (module-level → no abre conexión por request). Credenciales en backend/.env.
//
// TLS: cifrado siempre, sin verificar la CA (RDS usa su propia cadena y no
// cargamos el bundle; el tráfico va cifrado igualmente).
const SSL = { rejectUnauthorized: false };

let pool: Pool | null = null;

export function db(): Pool {
  if (!pool) {
    // Conexión: DATABASE_URL, o campos sueltos estilo pgAdmin (PGHOST, PGPORT,
    // PGUSER, PGPASSWORD, PGDATABASE) si la URL no está definida.
    const url = process.env.DATABASE_URL;
    const conn = url
      ? { connectionString: url }
      : {
          host: process.env.PGHOST,
          port: Number(process.env.PGPORT || 5432),
          user: process.env.PGUSER,
          password: process.env.PGPASSWORD,
          database: process.env.PGDATABASE,
        };
    pool = new Pool({
      ...conn,
      ssl: SSL,
      max: 2, // Lambda: pocas conexiones por contenedor
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}
