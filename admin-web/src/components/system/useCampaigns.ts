'use client';

import { useEffect, useState } from 'react';
import { ApiError, apiFetch, isRedirecting } from '@/lib/api-client';

/** Campañas seleccionables del usuario (`GET /api/campaigns`). */
export function useCampaigns() {
  const [campaigns, setCampaigns] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ campaigns: string[] }>('/api/campaigns')
      .then((r) => !cancelled && setCampaigns(r.campaigns))
      .catch((e) => {
        if (cancelled || isRedirecting(e)) return;
        setError(e instanceof ApiError ? e.message : 'No se pudieron cargar las campañas.');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);
  return { campaigns, loading, error };
}
