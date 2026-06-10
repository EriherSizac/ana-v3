// File: Selector para ver conversaciones de agentes.
// Created: 2026-06-09
// Updated: 2026-06-09
// Author: Erick Hernández Silva

import { useEffect, useState } from 'react';
import { getAgents, getCampaigns, type AgentEntry, type UserAccess } from '../lib/api';

/**
 * Selector para ver conversaciones de agentes.
 *  - Admin: elige campaña, luego agente.
 *  - Líder: elige agente entre los de sus campañas (sin selector de campaña).
 * value = operatorId visto (null = mis propias conversaciones).
 */
export function TeamViewer({
  access,
  value,
  onChange,
}: {
  access: UserAccess | null;
  value: string | null;
  onChange: (operatorId: string | null) => void;
}) {
  const isAdmin = !!access?.isAdmin;
  const [campaigns, setCampaigns] = useState<string[]>([]);
  const [campaign, setCampaign] = useState<string>('');
  const [agents, setAgents] = useState<AgentEntry[]>([]);

  // Admin: carga campañas. Líder: carga sus agentes directo.
  useEffect(() => {
    if (isAdmin) {
      void getCampaigns().then(setCampaigns).catch(() => setCampaigns([]));
    } else {
      void getAgents().then(setAgents).catch(() => setAgents([]));
    }
  }, [isAdmin]);

  // Admin: al elegir campaña, carga sus agentes.
  useEffect(() => {
    if (!isAdmin || !campaign) return;
    void getAgents(campaign).then(setAgents).catch(() => setAgents([]));
    onChange(null); // reset selección al cambiar de campaña
  }, [campaign, isAdmin]);

  return (
    <div className="space-y-2 border-b border-neutral-50 bg-neutral-30 p-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-text-light">
        Ver como
      </div>

      {isAdmin && (
        <select
          value={campaign}
          onChange={(e) => setCampaign(e.target.value)}
          className="w-full rounded-xl border border-neutral-50 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-secondary"
        >
          <option value="">Campaña…</option>
          {campaigns.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      )}

      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full rounded-xl border border-neutral-50 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-secondary"
      >
        <option value="">Mis conversaciones</option>
        {agents.map((a) => (
          <option key={a.operatorId} value={a.operatorId}>
            {a.operatorId} {a.active ? '· activo' : '· offline'}
          </option>
        ))}
      </select>
    </div>
  );
}
