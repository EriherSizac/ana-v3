// File: Store de RemoteAuth (whatsapp-web.js) respaldado en S3 vía el backend.
// Created: 2026-06-10
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import fs from 'node:fs';

/**
 * Store que RemoteAuth usa para persistir la sesión de WhatsApp como un zip.
 * No habla con S3 directo (el desktop no tiene credenciales AWS): pide URLs
 * presigned al backend (scoped al usuario por JWT) y sube/baja el zip por HTTP.
 *
 * Contrato de RemoteAuth:
 *  - sessionExists({session}) → ¿hay zip remoto?
 *  - save({session})          → sube `${dataPath}/${session}.zip` (ya creado)
 *  - extract({session, path}) → baja el zip remoto a `path`
 *  - delete({session})        → borra el zip remoto
 */
export class S3SessionStore {
  constructor(
    private apiBase: string,
    private getToken: () => string | null,
    private dataPath: string,
  ) {}

  private headers() {
    const token = this.getToken();
    return {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
  }

  private async presign(op: 'put' | 'get'): Promise<string | null> {
    try {
      const res = await fetch(`${this.apiBase}/wa-session/presign`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ op }),
      });
      if (!res.ok) return null;
      return ((await res.json()) as { url: string }).url;
    } catch {
      return null;
    }
  }

  async sessionExists(_opts: { session: string }): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiBase}/wa-session/exists`, {
        headers: this.headers(),
      });
      if (!res.ok) return false;
      return !!((await res.json()) as { exists: boolean }).exists;
    } catch {
      return false;
    }
  }

  async save(opts: { session: string }): Promise<void> {
    const zipPath = `${this.dataPath}/${opts.session}.zip`;
    const url = await this.presign('put');
    if (!url) throw new Error('No se pudo obtener presign PUT de la sesión');
    const body = fs.readFileSync(zipPath);
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/zip' },
      body,
    });
    if (!res.ok) throw new Error(`Falló subir la sesión a S3 (${res.status})`);
    console.log('[wa] sesión respaldada en S3');
  }

  async extract(opts: { session: string; path: string }): Promise<void> {
    const url = await this.presign('get');
    if (!url) throw new Error('No se pudo obtener presign GET de la sesión');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Falló bajar la sesión de S3 (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(opts.path, buf);
    console.log('[wa] sesión restaurada desde S3');
  }

  async delete(_opts: { session: string }): Promise<void> {
    try {
      await fetch(`${this.apiBase}/wa-session/delete`, {
        method: 'POST',
        headers: this.headers(),
      });
    } catch {
      /* no crítico */
    }
  }
}
