import 'server-only';
import { canEnter, hasPermission, type Access } from '@/lib/access';
import { normalizeCampaign, isValidCampaign } from '@/lib/campaign';
import { verifyRequest, type VerifiedIdentity } from '../auth/verifyIdToken';
import { HttpError, toErrorResponse } from '../errors';
import { resolveAccess } from './resolveAccess';

/** Un permiso `ana:*` o una regla sobre el acceso (p. ej. `a => a.isDeveloper`). */
export type Requirement = string | ((access: Access) => boolean);

export interface AccessContext<P> {
  access: Access;
  identity: VerifiedIdentity;
  params: P;
  /** Campaña normalizada (si la ruta declara `campaignFrom`). */
  campaign: string;
}

export interface WithAccessOptions<P> {
  /** Requisitos (todos deben cumplirse). Un string = permiso; admin lo tiene. */
  permission?: Requirement | Requirement[];
  /** De dónde sale la campaña a la que se limita la operación. */
  campaignFrom?: 'path' | 'query' | ((req: Request, params: P) => string | undefined | null);
  /** Exigir el gate de entrada a la consola (default true). `GET /api/me` lo desactiva. */
  entry?: boolean;
  /** Etiqueta de log. */
  label?: string;
}

type RouteContext<P> = { params: Promise<P> };

function meets(access: Access, req: Requirement): boolean {
  return typeof req === 'string' ? hasPermission(access, req) : req(access);
}

/** ¿La campaña está en el alcance? (admin y `*` pasan; comparación normalizada). */
export function campaignAllowed(access: Access, campaign: string): boolean {
  if (access.isAdmin) return true;
  const own = access.campaigns.map(normalizeCampaign);
  return own.includes('*') || own.includes(campaign);
}

/**
 * Envoltura de route handlers del BFF: verifica el id token (401), resuelve
 * el acceso vía v4 `/me` (503 si falla), aplica el gate de entrada, el permiso
 * de la ruta y el alcance de campaña (403) ANTES de llamar a cualquier backend.
 */
export function withAccess<P extends Record<string, string | string[]> = Record<string, string>>(
  handler: (req: Request, ctx: AccessContext<P>) => Promise<Response>,
  opts: WithAccessOptions<P> = {},
) {
  const requirements = opts.permission === undefined ? [] : Array.isArray(opts.permission) ? opts.permission : [opts.permission];
  return async (req: Request, routeCtx: RouteContext<P>): Promise<Response> => {
    try {
      const identity = await verifyRequest(req);
      const access = await resolveAccess(identity.username, identity.token);
      if (opts.entry !== false && !canEnter(access)) throw new HttpError('forbidden');
      for (const r of requirements) if (!meets(access, r)) throw new HttpError('forbidden');

      const params = ((await routeCtx?.params) ?? {}) as P; // routeCtx puede faltar en llamadas directas
      let campaign = '';
      if (opts.campaignFrom) {
        let raw: string | undefined | null;
        if (opts.campaignFrom === 'path') raw = params.campaign as string | undefined;
        else if (opts.campaignFrom === 'query') raw = new URL(req.url).searchParams.get('campaign');
        else raw = opts.campaignFrom(req, params);
        campaign = normalizeCampaign(raw ?? ''); // Next y URLSearchParams ya decodifican
        if (!campaign || !isValidCampaign(campaign)) throw new HttpError('invalid_request', 'Campaña inválida');
        if (!campaignAllowed(access, campaign)) throw new HttpError('forbidden', 'Campaña no permitida');
      }
      return await handler(req, { access, identity, params, campaign });
    } catch (err) {
      return toErrorResponse(err, opts.label ?? 'bff');
    }
  };
}
