import 'server-only';
import { serverEnv } from '../env';
import { HttpError, jsonResponse } from '../errors';
import { callUpstream } from './http';
import { ensureOk } from './v4';

/** Proxy de lectura a las rutas legacy de v3 con el token del usuario; respuestas sin caché. */
export async function proxyLegacy(token: string, path: string, opts: { notFoundMessage?: string } = {}): Promise<Response> {
  const res = await callUpstream(`${serverEnv().v3ApiBase}${path}`, { token, label: 'v3:legacy' });
  if (res.status === 404) throw new HttpError('not_found', opts.notFoundMessage);
  return jsonResponse(ensureOk(res, 'v3:legacy'));
}
